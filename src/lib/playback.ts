// Keeps a pool of media elements in step with a project clock. The Editor's preview and the
// render queue both drive one of these; the renderer also routes the sound into a recording.
import type { Media, Project } from "./types";
import { activeClipAt } from "./project";
import { blobUrl } from "./db";
import type { Visual } from "./compositor";
import { settleDuration } from "./media";

export class MediaPool {
  readonly visuals = new Map<string, Visual>();
  readonly audios = new Map<string, HTMLMediaElement>();
  private loading = new Map<string, Promise<void>>();
  private audioCtx: AudioContext | null;
  private dest: MediaStreamAudioDestinationNode | null;
  private routed = new WeakSet<HTMLMediaElement>();
  /** The last time each element was asked to seek to; seeks in recorded WebM land near, not on, it. */
  private targets = new WeakMap<HTMLMediaElement, number>();

  /** With an AudioContext, every element's sound goes to `dest` instead of the speakers. */
  constructor(audio?: { ctx: AudioContext; dest: MediaStreamAudioDestinationNode }) {
    this.audioCtx = audio?.ctx ?? null;
    this.dest = audio?.dest ?? null;
  }

  ensure(media: Media[]): Promise<void> {
    return Promise.all(media.map((m) => this.load(m))).then(() => undefined);
  }

  private load(m: Media): Promise<void> {
    let p = this.loading.get(m.id);
    if (p) return p;
    p = blobUrl(m.blobKey).then(
      (url) =>
        new Promise<void>((resolve) => {
          if (!url) return resolve();
          if (m.kind === "image") {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => resolve();
            img.src = url;
            this.visuals.set(m.id, img);
            return;
          }
          const el = document.createElement(m.kind === "video" ? "video" : "audio");
          el.preload = "auto";
          if (el instanceof HTMLVideoElement) el.playsInline = true;
          el.crossOrigin = "anonymous";
          el.src = url;
          // Recorded WebM can't be seeked until its duration is known.
          el.onloadedmetadata = () => {
            settleDuration(el).then(() => {
              if (el.readyState >= 2) resolve();
              else el.addEventListener("loadeddata", () => resolve(), { once: true });
            });
          };
          el.onerror = () => resolve();
          setTimeout(resolve, 8000);
          this.route(el);
          if (m.kind === "video") this.visuals.set(m.id, el as HTMLVideoElement);
          this.audios.set(m.id, el);
        }),
    );
    this.loading.set(m.id, p);
    return p;
  }

  private route(el: HTMLMediaElement) {
    if (!this.audioCtx || !this.dest || this.routed.has(el)) return;
    this.audioCtx.createMediaElementSource(el).connect(this.dest);
    this.routed.add(el);
  }

  /**
   * Plays/pauses and seeks every element to match the project at time t.
   * Returns true when playback state changed (seek, play, pause, rate, volume) so callers can
   * decide whether the canvas needs repainting.
   *
   * A video element serves both picture and sound, so its position and rate must always come
   * from the active video clip. Audio-lane entries that reference video media now only adjust
   * loudness: previously they overwrote position/rate, so whenever the two lanes disagreed
   * (a trim, a speed change, a lane boundary) the element hard-seeked every few seconds and
   * playback visibly stuttered. Audio-kind media still follows its lane fully.
   */
  sync(p: Project, t: number, playing: boolean, force = false): boolean {
    const a = activeClipAt(p, t);
    const wanted = new Map<string, { local: number; rate: number; volume: number }>();
    if (a) {
      const m = p.media.find((x) => x.id === a.clip.mediaId);
      if (m && m.kind === "video") wanted.set(m.id, { local: a.local, rate: a.clip.speed, volume: a.clip.volume });
    }
    for (const c of p.music) {
      if (t >= c.start && t < c.start + (c.out - c.in)) {
        const prev = wanted.get(c.mediaId);
        if (prev) prev.volume = c.volume;
        else wanted.set(c.mediaId, { local: c.in + (t - c.start), rate: 1, volume: c.volume });
      }
    }
    let changed = false;
    for (const [id, el] of this.audios) {
      const w = wanted.get(id);
      if (!w) {
        if (!el.paused) {
          el.pause();
          changed = true;
        }
        continue;
      }
      if (el.playbackRate !== w.rate) {
        el.playbackRate = w.rate;
        changed = true;
      }
      const volume = Math.min(1, Math.max(0, w.volume));
      if (el.volume !== volume) {
        el.volume = volume;
        changed = true;
      }
      const last = this.targets.get(el);
      const moved = last === undefined || Math.abs(last - w.local) > 0.01;
      const drift = Math.abs(el.currentTime - w.local);
      if (force || (playing ? drift > 0.35 : moved)) {
        el.currentTime = w.local;
        this.targets.set(el, w.local);
        changed = true;
      } else if (playing) this.targets.set(el, el.currentTime);
      if (playing && el.paused) {
        el.play().catch(() => {});
        changed = true;
      }
      if (!playing && !el.paused) {
        el.pause();
        changed = true;
      }
    }
    return changed;
  }

  pauseAll(): void {
    for (const el of this.audios.values()) if (!el.paused) el.pause();
  }

  dispose(): void {
    this.pauseAll();
    for (const el of this.audios.values()) {
      el.removeAttribute("src");
      el.load();
    }
    this.audios.clear();
    this.visuals.clear();
    this.loading.clear();
  }
}

type FrameMeta = { mediaTime: number; presentedFrames: number };
type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: FrameMeta) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/**
 * Waits until the video has actually presented a decoded frame for time t.
 *
 * Writing `currentTime` starts an async seek, and browsers can fire `seeked`/`canplay`
 * before the new picture reaches the compositor. Drawing at that point captures the
 * previous frame (or black), which is what shows up as a flicker in a rendered file and
 * in the editor preview while scrubbing. `requestVideoFrameCallback` is the only signal
 * that a real frame was presented, so it is preferred; the legacy events remain a
 * fallback for browsers that lack it, and a timeout bounds every case.
 */
export function waitForFrame(pool: MediaPool, p: Project, t: number, timeout = 1500): Promise<void> {
  const a = activeClipAt(p, t);
  const v = a ? pool.visuals.get(a.clip.mediaId) : undefined;
  if (!(v instanceof HTMLVideoElement)) return Promise.resolve();
  const target = a ? a.local : v.currentTime;
  const video = v as VideoWithFrameCallback;

  // Already sitting on a decoded frame at the target position — nothing to wait for.
  if (!v.seeking && v.readyState >= 2 && Math.abs(v.currentTime - target) < 0.004) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    let cbHandle = 0;
    let timer = 0;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      v.removeEventListener("seeked", onSeeked);
      v.removeEventListener("canplay", onSeeked);
      if (cbHandle && video.cancelVideoFrameCallback) {
        try { video.cancelVideoFrameCallback(cbHandle); } catch { /* best effort */ }
      }
      resolve();
    };

    // A frame was presented. Reject one that clearly belongs to the old seek position;
    // WebM timestamps are coarse so allow a generous window rather than deadlocking.
    const onFrame = (_now: number, meta: FrameMeta) => {
      cbHandle = 0;
      if (Number.isFinite(meta?.mediaTime) && v.seeking && Math.abs(meta.mediaTime - target) > 0.3) {
        if (video.requestVideoFrameCallback) cbHandle = video.requestVideoFrameCallback(onFrame);
        return;
      }
      finish();
    };

    // On modern browsers the frame callback owns completion; `seeked` alone is not enough.
    const onSeeked = () => {
      if (!video.requestVideoFrameCallback) finish();
    };

    timer = window.setTimeout(finish, timeout);
    v.addEventListener("seeked", onSeeked);
    v.addEventListener("canplay", onSeeked);
    if (video.requestVideoFrameCallback) cbHandle = video.requestVideoFrameCallback(onFrame);

    // If the assignment hasn't started a seek yet, nudge it once. Some browsers don't set
    // the `seeking` flag synchronously after a currentTime write.
    if (!v.seeking && Math.abs(v.currentTime - target) >= 0.004) {
      try { v.currentTime = target; } catch { /* best effort */ }
    }
  });
}

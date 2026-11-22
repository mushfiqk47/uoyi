// Hybrid render pipeline:
// 1. Fast server FFmpeg path (/api/render/native?async=1): seeks straight to clip timestamps,
//    encodes at maximum multi-core/NVENC speed (often 2-15x realtime), keeps zero frame drops,
//    and streams live progress + FPS.
// 2. Optimized browser Canvas+MediaRecorder fallback when FFmpeg is unavailable or a job is paused.
import type { Media, Project } from "./types";
import { getBlob } from "./db";
import { drawFrame, frameReady, type Visual } from "./compositor";
import { MediaPool, waitForFrame } from "./playback";
import { projectDuration } from "./project";
import { hintForMotion, pickMime } from "./recorder";

export interface RenderOptions {
  height: 720 | 1080;
  fps: number;
  format: "webm" | "mp4";
  onWarning?: (message: string) => void;
}

export interface RenderProgress {
  progress: number;
  fps: number;
  remaining: number;
}

export interface RenderHandle {
  done: Promise<{ blob: Blob; mime: string }>;
  canPause(): boolean;
  pause(): void;
  resume(): void;
  cancel(): void;
}

export class RenderCancelled extends Error {}

const MAX_NATIVE_UPLOAD_BYTES = 450 * 1024 * 1024;
let cachedFfmpegHealth: { ok: boolean; at: number } | null = null;

async function hasServerFfmpeg(): Promise<boolean> {
  const now = Date.now();
  // Positive results are trusted for 10s; a failed health check is retried sooner so a
  // server that just came up is picked up without waiting out the whole cache window.
  if (cachedFfmpegHealth && cachedFfmpegHealth.ok && now - cachedFfmpegHealth.at < 10_000) return true;
  if (cachedFfmpegHealth && !cachedFfmpegHealth.ok && now - cachedFfmpegHealth.at < 2_000) return false;
  try {
    const res = await fetch("/api/health", { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return false;
    const data = await res.json();
    const ok = Boolean(data?.ffmpeg);
    cachedFfmpegHealth = { ok, at: now };
    return ok;
  } catch {
    cachedFfmpegHealth = { ok: false, at: now };
    return false;
  }
}

function mimeFor(format: "webm" | "mp4"): string {
  if (format === "mp4") {
    for (const m of ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4;codecs=avc1", "video/mp4"]) if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return pickMime();
}

function decodable(v: Visual | undefined): boolean {
  if (!v) return false;
  if (v instanceof HTMLVideoElement) return v.readyState >= 2 && v.videoWidth > 0;
  return v.complete && v.naturalWidth > 0;
}

/** Refuses to start a render whose footage did not decode, instead of producing a silent black file. */
function assertFootage(p: Project, pool: MediaPool): void {
  const missing = new Map<string, Media | null>();
  for (const clip of p.video) {
    if (decodable(pool.visuals.get(clip.mediaId))) continue;
    if (!missing.has(clip.mediaId)) missing.set(clip.mediaId, p.media.find((m) => m.id === clip.mediaId) ?? null);
  }
  if (!missing.size) return;
  const names = [...new Set([...missing.values()].map((m) => m?.name ?? "a missing file"))].slice(0, 3).join(", ");
  throw new Error(`Can't render: ${names} didn't load. Re-import the file, then render again.`);
}

async function tryNativeFfmpegRender(
  p: Project,
  opts: RenderOptions,
  duration: number,
  onProgress: (r: RenderProgress) => void,
  state: { cancelled: boolean; setAbort: (fn: () => void) => void },
): Promise<{ blob: Blob; mime: string } | null> {
  if (!p.video.length) return null;
  if (!(await hasServerFfmpeg())) return null;

  // Gather unique media blobs referenced by video clips and music tracks.
  const referencedIds = new Set<string>();
  for (const v of p.video) referencedIds.add(v.mediaId);
  for (const m of p.music) if (!m.auto) referencedIds.add(m.mediaId);

  const blobs = new Map<string, { blob: Blob; name: string }>();
  let totalBytes = 0;
  for (const mediaId of referencedIds) {
    const meta = p.media.find((m) => m.id === mediaId);
    if (!meta) return null;
    const blob = await getBlob(meta.blobKey);
    if (!blob || !blob.size) return null;
    totalBytes += blob.size;
    if (totalBytes > MAX_NATIVE_UPLOAD_BYTES) return null;
    blobs.set(mediaId, { blob, name: meta.name || `${mediaId}.bin` });
  }

  const targetFps = Math.max(60, Math.round(Number(opts.fps) || 60));
  const W = opts.height;
  const H = opts.height === 1080 ? 1920 : 1280;
  const form = new FormData();
  form.append("project", JSON.stringify(p));
  form.append("width", String(W));
  form.append("height", String(H));
  form.append("fps", String(targetFps));
  form.append("format", opts.format);
  for (const [mediaId, entry] of blobs) {
    form.append(`media_${mediaId}`, entry.blob, entry.name);
  }

  let jobId: string | null = null;
  let xhr: XMLHttpRequest | null = null;
  let aborted = false;

  const cancelNative = () => {
    aborted = true;
    try { xhr?.abort(); } catch { /* best effort */ }
    if (jobId) {
      fetch(`/api/render/native/abort?id=${encodeURIComponent(jobId)}`, { method: "POST" }).catch(() => {});
    }
  };
  state.setAbort(cancelNative);

  if (state.cancelled) throw new RenderCancelled();

  // Upload media + start async FFmpeg job
  const started = await new Promise<{ id: string }>((resolve, reject) => {
    const req = new XMLHttpRequest();
    xhr = req;
    req.open("POST", "/api/render/native?async=1");
    req.upload.onprogress = (e) => {
      if (aborted || state.cancelled || !e.lengthComputable) return;
      const frac = e.total > 0 ? e.loaded / e.total : 0;
      onProgress({ progress: Math.min(0.15, frac * 0.15), fps: targetFps, remaining: duration });
    };
    req.onload = () => {
      xhr = null;
      if (aborted || state.cancelled) return reject(new RenderCancelled());
      if (req.status < 200 || req.status >= 300) {
        return reject(new Error(`Native upload failed (${req.status})`));
      }
      try {
        resolve(JSON.parse(req.responseText));
      } catch {
        reject(new Error("Invalid native render response"));
      }
    };
    req.onerror = () => { xhr = null; reject(new Error("Network error uploading render")); };
    req.onabort = () => { xhr = null; reject(new RenderCancelled()); };
    req.send(form);
  });

  jobId = started.id;
  if (state.cancelled) {
    cancelNative();
    throw new RenderCancelled();
  }

  // Poll FFmpeg live progress. A job that stops reporting progress for 60s is dead (crashed
  // worker, OOM kill) — give up with a clear error instead of polling forever.
  let lastProgressAt = Date.now();
  let lastProgress = -1;
  while (!state.cancelled && !aborted) {
    const statusRes = await fetch(`/api/render/native/status?id=${encodeURIComponent(jobId)}`);
    if (!statusRes.ok) throw new Error(`Lost connection to render job (${statusRes.status})`);
    const st = await statusRes.json().catch(() => null);
    if (!st || typeof st !== "object") throw new Error("Invalid status response from render job");
    if (st.status === "cancelled") throw new RenderCancelled();
    if (st.status === "failed") throw new Error(st.error || "FFmpeg render failed");
    if (st.status === "done") break;
    const prog = Number(st.progress) || 0;
    if (prog !== lastProgress) {
      lastProgress = prog;
      lastProgressAt = Date.now();
    } else if (Date.now() - lastProgressAt > 60_000) {
      cancelNative();
      throw new Error("Render job stalled on the server (no progress for 60s)");
    }
    onProgress({
      progress: Math.min(0.97, 0.15 + prog * 0.82),
      fps: Number(st.fps) || 0,
      remaining: Math.max(0, Number(st.remaining) || 0),
    });
    await new Promise((r) => setTimeout(r, 100));
  }

  if (state.cancelled || aborted) {
    cancelNative();
    throw new RenderCancelled();
  }

  const resultRes = await fetch(`/api/render/native/result?id=${encodeURIComponent(jobId)}`);
  if (!resultRes.ok) throw new Error(`Failed to fetch rendered file (${resultRes.status})`);
  const blob = await resultRes.blob().catch(() => null);
  if (!blob || !blob.size) throw new Error("Rendered file came back empty — try again");
  const mime = opts.format === "webm" ? "video/webm" : "video/mp4";
  onProgress({ progress: 1, fps: targetFps, remaining: 0 });
  return { blob, mime };
}

export function startRender(p: Project, opts: RenderOptions, onProgress: (r: RenderProgress) => void): RenderHandle {
  // opts.height is the short-side quality (720 or 1080). Output is a 9:16 canvas: 720x1280 or 1080x1920.
  const W = opts.height;
  const H = opts.height === 1080 ? 1920 : 1280;
  const duration = projectDuration(p);

  let paused = false;
  let cancelled = false;
  let browserCapture = false;
  let rec: MediaRecorder | null = null;
  let raf = 0;
  let nativeAbort: (() => void) | null = null;
  let pool: MediaPool | null = null;
  let audioCtx: AudioContext | null = null;
  /** Set by the browser-capture path; pause/resume route through it (see syncRecorderState). */
  let syncRun: (() => void) | null = null;
  let rejectDone: (e: Error) => void = () => {};

  const done = new Promise<{ blob: Blob; mime: string }>((resolve, reject) => {
    rejectDone = reject;
    (async () => {
      if (duration <= 0) throw new Error("Nothing on the timeline");

      // Fast path: server-side FFmpeg native render (2-15x faster than realtime, zero tab-focus requirement)
      try {
        const nativeResult = await tryNativeFfmpegRender(p, opts, duration, onProgress, {
          get cancelled() { return cancelled; },
          setAbort(fn) { nativeAbort = fn; },
        });
        if (nativeResult) {
          resolve(nativeResult);
          return;
        }
      } catch (err) {
        if (err instanceof RenderCancelled || cancelled) throw new RenderCancelled();
        // Native failed — fall back to browser capture, but say why so users understand
        // the constraints (browser capture needs the tab visible).
        const why = err instanceof Error ? err.message : "unknown error";
        opts.onWarning?.(`Server renderer unavailable (${why}). Using browser capture — keep this tab visible.`);
      }
      nativeAbort = null;
      if (cancelled) throw new RenderCancelled();

      // Optimized browser Canvas + MediaRecorder fallback
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true }) || canvas.getContext("2d", { alpha: false })!;
      audioCtx = new AudioContext();
      const dest = audioCtx.createMediaStreamDestination();
      pool = new MediaPool({ ctx: audioCtx, dest });

      await pool.ensure(p.media);
      await document.fonts.ready;
      await audioCtx.resume().catch(() => {});
      pool.sync(p, 0, false, true);
      await waitForFrame(pool, p, 0);
      if (cancelled) throw new RenderCancelled();
      assertFootage(p, pool);

      const mime = mimeFor(opts.format);
      if (!mime) throw new Error("This browser can't record video");

      // captureStream(0) + track.requestFrame() gives MediaRecorder exactly one frame per
      // canvas draw. The default captureStream(fps) auto-samples the canvas instead, so any
      // draw stall (background tab throttles rAF to zero, a seek that misses the frame
      // budget) gets filled with repeated copies of the last frame — the classic "frozen
      // frames" bug in captured renders. Manual pumping can't duplicate: no requestFrame,
      // no frame. Browsers without requestFrame (old Firefox) fall back to auto sampling.
      const s0 = canvas.captureStream(0);
      const s0Track = s0.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
      const manualPump = Boolean(s0Track && typeof s0Track.requestFrame === "function");
      let videoTrack: MediaStreamTrack | null = null;
      const targetFps = Math.max(60, Math.round(Number(opts.fps) || 60));
      if (manualPump && s0Track) {
        videoTrack = s0Track;
      } else {
        for (const tr of s0.getTracks()) tr.stop();
        videoTrack = canvas.captureStream(targetFps).getVideoTracks()[0] ?? null;
      }
      if (!videoTrack) throw new Error("Couldn't open a canvas video track for recording");
      const pushFrame = () => {
        if (!manualPump) return;
        try { (videoTrack as CanvasCaptureMediaStreamTrack).requestFrame(); } catch { /* track closed */ }
      };
      videoTrack.addEventListener("ended", () => {
        if (!cancelled) rejectDone(new Error("Canvas video track ended unexpectedly"));
      });

      const stream = new MediaStream([videoTrack, ...dest.stream.getAudioTracks()]);
      hintForMotion(stream);
      rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: W >= 1080 ? 8_000_000 : 4_500_000 });
      rec.onerror = (event) => {
        // TS's lib.dom no longer ships MediaRecorderErrorEvent; the payload is a DOMException.
        const detail = (event as unknown as { error?: { message?: string } }).error?.message || "media recording failed";
        cancelled = true;
        cleanupBrowser();
        cancelAnimationFrame(raf);
        pool?.dispose();
        audioCtx?.close().catch(() => {});
        rejectDone(new Error(`Recorder error: ${detail}`));
      };
      const chunks: Blob[] = [];
      let t = 0;
      let last = 0;
      let frames = 0;
      let stalled = 0;
      let fpsWindowStart = 0;
      let fps = 0;

      // Browser capture only produces live frames while the tab is visible. A hidden tab
      // pauses the whole pipeline instead of recording identical frames; it resumes on return.
      let hiddenPaused = document.hidden;
      let holdForFrame = false;
      let warnedHidden = false;
      const running = () => !paused && !hiddenPaused && !holdForFrame;
      const cleanupBrowser = () => document.removeEventListener("visibilitychange", onVisibility);
      function onVisibility() {
        hiddenPaused = document.hidden;
        if (hiddenPaused && !warnedHidden) {
          warnedHidden = true;
          opts.onWarning?.("Render paused — browser capture needs this tab visible. It resumes when you come back.");
        }
        if (!hiddenPaused) last = performance.now();
        syncRecorderState();
      }
      /** Pauses/unpauses the recorder and media pool together so audio and video never drift. */
      const syncRecorderState = () => {
        if (!rec) return;
        const run = running();
        if (!run) {
          pool?.pauseAll();
          if (rec.state === "recording") rec.pause();
        } else if (rec.state === "paused") {
          rec.resume();
        }
      };
      // Queue pause/resume (the outer pause()/resume()) goes through the same state machine
      // so user pauses, tab hiding, and decode holds can never fight each other.
      syncRun = syncRecorderState;
      browserCapture = true;
      document.addEventListener("visibilitychange", onVisibility);

      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        cleanupBrowser();
        pool?.dispose();
        audioCtx?.close().catch(() => {});
        if (cancelled) reject(new RenderCancelled());
        else {
          if (stalled) opts.onWarning?.(`${stalled} frame${stalled === 1 ? "" : "s"} arrived late — recording paused there instead of repeating frames.`);
          resolve({ blob: new Blob(chunks, { type: mime.split(";")[0] }), mime });
        }
      };

      await audioCtx.resume().catch(() => {});
      // Put the first real frame on the canvas before the recorder opens so frame zero is
      // never blank.
      pool.sync(p, 0, false, true);
      if (!frameReady(p, 0, pool.visuals)) await waitForFrame(pool, p, 0);
      drawFrame(ctx, W, H, { project: p, time: 0, duration, visuals: pool.visuals, includeOverlay: false });
      pushFrame();

      rec.start(1000);
      last = performance.now();
      fpsWindowStart = last;

      const step = (now: number) => {
        if (cancelled) return;
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        if (running()) {
          t += dt;
          pool!.sync(p, t, true);
          if (!frameReady(p, t, pool!.visuals)) {
            // The active clip's next frame isn't decoded yet (typical right after a cut).
            // Hold: pause pool + recorder together, then release when it decodes. Advancing
            // anyway would record repeated frames; holding pauses both sides so A/V stays
            // in sync and nothing stale is written.
            holdForFrame = true;
            stalled += 1;
            syncRecorderState();
          } else {
            drawFrame(ctx, W, H, { project: p, time: t, duration, visuals: pool!.visuals, includeOverlay: false });
            pushFrame();
            frames++;
            if (now - fpsWindowStart >= 1000) {
              fps = (frames * 1000) / (now - fpsWindowStart);
              frames = 0;
              fpsWindowStart = now;
            }
            onProgress({ progress: Math.min(1, t / duration), fps, remaining: Math.max(0, duration - t) });
            if (t >= duration) {
              pool!.pauseAll();
              rec?.stop();
              return;
            }
          }
        } else if (holdForFrame && !paused && !hiddenPaused && frameReady(p, t, pool!.visuals)) {
          // Frame decoded while held: resume playback at the same t and unpause the recorder.
          holdForFrame = false;
          pool!.sync(p, t, true);
          drawFrame(ctx, W, H, { project: p, time: t, duration, visuals: pool!.visuals, includeOverlay: false });
          pushFrame();
          syncRecorderState();
        }
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    })().catch((e) => {
      pool?.dispose();
      audioCtx?.close().catch(() => {});
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });

  return {
    done,
    canPause() {
      return browserCapture;
    },
    pause() {
      if (!browserCapture || paused) return;
      paused = true;
      pool?.pauseAll();
      syncRun?.();
    },
    resume() {
      if (!paused) return;
      paused = false;
      syncRun?.();
    },
    cancel() {
      cancelled = true;
      cancelAnimationFrame(raf);
      nativeAbort?.();
      if (rec && rec.state !== "inactive") rec.stop();
      else {
        pool?.dispose();
        audioCtx?.close().catch(() => {});
        rejectDone(new RenderCancelled());
      }
    },
  };
}

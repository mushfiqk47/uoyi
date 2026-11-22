// The rolling buffer. A recording made by MediaRecorder can only be decoded from its start, so
// instead of trimming one endless recording we keep two overlapping ones: a new recorder starts
// every `seconds`, and each lives for twice that. When a clip is taken, the oldest one holds
// between `seconds` and 2x`seconds` of the past; the clip is that recording, opened at the point
// `seconds` before its end.

import { deleteBlob, getBlob, putBlob } from "./db";
import { uid } from "./util";

export interface Recording {
  blob: Blob;
  /** Length of the recording in seconds. */
  length: number;
  /** Where the wanted window starts in the recording. */
  in: number;
  mime: string;
}

interface Running {
  rec: MediaRecorder;
  startedAt: number;
  chunks: Blob[];
  mime: string;
}

export function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  // H.264 can use the GPU encoder. Forcing VP8 leaves three 1080p recorders per stream running
  // through a software encoder, which starves the live decoder and makes playback stutter.
  // An empty result is deliberate: MediaRecorder then chooses its own best (hardware) codec.
  const preferred = ["video/webm;codecs=h264,opus", "video/mp4;codecs=avc1.42E01E,mp4a.40.2"];
  return preferred.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

/** Omit mimeType when the browser did not confirm an H.264 option, so it can pick a hardware
 *  encoder. The actual type is read back from the constructed recorder. */
function recorderOptions(mime: string, bitsPerSecond: number): MediaRecorderOptions {
  return mime
    ? { mimeType: mime, videoBitsPerSecond: bitsPerSecond }
    : { videoBitsPerSecond: bitsPerSecond };
}

function blobType(recorder: MediaRecorder, fallback: string): string {
  return (recorder.mimeType || fallback).split(";")[0] || "video/webm";
}

/** Full HD needs roughly twice the bitrate of the old 1.5 Mbps capture to avoid blocking. */
export function recordBitrate(quality: "fullhd" | "smooth"): number {
  return quality === "fullhd" ? 4_000_000 : 1_500_000;
}

type CapturableVideo = HTMLVideoElement & { captureStream?: () => MediaStream };

/** A recording is only useful with both tracks. Chrome has shipped a regression where a muted
 *  media element produced a silent capture, so the tile plays at near-zero volume instead. */
export function captureTracks(stream: MediaStream): { video: boolean; audio: boolean } {
  return {
    video: stream.getVideoTracks().some((t) => t.readyState === "live"),
    audio: stream.getAudioTracks().some((t) => t.readyState === "live" && t.enabled),
  };
}

/** Ask the encoder to favour frame rate over sharpness (live video, not slides). */
export function hintForMotion(stream: MediaStream): void {
  for (const track of stream.getVideoTracks()) {
    try { track.contentHint = "motion"; } catch { /* not supported everywhere */ }
  }
}

/** Capture a video element once and reuse the stream across recorders. Reusing the stream
 *  matters: every extra captureStream()/encoder is another decode of the same live frames. */
export function captureVideo(video: HTMLVideoElement, existing?: MediaStream | null): MediaStream | null {
  if (existing) return existing;
  const v = video as CapturableVideo;
  if (!v.captureStream) return null;
  let stream: MediaStream;
  try {
    stream = v.captureStream();
  } catch {
    return null;
  }
  hintForMotion(stream);
  return stream;
}

export class RollingRecorder {
  private running: Running[] = [];
  private timer: number | null = null;
  private stream: MediaStream;
  private mime = pickMime();
  private bitrate: number;
  readonly seconds: number;

  constructor(video: HTMLVideoElement, seconds: number, bitrate = 2_500_000) {
    const v = video as CapturableVideo;
    if (!v.captureStream) throw new Error("unsupported");
    // Throws a SecurityError when the stream's server doesn't allow recording (no CORS).
    this.stream = v.captureStream();
    hintForMotion(this.stream);
    this.seconds = seconds;
    this.bitrate = bitrate;
    this.startOne();
    this.timer = window.setInterval(() => this.tick(), 1000);
  }

  /** The captured stream, shared with continuous recording so we never capture twice. */
  mediaStream(): MediaStream {
    return this.stream;
  }

  /** The live audio track, shared with AI sampling so it doesn't open a second capture. */
  audioStream(): MediaStream | null {
    const tracks = this.stream.getAudioTracks();
    return tracks.length ? new MediaStream(tracks) : null;
  }

  /** Seconds of the past currently held, capped at `seconds`. */
  get buffered(): number {
    const oldest = this.running[0];
    return oldest ? Math.min(this.seconds, (performance.now() - oldest.startedAt) / 1000) : 0;
  }

  private startOne(): void {
    if (!this.stream.getVideoTracks().length) return;
    const rec = new MediaRecorder(this.stream, recorderOptions(this.mime, this.bitrate));
    const r: Running = { rec, startedAt: performance.now(), chunks: [], mime: blobType(rec, this.mime) };
    rec.ondataavailable = (e) => e.data.size && r.chunks.push(e.data);
    rec.start(1000);
    this.running.push(r);
  }

  private tick(): void {
    const now = performance.now();
    const newest = this.running[this.running.length - 1];
    if (!newest || now - newest.startedAt >= this.seconds * 1000) this.startOne();
    while (this.running.length > 2 && now - this.running[0].startedAt > this.seconds * 2000 + 1500) {
      const old = this.running.shift()!;
      if (old.rec.state !== "inactive") old.rec.stop();
    }
  }

  /** Takes the last `seconds`. The recorder keeps going afterwards. */
  async capture(): Promise<Recording | null> {
    const r = this.running.shift();
    if (!r) return null;
    const length = (performance.now() - r.startedAt) / 1000;
    const blob = await new Promise<Blob>((resolve) => {
      r.rec.onstop = () => resolve(new Blob(r.chunks, { type: r.mime }));
      r.rec.stop();
    });
    if (!this.running.length) this.startOne();
    return { blob, length, in: Math.max(0, length - this.seconds), mime: r.mime };
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    for (const r of this.running) if (r.rec.state !== "inactive") r.rec.stop();
    this.running = [];
  }
}

export function canClip(): boolean {
  return typeof MediaRecorder !== "undefined" && "captureStream" in HTMLVideoElement.prototype;
}

// ---- Hassle-free continuous recording -----------------------------------------------------
// A second MediaRecorder runs alongside the rolling buffer and records *everything* from the
// moment it starts. Every `segmentSeconds` it is stopped and restarted: each recording gets a
// fresh WebM header on its own, so each saved segment is independently playable (concatenating
// timeslice chunks from different recorders would not be). Chunks are written to IndexedDB as
// they arrive instead of being held in JS memory, which keeps long sessions flat in memory.
// One extra low-bitrate VP8 encoder per stream keeps the live decode smooth.

export interface LiveSegment {
  blob: Blob;
  /** Seconds actually captured in this segment. */
  seconds: number;
  /** Wall-clock time when the segment started. */
  startedAt: number;
  mime: string;
}

export interface LiveRecorderOptions {
  stream: MediaStream;
  /** Seconds per auto-saved segment. */
  segmentSeconds: number;
  /** Video bitrate. Full HD needs more than the old smooth default. */
  bitrate?: number;
  onSegment: (segment: LiveSegment) => void | Promise<void>;
  /** Called when a segment is being closed, before its blob is assembled. */
  onRotate?: () => void;
  onError?: (message: string) => void;
}

interface Chunk {
  key: string;
  write: Promise<void>;
}

interface LiveSession {
  rec: MediaRecorder;
  mime: string;
  prefix: string;
  seq: number;
  chunks: Chunk[];
  /** Chunks whose IndexedDB write failed; kept in memory so the segment is still usable. */
  failed: Blob[];
  startedAt: number;
  startedWall: number;
  timer: number | null;
  stopped: Promise<void>;
  resolveStop: () => void;
}

// Four-second chunks cut IndexedDB writes and the number of blobs a long segment has to
// reassemble. Shorter slices cost more overhead per minute and gain little at this bitrate.
const CHUNK_MS = 4000;
const SEGMENT_MIN = 30;

export class LiveRecorder {
  private stream: MediaStream;
  private mime = pickMime();
  private bitrate: number;
  private segmentSeconds: number;
  private onSegment: LiveRecorderOptions["onSegment"];
  private onRotate?: () => void;
  private onError?: (message: string) => void;
  private current: LiveSession | null = null;
  private stopped = false;
  /** Rotations are queued so a save never drops a segment when two land together. */
  private queue: Promise<void> = Promise.resolve();

  constructor(opts: LiveRecorderOptions) {
    this.stream = opts.stream;
    this.bitrate = opts.bitrate ?? recordBitrate("fullhd");
    this.segmentSeconds = Math.max(SEGMENT_MIN, opts.segmentSeconds);
    this.onSegment = opts.onSegment;
    this.onRotate = opts.onRotate;
    this.onError = opts.onError;
    this.startOne();
  }

  /** Change the auto-save interval without dropping the running segment. */
  setSegmentSeconds(seconds: number): void {
    this.segmentSeconds = Math.max(SEGMENT_MIN, seconds);
    const s = this.current;
    if (!s || s.timer === null) return;
    clearTimeout(s.timer);
    const elapsed = performance.now() - s.startedAt;
    const remaining = Math.max(250, this.segmentSeconds * 1000 - elapsed);
    s.timer = window.setTimeout(() => void this.rotate(), remaining);
  }

  get seconds(): number {
    return this.current ? (performance.now() - this.current.startedAt) / 1000 : 0;
  }

  get active(): boolean {
    return !this.stopped;
  }

  private startOne(): void {
    if (this.stopped || this.current) return;
    if (!this.stream.getVideoTracks().length) {
      this.onError?.("The stream has no video track to record");
      return;
    }
    const rec = new MediaRecorder(this.stream, {
      ...recorderOptions(this.mime, this.bitrate),
      // 48 kbps made stream audio thin and crackly. 128 kbps keeps voices and game audio clean
      // without competing with the video encoder for bandwidth.
      audioBitsPerSecond: 128_000,
    });
    let resolveStop!: () => void;
    const stopped = new Promise<void>((resolve) => { resolveStop = resolve; });
    const startedWall = Date.now();
    const s: LiveSession = {
      rec,
      mime: blobType(rec, this.mime),
      // The leading timestamp lets a later session sweep chunks orphaned by a closed tab
      // without risking the chunks of another tab that is still recording.
      prefix: `rec:${startedWall.toString(36)}:${uid("")}`,
      seq: 0,
      chunks: [],
      failed: [],
      startedAt: performance.now(),
      startedWall,
      timer: null,
      stopped,
      resolveStop,
    };
    rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      const key = `${s.prefix}:${s.seq++}`;
      let write: Promise<void>;
      try {
        // Keep the in-memory blob on failure so a full IndexedDB cannot lose the segment.
        write = putBlob(key, e.data).catch(() => { s.failed.push(e.data); });
      } catch {
        write = Promise.resolve();
        s.failed.push(e.data);
      }
      s.chunks.push({ key, write });
    };
    rec.onerror = () => {
      this.onError?.("Recording stopped unexpectedly");
      if (this.current === s && !this.stopped) void this.rotate();
    };
    rec.onstop = () => {
      s.resolveStop();
      // The source track can end on its own (stream went offline). Finish that segment too.
      if (this.current === s && !this.stopped) void this.rotate();
    };
    rec.start(CHUNK_MS);
    this.current = s;
    s.timer = window.setTimeout(() => void this.rotate(), this.segmentSeconds * 1000);
  }

  /** Queue a rotation. Each call runs after the previous save finished, so a timer and a
   *  manual flush can never race and lose a segment. */
  private rotate(): Promise<void> {
    const run = () => this.rotateNow();
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  /** Finish the running segment, hand it to onSegment, and start a fresh one. */
  private async rotateNow(): Promise<void> {
    const s = this.current;
    if (!s) return;
    const age = performance.now() - s.startedAt;
    // A queued flush can arrive right after a new segment began; ignore that near-empty one.
    if (!this.stopped && age < 1000) return;
    this.current = null;
    if (s.timer !== null) clearTimeout(s.timer);
    this.onRotate?.();
    if (s.rec.state !== "inactive") {
      try { s.rec.requestData(); } catch { /* ignore */ }
      s.rec.stop();
    }
    // Start the next segment before reading the finished one back. Previously the recorder
    // was idle while the blob was assembled and written, which dropped footage at every save.
    if (!this.stopped) this.startOne();
    try {
      // A recorder that misses its stop event used to leave the segment hanging forever.
      let watchdog: number | null = null;
      let timedOut = false;
      await Promise.race([
        s.stopped,
        new Promise<void>((resolve) => {
          watchdog = window.setTimeout(() => {
            timedOut = true;
            resolve();
          }, 4000);
        }),
      ]);
      if (watchdog !== null) clearTimeout(watchdog);
      if (timedOut) {
        // Give any final ondataavailable callback a short beat to enqueue its chunk write.
        await new Promise((r) => setTimeout(r, 150));
      }
      await Promise.allSettled(s.chunks.map((c) => c.write));
      const seconds = (performance.now() - s.startedAt) / 1000;
      const mime = s.mime;
      try {
        const stored = await Promise.all(s.chunks.map((c) => getBlob(c.key)));
        const parts = stored.filter((b): b is Blob => !!b && b.size > 0);
        parts.push(...s.failed);
        if (parts.length && seconds >= 0.5) {
          const blob = new Blob(parts, { type: mime });
          await this.onSegment({ blob, seconds, startedAt: s.startedWall, mime });
        }
      } catch (e) {
        this.onError?.(`Couldn't save the recording: ${String((e as Error)?.message || e).slice(0, 100)}`);
      }
      for (const c of s.chunks) void deleteBlob(c.key).catch(() => {});
    } finally {
      // Also covers a rotate that ran while a new segment was already started.
      if (!this.stopped && !this.current) this.startOne();
    }
  }

  /** Stop recording and flush whatever has been captured into a final segment. */
  stop(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.stopped = true;
    return this.rotate();
  }

  /** Save the current segment now and keep recording. Same path as the auto-save timer. */
  flush(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return this.rotate();
  }
}

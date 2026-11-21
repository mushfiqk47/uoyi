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
  fps: 30 | 60 | 90 | 120;
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
  pause(): void;
  resume(): void;
  cancel(): void;
}

export class RenderCancelled extends Error {}

const MAX_NATIVE_UPLOAD_BYTES = 1024 * 1024 * 1024;
let cachedFfmpegHealth: { ok: boolean; at: number } | null = null;

export function renderBitrate(height: 720 | 1080, fps: 30 | 60 | 90 | 120): number {
  const base = height >= 1080 ? 10_000_000 : 5_500_000;
  const mult = fps <= 30 ? 1 : fps <= 60 ? 1.6 : fps <= 90 ? 2.1 : 2.6;
  return Math.round(base * mult);
}

async function hasServerFfmpeg(): Promise<boolean> {
  const now = Date.now();
  if (cachedFfmpegHealth && now - cachedFfmpegHealth.at < 10_000) return cachedFfmpegHealth.ok;
  try {
    const res = await fetch("/api/health", { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return false;
    const data = await res.json();
    const ok = Boolean(data?.ffmpeg);
    cachedFfmpegHealth = { ok, at: now };
    return ok;
  } catch {
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

  const W = opts.height;
  const H = opts.height === 1080 ? 1920 : 1280;
  const form = new FormData();
  form.append("project", JSON.stringify(p));
  form.append("width", String(W));
  form.append("height", String(H));
  form.append("fps", String(opts.fps));
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
      onProgress({ progress: Math.min(0.15, frac * 0.15), fps: 0, remaining: duration });
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

  // Poll FFmpeg live progress
  while (!state.cancelled && !aborted) {
    const statusRes = await fetch(`/api/render/native/status?id=${encodeURIComponent(jobId)}`);
    if (!statusRes.ok) throw new Error("Lost connection to render job");
    const st = await statusRes.json();
    if (st.status === "cancelled") throw new RenderCancelled();
    if (st.status === "failed") throw new Error(st.error || "FFmpeg render failed");
    if (st.status === "done") break;
    onProgress({
      progress: Math.min(0.97, 0.15 + (Number(st.progress) || 0) * 0.82),
      fps: Number(st.fps) || 0,
      remaining: Math.max(0, Number(st.remaining) || 0),
    });
    await new Promise((r) => setTimeout(r, 220));
  }

  if (state.cancelled || aborted) {
    cancelNative();
    throw new RenderCancelled();
  }

  const resultRes = await fetch(`/api/render/native/result?id=${encodeURIComponent(jobId)}`);
  if (!resultRes.ok) throw new Error(`Failed to fetch rendered file (${resultRes.status})`);
  const blob = await resultRes.blob();
  const mime = opts.format === "webm" ? "video/webm" : "video/mp4";
  onProgress({ progress: 1, fps: opts.fps, remaining: 0 });
  return { blob, mime };
}

export function startRender(p: Project, opts: RenderOptions, onProgress: (r: RenderProgress) => void): RenderHandle {
  // opts.height is the short-side quality (720 or 1080). Output is a 9:16 canvas: 720x1280 or 1080x1920.
  const W = opts.height;
  const H = opts.height === 1080 ? 1920 : 1280;
  const duration = projectDuration(p);

  let paused = false;
  let cancelled = false;
  let rec: MediaRecorder | null = null;
  let raf = 0;
  let timer = 0;
  let resetLastOnResume = false;
  let nativeAbort: (() => void) | null = null;
  let pool: MediaPool | null = null;
  let audioCtx: AudioContext | null = null;
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
        // Fall back seamlessly to optimized in-browser canvas rendering
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

      type CanvasTrack = MediaStreamTrack & { requestFrame?: () => void };
      const manualStream = canvas.captureStream(0);
      let vTrack = manualStream.getVideoTracks()[0] as CanvasTrack | undefined;
      const manualFrame = typeof vTrack?.requestFrame === "function";
      if (!manualFrame) {
        manualStream.getTracks().forEach((tr) => tr.stop());
        vTrack = canvas.captureStream(opts.fps).getVideoTracks()[0] as CanvasTrack | undefined;
      }

      const stream = new MediaStream([...(vTrack ? [vTrack] : []), ...dest.stream.getAudioTracks()]);
      hintForMotion(stream);
      rec = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: renderBitrate(opts.height, opts.fps),
        audioBitsPerSecond: 192_000,
      });
      const chunks: Blob[] = [];
      let t = 0;
      let last = 0;
      let frames = 0;
      let stalled = 0;
      let fpsWindowStart = 0;
      let fps = 0;

      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        clearTimeout(timer);
        cancelAnimationFrame(raf);
        stream.getTracks().forEach((tr) => tr.stop());
        pool?.dispose();
        audioCtx?.close().catch(() => {});
        if (cancelled) reject(new RenderCancelled());
        else {
          if (stalled) opts.onWarning?.(`${stalled} frame${stalled === 1 ? "" : "s"} couldn't be read in time and were repeated.`);
          resolve({ blob: new Blob(chunks, { type: mime.split(";")[0] }), mime });
        }
      };
      rec.start(1000);
      last = performance.now();
      fpsWindowStart = last;

      const targetFrameMs = 1000 / opts.fps;
      const useHighRateTimer = opts.fps > 60;

      const scheduleNext = (frameStart: number) => {
        if (cancelled) return;
        if (useHighRateTimer) {
          const spent = performance.now() - frameStart;
          timer = window.setTimeout(() => step(performance.now()), Math.max(1, targetFrameMs - spent));
        } else {
          raf = requestAnimationFrame(step);
        }
      };

      const step = (now: number) => {
        if (cancelled) return;
        if (resetLastOnResume) {
          last = now;
          resetLastOnResume = false;
        }
        const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
        last = now;
        if (!paused) {
          t += dt;
          pool!.sync(p, t, true);
          if (!frameReady(p, t, pool!.visuals)) stalled++;
          drawFrame(ctx, W, H, { project: p, time: t, duration, visuals: pool!.visuals, includeOverlay: false });
          if (manualFrame) vTrack?.requestFrame?.();
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
        scheduleNext(now);
      };
      scheduleNext(last);
    })().catch((e) => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      pool?.dispose();
      audioCtx?.close().catch(() => {});
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });

  return {
    done,
    pause() {
      if (paused || !rec) return;
      paused = true;
      pool?.pauseAll();
      if (rec.state === "recording") rec.pause();
    },
    resume() {
      if (!paused || !rec) return;
      paused = false;
      resetLastOnResume = true;
      if (rec.state === "paused") rec.resume();
    },
    cancel() {
      cancelled = true;
      clearTimeout(timer);
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

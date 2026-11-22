"use strict";

// Fast FFmpeg native timeline rendering.
// The browser renderer in src/lib/render.ts uses POST /api/render/native?async=1
// when server FFmpeg is available, falling back to browser Canvas+MediaRecorder otherwise.

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { json, fail, readJson, sendFile } = require("../lib/http.cjs");
const { readMultipart, boundaryOf } = require("../lib/multipart.cjs");
const { ROOT, run, encoderArgs, probe } = require("../lib/proc.cjs");
const { tempDir } = require("../lib/files.cjs");
const { getFreeDiskBytes, sanitizeFileName } = require("../lib/paths.cjs");
const { log } = require("../lib/logger.cjs");
const { id } = require("../lib/id.cjs");
const { resolveMediaJob } = require("../state.cjs");
const { getWorkspaceConfig, copyToWorkspaceExports } = require("../services/workspace.cjs");
const { clampNumber, writeOverlayAss, filterPath } = require("../lib/ass.cjs");

const FONTS_DIR = path.join(ROOT, "public", "fonts");

const nativeJobs = new Map(); // native render id -> job state
const RENDER_TTL = 30 * 60 * 1000;

const renderTimer = setInterval(() => {
  const cutoff = Date.now() - RENDER_TTL;
  for (const [key, job] of nativeJobs) {
    if (job.at < cutoff && job.status !== "rendering") {
      nativeJobs.delete(key);
      fsp.rm(job.dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}, 5 * 60 * 1000);
renderTimer.unref?.();

function atempoFilters(speed) {
  const filters = [];
  let value = Math.max(0.25, Math.min(4, Number(speed) || 1));
  while (value < 0.5) {
    filters.push("atempo=0.5");
    value *= 2;
  }
  while (value > 2) {
    filters.push("atempo=2");
    value /= 2;
  }
  filters.push(`atempo=${value.toFixed(6)}`);
  return filters;
}

function buildClipLayoutFilter(inPad, outPad, idx, layout, width, height, fps) {
  const mode = layout?.mode || "fill";
  const z = clampNumber(layout?.zoom, 0.5, 4, 1);
  const px = clampNumber(layout?.panX, -1, 1, 0);
  const py = clampNumber(layout?.panY, -1, 1, 0);

  if (mode === "fit") {
    const fgW = Math.max(2, Math.round((width * z) / 2) * 2);
    const fgH = Math.max(2, Math.round((height * z) / 2) * 2);
    const ox = `(W-w)/2+(${(px * width * 0.5).toFixed(1)})`;
    const oy = `(H-h)/2+(${(py * height * 0.5).toFixed(1)})`;
    return (
      `[${inPad}]split=2[bg${idx}][fg${idx}];` +
      `[bg${idx}]scale=135:240:force_original_aspect_ratio=increase:flags=fast_bilinear,crop=135:240,boxblur=4:1,eq=brightness=-0.15,scale=${width}:${height}:flags=bilinear[bgo${idx}];` +
      `[fg${idx}]scale=${fgW}:${fgH}:force_original_aspect_ratio=decrease:flags=bilinear[fgo${idx}];` +
      `[bgo${idx}][fgo${idx}]overlay=${ox}:${oy},setsar=1,fps=${fps}[${outPad}]`
    );
  }

  if (mode === "split") {
    const camH = Math.max(4, Math.min(height - 4, Math.round((height * clampNumber(layout?.facecamShare, 0.15, 0.7, 0.3)) / 2) * 2));
    const mainH = height - camH;
    const fc = layout?.facecam || { x: 0.68, y: 0.04, w: 0.3, h: 0.3 };
    const fx = clampNumber(fc.x, 0, 0.95, 0.68).toFixed(4);
    const fy = clampNumber(fc.y, 0, 0.95, 0.04).toFixed(4);
    const fw = clampNumber(fc.w, 0.05, 1, 0.3).toFixed(4);
    const fh = clampNumber(fc.h, 0.05, 1, 0.3).toFixed(4);
    return (
      `[${inPad}]split=2[cam${idx}][main${idx}];` +
      `[cam${idx}]crop='max(2,trunc(iw*${fw}/2)*2)':'max(2,trunc(ih*${fh}/2)*2)':'max(0,min(iw-ow,trunc(iw*${fx})))':'max(0,min(ih-oh,trunc(ih*${fy})))',` +
      `scale='trunc(max(${width},iw*${camH}/ih)/2)*2':'trunc(max(${camH},ih*${width}/iw)/2)*2':flags=fast_bilinear,crop=${width}:${camH},drawbox=x=0:y=0:w=${width}:h=2:color=black@0.6:t=fill,setsar=1[camo${idx}];` +
      `[main${idx}]scale='trunc(max(${width}*${z},iw*${mainH}*${z}/ih)/2)*2':'trunc(max(${mainH}*${z},ih*${width}*${z}/iw)/2)*2':flags=fast_bilinear,` +
      `crop=${width}:${mainH}:'max(0,min(iw-${width},(iw-${width})/2+(${px.toFixed(4)})*(iw-${width})/2))':'max(0,min(ih-${mainH},(ih-${mainH})/2+(${py.toFixed(4)})*(ih-${mainH})/2))',setsar=1[maino${idx}];` +
      `[maino${idx}][camo${idx}]vstack=inputs=2,setsar=1,fps=${fps}[${outPad}]`
    );
  }

  if (Math.abs(z - 1) < 0.001 && Math.abs(px) < 0.001 && Math.abs(py) < 0.001) {
    return `[${inPad}]scale=${width}:${height}:force_original_aspect_ratio=increase:flags=fast_bilinear,crop=${width}:${height}:(iw-${width})/2:(ih-${height})/2,setsar=1,fps=${fps}[${outPad}]`;
  }
  return (
    `[${inPad}]scale='trunc(max(${width}*${z},iw*${height}*${z}/ih)/2)*2':'trunc(max(${height}*${z},ih*${width}*${z}/iw)/2)*2':flags=fast_bilinear,` +
    `crop=${width}:${height}:'max(0,min(iw-${width},(iw-${width})/2+(${px.toFixed(4)})*(iw-${width})/2))':'max(0,min(ih-${height},(ih-${height})/2+(${py.toFixed(4)})*(ih-${height})/2))',setsar=1,fps=${fps}[${outPad}]`
  );
}

async function prepareNativeFfmpegRun(dir, project, mediaFiles, { width, height, fps, format }) {
  const clips = Array.isArray(project.video) ? project.video : [];
  if (!clips.length) throw new Error("Native render requires at least one video clip");

  const mediaList = Array.isArray(project.media) ? project.media : [];
  const musicList = Array.isArray(project.music) ? project.music : [];
  const probedCache = new Map();
  const getProbe = async (file) => {
    if (!probedCache.has(file)) probedCache.set(file, await probe(file));
    return probedCache.get(file);
  };

  const args = ["-y", "-hide_banner", "-loglevel", "error", "-progress", "pipe:1"];
  const filters = [];
  const vOutPads = [];
  const aOutPads = [];
  const consumedAutoIds = new Set();
  let totalDuration = 0;

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const filePath = mediaFiles.get(clip.mediaId) || mediaFiles.get("default");
    if (!filePath || !fs.existsSync(filePath)) throw new Error(`Missing media file for clip ${clip.mediaId}`);
    const mediaMeta = mediaList.find((m) => m.id === clip.mediaId);
    const info = await getProbe(filePath);
    const isImage =
      mediaMeta?.kind === "image" ||
      (mediaMeta?.kind !== "video" && /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(filePath));
    if (!info.hasVideo) throw new Error("The source has no readable video track");

    const start = Math.max(0, Number(clip.in) || 0);
    const end = Math.max(start + 0.05, Number(clip.out) || start + 0.05);
    const speed = isImage ? 1 : clampNumber(clip.speed, 0.25, 4, 1);
    const rawDur = end - start;
    const outDur = rawDur / speed;
    const timelineStart = totalDuration;
    totalDuration += outDur;

    if (isImage) {
      args.push("-loop", "1", "-t", outDur.toFixed(3), "-i", filePath);
    } else {
      if (start > 0.01) args.push("-ss", start.toFixed(3));
      args.push("-t", rawDur.toFixed(3), "-i", filePath);
    }

    const vIn = `vs${i}`;
    const vOut = `vc${i}`;
    filters.push(`[${i}:v]setpts=${Math.abs(speed - 1) > 0.001 ? `(PTS-STARTPTS)/${speed.toFixed(6)}` : "PTS-STARTPTS"}[${vIn}]`);
    filters.push(buildClipLayoutFilter(vIn, vOut, i, project.layout, width, height, fps));
    vOutPads.push(`[${vOut}]`);

    // Match mirrored auto-audio track aligned to this video clip when unshifted
    const mirrored = musicList.find(
      (m) =>
        m.auto &&
        !consumedAutoIds.has(m.id) &&
        m.mediaId === clip.mediaId &&
        Math.abs((Number(m.start) || 0) - timelineStart) < 0.08 &&
        Math.abs((Number(m.in) || 0) - start) < 0.08,
    );
    if (mirrored) consumedAutoIds.add(mirrored.id);
    const vol = clampNumber(mirrored ? mirrored.volume : clip.volume, 0, 2, 1);
    if (!isImage && info.hasAudio && vol > 0.001) {
      filters.push(
        `[${i}:a]asetpts=PTS-STARTPTS,${atempoFilters(speed).join(",")},volume=${vol.toFixed(3)},aresample=48000:async=1,aformat=sample_fmts=fltp:channel_layouts=stereo[ac${i}]`,
      );
    } else {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${outDur.toFixed(3)},asetpts=PTS-STARTPTS[ac${i}]`);
    }
    aOutPads.push(`[ac${i}]`);
  }

  let videoPad = vOutPads.length === 1 ? "vc0" : "vconcat";
  let audioPad = aOutPads.length === 1 ? "ac0" : "aconcat";
  if (vOutPads.length > 1) {
    filters.push(`${vOutPads.join("")}concat=n=${vOutPads.length}:v=1:a=0[${videoPad}]`);
    filters.push(`${aOutPads.join("")}concat=n=${aOutPads.length}:v=0:a=1[${audioPad}]`);
  }

  // Mix remaining audio clips (music + independently trimmed/moved mirrored audio clips)
  const extraAudio = musicList.filter(
    (m) => !consumedAutoIds.has(m.id) && (mediaFiles.has(m.mediaId) || mediaFiles.has("default")),
  );
  let inputIdx = clips.length;
  const mixPads = [`[${audioPad}]`];
  for (let k = 0; k < extraAudio.length; k++) {
    const m = extraAudio[k];
    const filePath = mediaFiles.get(m.mediaId) || mediaFiles.get("default");
    if (!filePath || !fs.existsSync(filePath)) continue;
    const info = await getProbe(filePath);
    if (!info.hasAudio) continue;
    const mIn = Math.max(0, Number(m.in) || 0);
    const mOut = Math.max(mIn + 0.05, Number(m.out) || mIn + 0.05);
    const mDur = mOut - mIn;
    const delayMs = Math.max(0, Math.round((Number(m.start) || 0) * 1000));
    const vol = clampNumber(m.volume, 0, 2, 1);
    if (vol <= 0.001) continue;
    if (mIn > 0.01) args.push("-ss", mIn.toFixed(3));
    args.push("-t", mDur.toFixed(3), "-i", filePath);
    filters.push(
      `[${inputIdx}:a]asetpts=PTS-STARTPTS,volume=${vol.toFixed(3)},aresample=48000:async=1,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${delayMs}|${delayMs}[am${k}]`,
    );
    mixPads.push(`[am${k}]`);
    inputIdx++;
  }
  if (mixPads.length > 1) {
    filters.push(`${mixPads.join("")}amix=inputs=${mixPads.length}:duration=first:normalize=0[amixed]`);
    audioPad = "amixed";
  }

  const assFile = await writeOverlayAss(dir, project, width, height);
  if (assFile) {
    const fDir = fs.existsSync(FONTS_DIR) ? `:fontsdir='${filterPath(FONTS_DIR)}'` : "";
    filters.push(`[${videoPad}]subtitles='${filterPath(assFile)}'${fDir},format=yuv420p[vfinal]`);
    videoPad = "vfinal";
  } else {
    filters.push(`[${videoPad}]format=yuv420p[vfinal]`);
    videoPad = "vfinal";
  }

  const out = path.join(dir, `out.${format}`);
  args.push("-filter_complex", filters.join(";"), "-map", `[${videoPad}]`, "-map", `[${audioPad}]`, "-r", String(fps));

  if (format === "webm") {
    args.push("-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", "-crf", "32", "-b:v", "0", "-c:a", "libopus", "-b:a", "128k");
  } else {
    args.push(...(await encoderArgs({ preset: "ultrafast", nvencPreset: "p1" })), "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart");
  }
  args.push("-t", totalDuration.toFixed(3), out);

  return { args, out, totalDuration };
}

/**
 * Fast FFmpeg native render endpoint.
 * Supports `?async=1` for instant job ID return + live `-progress pipe:1` polling,
 * or synchronous binary response when `?async=1` is omitted.
 */
async function apiNativeRender(req, res, query) {
  const boundary = boundaryOf(req);
  const dir = await tempDir("native-render-");
  const fields = {};
  const mediaFiles = new Map();
  let keepDir = false;

  try {
    if (boundary) {
      await readMultipart(req, boundary, {
        onFile({ name, filename }) {
          const mediaId = name.startsWith("media_") ? name.slice(6) : name === "media" ? "default" : null;
          if (!mediaId) return fs.createWriteStream(path.join(dir, "ignored.bin"));
          const safeBase = sanitizeFileName(path.basename(filename || "input.bin"), "input");
          const target = path.join(dir, `${id()}_${safeBase}`);
          mediaFiles.set(mediaId, target);
          return fs.createWriteStream(target);
        },
        onField(name, value) {
          fields[name] = value;
        },
      });
    } else {
      const body = await readJson(req, 32 * 1024 * 1024);
      if (body.project !== undefined) {
        fields.project = typeof body.project === "string" ? body.project : JSON.stringify(body.project);
      }
      if (body.mediaRefs !== undefined) {
        fields.mediaRefs = typeof body.mediaRefs === "string" ? body.mediaRefs : JSON.stringify(body.mediaRefs);
      }
      if (body.width !== undefined) fields.width = body.width;
      if (body.height !== undefined) fields.height = body.height;
      if (body.fps !== undefined) fields.fps = body.fps;
      if (body.format !== undefined) fields.format = body.format;
      if (body.saveToExports !== undefined) fields.saveToExports = body.saveToExports;
      if (body.exportName !== undefined) fields.exportName = body.exportName;
    }

    // Resolve server-side mediaRefs so large files already in workspace render directly without browser re-upload
    if (fields.mediaRefs) {
      let refs = {};
      try {
        refs = typeof fields.mediaRefs === "string" ? JSON.parse(fields.mediaRefs) : fields.mediaRefs;
      } catch {
        refs = {};
      }
      if (refs && typeof refs === "object") {
        for (const [clientMediaId, serverMediaId] of Object.entries(refs)) {
          if (mediaFiles.has(clientMediaId)) continue;
          const resolved = resolveMediaJob(String(serverMediaId || ""));
          if (resolved && fs.existsSync(resolved.file)) {
            mediaFiles.set(clientMediaId, resolved.file);
          }
        }
      }
    }

    if (!mediaFiles.size) return fail(res, 400, "No source media was provided", "NO_MEDIA", req);
    let project;
    try {
      project = JSON.parse(fields.project || "");
    } catch {
      return fail(res, 400, "Invalid project data", "BAD_PROJECT", req);
    }

    const disk = await getFreeDiskBytes(dir);
    if (disk && disk.freeBytes < 250 * 1024 * 1024) {
      return fail(res, 507, "Not enough free disk space (~250 MB minimum required) to render this clip.", "NO_DISK", req);
    }

    const width = Math.round(clampNumber(fields.width, 2, 4096, 1080));
    const height = Math.round(clampNumber(fields.height, 2, 8192, 1920));
    const fps = Math.max(60, Math.round(clampNumber(fields.fps, 60, 120, 60)));
    const format = fields.format === "webm" ? "webm" : "mp4";
    const wsCfg = getWorkspaceConfig();
    const shouldSaveExport =
      fields.saveToExports === true ||
      fields.saveToExports === "true" ||
      (fields.saveToExports !== false && fields.saveToExports !== "false" && wsCfg.autoSaveExports);
    const exportBaseName = sanitizeFileName(fields.exportName || project?.title || "ClipWeave Export", "clip");

    const { args, out, totalDuration } = await prepareNativeFfmpegRun(dir, project, mediaFiles, { width, height, fps, format });

    if (query?.get("async") === "1") {
      keepDir = true;
      const jobId = id();
      const job = {
        id: jobId,
        dir,
        out,
        format,
        duration: totalDuration,
        status: "rendering",
        progress: 0,
        fps: 0,
        remaining: totalDuration,
        error: null,
        exportPath: null,
        exportFileName: null,
        child: null,
        cancelled: false,
        at: Date.now(),
      };
      nativeJobs.set(jobId, job);

      let buf = "";
      void run("ffmpeg", args, {
        timeout: 0,
        onSpawn(child) {
          job.child = child;
        },
        onStdout(chunk) {
          buf += chunk;
          const lines = buf.split(/\r?\n/);
          buf = lines.pop() || "";
          for (const line of lines) {
            const eq = line.indexOf("=");
            if (eq < 0) continue;
            const k = line.slice(0, eq).trim();
            const v = line.slice(eq + 1).trim();
            if (k === "fps") {
              const parsed = Number(v);
              if (Number.isFinite(parsed) && parsed > 0) job.fps = Math.round(parsed);
            } else if (k === "out_time_us") {
              const us = Number(v);
              if (Number.isFinite(us) && us >= 0 && totalDuration > 0) {
                const sec = us / 1_000_000;
                job.progress = Math.min(0.99, sec / totalDuration);
                const rate = job.fps > 0 ? job.fps / fps : 1;
                job.remaining = Math.max(0, (totalDuration - sec) / Math.max(0.25, rate));
                job.at = Date.now();
              }
            }
          }
        },
      }).then(async (r) => {
        job.child = null;
        if (job.cancelled) {
          job.status = "cancelled";
          return;
        }
        if (r.code !== 0 || !fs.existsSync(out)) {
          job.status = "failed";
          job.error = r.stderr.split("\n").filter(Boolean).slice(-2).join(" ") || "FFmpeg native render failed";
          log("error", "render", `Job ${jobId} failed`, job.error);
          return;
        }
        if (shouldSaveExport) {
          try {
            const saved = await copyToWorkspaceExports(out, exportBaseName, format);
            job.exportPath = saved.path;
            job.exportFileName = saved.fileName;
          } catch (e) {
            log("warn", "render", `Could not copy render ${jobId} to Exports folder`, String(e?.message || e));
          }
        }
        job.status = "done";
        job.progress = 1;
        job.remaining = 0;
        job.at = Date.now();
      });

      return json(res, 200, { id: jobId, duration: totalDuration }, req);
    }

    const r = await run("ffmpeg", args, { timeout: 0 });
    if (r.code !== 0 || !fs.existsSync(out)) {
      return fail(res, 500, r.stderr.split("\n").filter(Boolean).slice(-2).join(" ") || "FFmpeg native render failed", "FFMPEG_FAILED", req);
    }
    if (shouldSaveExport) {
      await copyToWorkspaceExports(out, exportBaseName, format).catch(() => {});
    }
    await sendFile(req, res, out, format === "webm" ? "video/webm" : "video/mp4");
  } catch (e) {
    log("error", "render", "Native render exception", String(e?.message || e));
    if (!res.headersSent) fail(res, 500, String(e?.message || e || "Native render failed"), "INTERNAL_ERROR", req);
  } finally {
    if (!keepDir) {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function apiNativeStatus(req, res, query) {
  const job = nativeJobs.get(query.get("id") || "");
  if (!job) return fail(res, 404, "Render job not found", "NOT_FOUND", req);
  job.at = Date.now();
  json(res, 200, {
    id: job.id,
    status: job.status,
    progress: job.progress,
    fps: job.fps,
    remaining: job.remaining,
    error: job.error,
    exportPath: job.exportPath,
    exportFileName: job.exportFileName,
  }, req);
}

async function apiNativeResult(req, res, query) {
  const job = nativeJobs.get(query.get("id") || "");
  if (!job || job.status !== "done" || !fs.existsSync(job.out)) {
    return fail(res, 404, "Rendered output not ready", "NOT_FOUND", req);
  }
  job.at = Date.now();
  const mime = job.format === "webm" ? "video/webm" : "video/mp4";
  await sendFile(req, res, job.out, mime);
}

function apiNativeAbort(req, res, query) {
  const job = nativeJobs.get(query.get("id") || "");
  if (job) {
    job.cancelled = true;
    try { job.child?.kill("SIGKILL"); } catch { /* best effort */ }
    nativeJobs.delete(job.id);
    fsp.rm(job.dir, { recursive: true, force: true }).catch(() => {});
  }
  json(res, 200, { ok: true }, req);
}

process.on("exit", () => {
  for (const job of nativeJobs.values()) {
    try { job.child?.kill("SIGKILL"); } catch { /* best effort */ }
  }
});

module.exports = {
  "POST /api/render/native": apiNativeRender,
  "GET /api/render/native/status": apiNativeStatus,
  "GET /api/render/native/result": apiNativeResult,
  "POST /api/render/native/abort": apiNativeAbort,
};

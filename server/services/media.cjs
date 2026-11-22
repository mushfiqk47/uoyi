"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { run, hasTool, probe, resolveLocalTool, isSandboxedLinuxBinary } = require("../lib/proc.cjs");
const { ensureCache, mediaFile, isHiddenHomePath } = require("../lib/files.cjs");
const { id } = require("../lib/id.cjs");
const { mediaJobs } = require("../state.cjs");

let ytDlpHiddenHomeDenied = false;

function isPermissionError(stderr) {
  return /\b(permission denied|errno 13|eacces|eperm|operation not permitted|unable to open for writing|read-only file system)\b/i.test(
    String(stderr || ""),
  );
}

function summarizeStderr(stderr, fallback = "yt-dlp failed") {
  const lines = String(stderr || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.slice(-2).join(" ") || fallback;
}

function buildYtDlpArgs(file, url, ffmpegPath = resolveLocalTool("ffmpeg")) {
  const args = [
    "--no-playlist",
    "-f", "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/bv*+ba/b",
    "--merge-output-format", "mp4",
  ];
  if (ffmpegPath) {
    args.push("--ffmpeg-location", path.dirname(ffmpegPath));
  }
  args.push("-o", file, url);
  return args;
}

async function cleanupMediaPrefix(dir, mediaId) {
  if (!dir || !mediaId) return;
  const prefix = `media-${mediaId}`;
  const entries = await fsp.readdir(dir).catch(() => []);
  await Promise.all(
    entries
      .filter((name) => name.startsWith(prefix))
      .map((name) => fsp.rm(path.join(dir, name), { force: true }).catch(() => {})),
  );
}

function pickPlayable(info) {
  const formats = (info.formats || []).filter((f) => f.url && f.vcodec && f.vcodec !== "none");
  const withHeight = formats.filter((f) => f.height);
  withHeight.sort((a, b) => (b.height || 0) - (a.height || 0));
  const chosen = withHeight.find((f) => (f.height || 0) <= 1080) || withHeight[0];
  return chosen || formats[formats.length - 1] || null;
}

function isDirectMediaUrl(url) {
  try {
    const u = new URL(String(url));
    return /\.(m3u8|mp4|webm|mov|m4v|mpg|mpeg|mp3|wav|ogg|aac)(\?|$)/i.test(u.pathname);
  } catch {
    return false;
  }
}

async function detectDirectMedia(url) {
  if (isDirectMediaUrl(url)) {
    const isHls = /\.m3u8(\?|$)/i.test(url);
    return { direct: true, kind: isHls ? "hls" : "video" };
  }
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(8000) });
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("mpegurl")) return { direct: true, kind: "hls" };
    if (ct.startsWith("video/") || ct.startsWith("audio/")) return { direct: true, kind: "video" };
  } catch {
    /* fall back to yt-dlp if available */
  }
  return { direct: false, kind: "video" };
}

async function downloadDirectMedia(url, file, job) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(180000) });
  if (!res.ok || !res.body) {
    throw new Error(`Could not download media (${res.status})`);
  }
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
  const info = await probe(file);
  if (!info.hasVideo && !info.hasAudio) {
    await fsp.rm(file, { force: true }).catch(() => {});
    throw new Error("That URL did not return readable video or audio.");
  }
  job.status = "ready";
}

async function runYtDlpPrepare(url, mediaId, initialDir, job) {
  let targetDir = initialDir;
  let targetFile = mediaFile(mediaId, "mp4", targetDir);
  job.file = targetFile;

  let result = await run("yt-dlp", buildYtDlpArgs(targetFile, url), { timeout: 0 });
  if ((result.code !== 0 || !fs.existsSync(targetFile)) && isPermissionError(result.stderr)) {
    await cleanupMediaPrefix(targetDir, mediaId);
    if (isHiddenHomePath(targetDir)) ytDlpHiddenHomeDenied = true;
    const fallbackDir = await ensureCache({
      avoidHiddenHome: true,
      exclude: [targetDir],
      doNotCacheSelection: true,
    }).catch(() => null);
    if (fallbackDir && path.resolve(fallbackDir) !== path.resolve(targetDir)) {
      targetDir = fallbackDir;
      targetFile = mediaFile(mediaId, "mp4", targetDir);
      job.file = targetFile;
      result = await run("yt-dlp", buildYtDlpArgs(targetFile, url), { timeout: 0 });
    }
  }

  if (result.code !== 0 || !fs.existsSync(targetFile)) {
    await cleanupMediaPrefix(targetDir, mediaId);
    job.status = "failed";
    const tail = summarizeStderr(result.stderr);
    job.err = isPermissionError(result.stderr)
      ? `Permission denied writing media cache (${tail}). Install standalone yt-dlp in Settings -> Setup & Hardware or check folder write permissions.`
      : tail;
    return;
  }

  job.status = "ready";
}

async function startPrepare(url, title) {
  const mediaId = id();
  const now = Date.now();
  const detected = await detectDirectMedia(url);
  const avoidHiddenHome =
    !detected.direct &&
    (ytDlpHiddenHomeDenied || isSandboxedLinuxBinary("yt-dlp") || isSandboxedLinuxBinary("ffmpeg"));

  const cacheDir = await ensureCache({
    avoidHiddenHome,
    doNotCacheSelection: avoidHiddenHome,
  });
  const file = mediaFile(mediaId, "mp4", cacheDir);
  const job = { id: mediaId, status: "preparing", file, mime: "video/mp4", err: "", title: title || url, url, createdAt: now, accessedAt: now };
  mediaJobs.set(mediaId, job);

  if (detected.direct && detected.kind === "video") {
    downloadDirectMedia(url, file, job).catch((e) => {
      job.status = "failed";
      job.err = String(e.message || e);
    });
    return job;
  }

  const ytDlpAvailable = await hasTool("yt-dlp", ["--version"]);
  if (!ytDlpAvailable) {
    job.status = "failed";
    job.err = "yt-dlp is not installed in this cloud environment. Upload the video file (MP4/WebM/MOV), paste a direct .mp4/.webm URL, or use Capture Tab in the Viewer.";
    return job;
  }

  runYtDlpPrepare(url, mediaId, cacheDir, job).catch((e) => {
    job.status = "failed";
    job.err = String(e.message || e);
  });
  return job;
}

module.exports = {
  pickPlayable,
  startPrepare,
  isDirectMediaUrl,
  detectDirectMedia,
  isPermissionError,
  buildYtDlpArgs,
  cleanupMediaPrefix,
};

"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { run, resolveYtDlp, friendlyYtDlpError, probe } = require("../lib/proc.cjs");
const { ensureCache, mediaFile } = require("../lib/files.cjs");
const { id } = require("../lib/id.cjs");
const { mediaJobs } = require("../state.cjs");

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

async function startPrepare(url, title) {
  const mediaId = id();
  const file = mediaFile(mediaId);
  const job = { id: mediaId, status: "preparing", file, err: "", title: title || url, url };
  mediaJobs.set(mediaId, job);
  await ensureCache();

  const detected = await detectDirectMedia(url);
  if (detected.direct && detected.kind === "video") {
    downloadDirectMedia(url, file, job).catch((e) => {
      job.status = "failed";
      job.err = String(e.message || e);
    });
    return job;
  }

  const ytDlp = await resolveYtDlp();
  if (!ytDlp) {
    job.status = "failed";
    job.err = "yt-dlp is not available in this cloud environment. Upload the video file (MP4/WebM/MOV), paste a direct .mp4/.webm URL, or use Capture Tab in the Viewer.";
    return job;
  }

  const args = [
    "--no-playlist",
    "-f", "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/bv*+ba/b",
    "--merge-output-format", "mp4",
    "-o", file,
    url,
  ];
  run(ytDlp, args, { timeout: 0 })
    .then((r) => {
      if (r.code !== 0 || !fs.existsSync(file)) {
        job.status = "failed";
        job.err = friendlyYtDlpError(r.stderr, "yt-dlp failed");
        return;
      }
      job.status = "ready";
    })
    .catch((e) => {
      job.status = "failed";
      job.err = String(e.message || e);
    });
  return job;
}

module.exports = { pickPlayable, startPrepare, isDirectMediaUrl, detectDirectMedia };

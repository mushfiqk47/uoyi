"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { json, fail, readJson, sendFile } = require("../lib/http.cjs");
const { probe } = require("../lib/proc.cjs");
const { ensureWorkspaceDirs, getConfiguredWorkspaceDir, getFreeDiskBytes, sanitizeFileName } = require("../lib/paths.cjs");
const { id } = require("../lib/id.cjs");
const { validateExternalHttpUrl } = require("../lib/security.cjs");
const { startPrepare } = require("../services/media.cjs");
const { registerWorkspaceMedia } = require("../services/workspace.cjs");
const { mediaJobs, clipFiles, resolveMediaJob, touchEntry } = require("../state.cjs");

async function apiMediaPrepare(req, res) {
  const { url } = await readJson(req);
  const check = await validateExternalHttpUrl(url);
  if (!check.ok) return fail(res, 400, check.error || "Paste an http(s) link.", "BAD_URL", req);
  const job = await startPrepare(String(url), String(url));
  json(res, 200, { id: job.id, url: `/media?id=${job.id}` }, req);
}

async function apiMediaStatus(req, res, query) {
  const job = mediaJobs.get(query.get("id") || "") || resolveMediaJob(query.get("id") || "");
  if (!job) return json(res, 200, { id: query.get("id"), status: "unknown", err: "Unknown media job" }, req);
  touchEntry(job);
  json(res, 200, { id: job.id, status: job.status, err: job.err, title: job.title }, req);
}

async function serveMedia(req, res, query) {
  const job = mediaJobs.get(query.get("id") || "") || resolveMediaJob(query.get("id") || "");
  if (!job) return fail(res, 404, "Unknown media", "NOT_FOUND", req);
  touchEntry(job);
  const deadline = Date.now() + 180000;
  while (job.status === "preparing" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
  }
  if (job.status === "failed") return fail(res, 409, job.err || "Media preparation failed", "MEDIA_FAILED", req);
  if (job.status !== "ready") return fail(res, 504, "Media is still preparing", "TIMEOUT", req);
  touchEntry(job);
  await sendFile(req, res, job.file, job.mime || "video/mp4");
}

async function serveClip(req, res, query) {
  const clip = clipFiles.get(query.get("id") || "");
  if (!clip) return fail(res, 404, "Unknown clip", "NOT_FOUND", req);
  touchEntry(clip);
  await sendFile(req, res, clip.file, clip.mime || "video/mp4");
}

async function apiUpload(req, res, query) {
  const name = query.get("name") || "upload.mp4";
  const mediaId = id();
  const ext = path.extname(name).replace(/[^.a-z0-9]/gi, "").toLowerCase() || ".mp4";
  const baseTitle = sanitizeFileName(path.basename(name, ext), "media");
  const contentLen = Number(req.headers["content-length"] || 0);
  const dirs = await ensureWorkspaceDirs(getConfiguredWorkspaceDir());
  const disk = await getFreeDiskBytes(dirs.media);
  const minNeeded = Math.max(200 * 1024 * 1024, contentLen * 1.2);
  if (disk && disk.freeBytes < minNeeded) {
    return fail(res, 507, "Not enough free disk space in your ClipWeave workspace folder for this file.", "NO_DISK", req);
  }

  const file = path.join(dirs.media, `${baseTitle}-${mediaId}${ext}`);
  const sink = fs.createWriteStream(file);
  let aborted = false;
  req.on("aborted", () => {
    aborted = true;
    sink.destroy();
  });
  try {
    for await (const chunk of req) {
      if (aborted) break;
      if (!sink.write(chunk)) await new Promise((r) => sink.once("drain", r));
    }
  } finally {
    await new Promise((r) => sink.end(r));
  }
  if (aborted) {
    await fsp.rm(file, { force: true }).catch(() => {});
    return;
  }

  const info = await probe(file);
  if (!info.hasVideo && !info.hasAudio) {
    await fsp.rm(file, { force: true }).catch(() => {});
    return fail(res, 415, "That file isn't readable media.", "UNREADABLE_MEDIA", req);
  }
  const now = Date.now();
  const mime = ext === ".webm" ? "video/webm" : ext === ".mp3" ? "audio/mpeg" : ext === ".wav" ? "audio/wav" : /\.(png|jpe?g|webp)$/i.test(ext) ? `image/${ext.slice(1).replace("jpg", "jpeg")}` : "video/mp4";
  const kind = mime.startsWith("image/") ? "image" : !info.hasVideo ? "audio" : "video";
  mediaJobs.set(mediaId, {
    id: mediaId,
    status: "ready",
    file,
    mime,
    err: "",
    title: baseTitle,
    url: "",
    createdAt: now,
    accessedAt: now,
    persistent: true,
  });
  await registerWorkspaceMedia({
    id: mediaId,
    title: baseTitle,
    file,
    mime,
    kind,
    source: "upload",
    duration: info.duration,
  });
  json(res, 200, {
    id: mediaId,
    title: baseTitle,
    streamUrl: `/api/workspace/file?id=${encodeURIComponent(mediaId)}`,
    duration: info.duration,
  }, req);
}

module.exports = {
  "POST /api/media/prepare": apiMediaPrepare,
  "GET /api/media/status": apiMediaStatus,
  "GET /media": serveMedia,
  "GET /media/clip": serveClip,
  "POST /api/upload": apiUpload,
};

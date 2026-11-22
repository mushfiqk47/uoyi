"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { json, fail, readJson, sendFile } = require("../lib/http.cjs");
const { probe } = require("../lib/proc.cjs");
const { ensureCache, mediaFile } = require("../lib/files.cjs");
const { id } = require("../lib/id.cjs");
const { validateExternalHttpUrl } = require("../lib/security.cjs");
const { startPrepare } = require("../services/media.cjs");
const { mediaJobs, clipFiles, touchEntry } = require("../state.cjs");

async function apiMediaPrepare(req, res) {
  const { url } = await readJson(req);
  const check = await validateExternalHttpUrl(url);
  if (!check.ok) return fail(res, 400, check.error || "Paste an http(s) link.");
  const job = await startPrepare(String(url), String(url));
  json(res, 200, { id: job.id, url: `/media?id=${job.id}` });
}

async function apiMediaStatus(_req, res, query) {
  const job = mediaJobs.get(query.get("id") || "");
  if (!job) return json(res, 200, { id: query.get("id"), status: "unknown", err: "Unknown media job" });
  touchEntry(job);
  json(res, 200, { id: job.id, status: job.status, err: job.err, title: job.title });
}

async function serveMedia(req, res, query) {
  const job = mediaJobs.get(query.get("id") || "");
  if (!job) return fail(res, 404, "Unknown media");
  touchEntry(job);
  // A resolved VOD points the player here before the download finishes; holding the
  // request is what lets playback start without the user reloading the tile.
  const deadline = Date.now() + 180000;
  while (job.status === "preparing" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
  }
  if (job.status === "failed") return fail(res, 409, job.err || "Media preparation failed");
  if (job.status !== "ready") return fail(res, 504, "Media is still preparing");
  touchEntry(job);
  await sendFile(req, res, job.file, job.mime || "video/mp4");
}

async function serveClip(req, res, query) {
  const clip = clipFiles.get(query.get("id") || "");
  if (!clip) return fail(res, 404, "Unknown clip");
  touchEntry(clip);
  await sendFile(req, res, clip.file, clip.mime || "video/mp4");
}

async function apiUpload(req, res, query) {
  const name = query.get("name") || "upload.mp4";
  const mediaId = id();
  const ext = path.extname(name).replace(/[^.a-z0-9]/gi, "") || ".mp4";
  const file = mediaFile(mediaId, ext.slice(1));
  await ensureCache();
  const sink = fs.createWriteStream(file);
  try {
    for await (const chunk of req) {
      if (!sink.write(chunk)) await new Promise((r) => sink.once("drain", r));
    }
  } finally {
    await new Promise((r) => sink.end(r));
  }
  const info = await probe(file);
  if (!info.hasVideo && !info.hasAudio) {
    await fsp.rm(file, { force: true });
    return fail(res, 415, "That file isn't readable media.");
  }
  const now = Date.now();
  mediaJobs.set(mediaId, {
    id: mediaId,
    status: "ready",
    file,
    mime: ext.toLowerCase() === ".webm" ? "video/webm" : "video/mp4",
    err: "",
    title: path.basename(name, ext),
    url: "",
    createdAt: now,
    accessedAt: now,
  });
  json(res, 200, { id: mediaId, title: path.basename(name, ext) });
}

module.exports = {
  "POST /api/media/prepare": apiMediaPrepare,
  "GET /api/media/status": apiMediaStatus,
  "GET /media": serveMedia,
  "GET /media/clip": serveClip,
  "POST /api/upload": apiUpload,
};

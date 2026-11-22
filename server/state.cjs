"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { CACHE, sweepCacheDir } = require("./lib/files.cjs");

const STATE_TTL_MS = 30 * 60 * 1000;

const mediaJobs = new Map(); // id -> { id, status, file, mime?, err, title, url, createdAt, accessedAt }
const clipFiles = new Map(); // id -> { id, file, dir?, duration, mime, createdAt, accessedAt }
const modelJobs = new Map(); // id -> { status, log, createdAt, accessedAt }

function touchEntry(entry) {
  if (!entry) return entry;
  const now = Date.now();
  if (!entry.createdAt) entry.createdAt = now;
  entry.accessedAt = now;
  return entry;
}

function removeMediaArtifact(filePath) {
  if (!filePath) return;
  fsp.rm(filePath, { force: true }).catch(() => {});
}

function removeClipArtifact(entry) {
  if (!entry) return;
  const target = entry.dir || (entry.file && path.dirname(entry.file) !== CACHE ? path.dirname(entry.file) : entry.file);
  if (target && target !== CACHE && target.startsWith(CACHE)) {
    fsp.rm(target, { recursive: true, force: true }).catch(() => {});
  } else if (entry.file) {
    fsp.rm(entry.file, { force: true }).catch(() => {});
  }
}

function reapExpiredState(ttlMs = STATE_TTL_MS) {
  const cutoff = Date.now() - ttlMs;
  for (const [id, job] of mediaJobs) {
    if (job.status === "preparing") continue;
    const at = job.accessedAt || job.createdAt || 0;
    if (at && at < cutoff) {
      mediaJobs.delete(id);
      removeMediaArtifact(job.file);
    }
  }
  for (const [id, clip] of clipFiles) {
    const at = clip.accessedAt || clip.createdAt || 0;
    if (at && at < cutoff) {
      clipFiles.delete(id);
      removeClipArtifact(clip);
    }
  }
  for (const [id, model] of modelJobs) {
    if (model.status === "downloading") continue;
    const at = model.accessedAt || model.createdAt || 0;
    if (at && at < cutoff) {
      modelJobs.delete(id);
    }
  }
}

function activeCachePaths() {
  const keep = new Set();
  for (const job of mediaJobs.values()) {
    if (job.file) keep.add(job.file);
  }
  for (const clip of clipFiles.values()) {
    if (clip.dir) keep.add(clip.dir);
    else if (clip.file) keep.add(clip.file);
  }
  return keep;
}

async function pruneAllCache() {
  for (const [id, job] of mediaJobs) {
    if (job.status !== "preparing") {
      mediaJobs.delete(id);
      removeMediaArtifact(job.file);
    }
  }
  for (const [id, clip] of clipFiles) {
    clipFiles.delete(id);
    removeClipArtifact(clip);
  }
  const keepPaths = activeCachePaths();
  const removed = await sweepCacheDir({ removeAll: true, keepPaths });
  return { removed };
}

// Startup sweep of stale leftover temp files from dead processes (> 2h old)
if (fs.existsSync(CACHE)) {
  sweepCacheDir({ maxAgeMs: 2 * 60 * 60 * 1000 }).catch(() => {});
}

const stateTimer = setInterval(() => {
  reapExpiredState();
}, 5 * 60 * 1000);
stateTimer.unref?.();

module.exports = {
  STATE_TTL_MS,
  mediaJobs,
  clipFiles,
  modelJobs,
  touchEntry,
  reapExpiredState,
  pruneAllCache,
};

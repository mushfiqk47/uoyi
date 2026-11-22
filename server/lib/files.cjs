"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");
const { ROOT } = require("./proc.cjs");

const CACHE = path.join(ROOT, ".cache", "dev-api");
const MODELS_FILE = path.join(ROOT, "models.json");

async function ensureCache() {
  await fsp.mkdir(CACHE, { recursive: true });
}

async function tempDir(prefix) {
  await ensureCache();
  return fsp.mkdtemp(path.join(CACHE, prefix));
}

function mediaFile(jobId, ext = "mp4") {
  return path.join(CACHE, `media-${jobId}.${ext}`);
}

async function dirSizeBytes(target) {
  let total = 0;
  const entries = await fsp.readdir(target, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) {
      total += await dirSizeBytes(full);
    } else if (entry.isFile()) {
      const st = await fsp.stat(full).catch(() => null);
      if (st) total += st.size;
    }
  }
  return total;
}

async function cacheStats() {
  const entries = await fsp.readdir(CACHE).catch(() => []);
  const bytes = entries.length ? await dirSizeBytes(CACHE) : 0;
  return { bytes, entries: entries.length, path: CACHE };
}

/** Removes leftover temp artifacts from crashed runs on startup or explicit prune. */
async function sweepCacheDir({ maxAgeMs = 60 * 60 * 1000, removeAll = false, keepPaths = new Set() } = {}) {
  const entries = await fsp.readdir(CACHE).catch(() => []);
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const name of entries) {
    const full = path.join(CACHE, name);
    if (keepPaths.has(full)) continue;
    if (!removeAll) {
      const st = await fsp.stat(full).catch(() => null);
      if (st && st.mtimeMs > cutoff) continue;
    }
    await fsp.rm(full, { recursive: true, force: true }).catch(() => {});
    removed++;
  }
  return removed;
}

module.exports = { CACHE, MODELS_FILE, ensureCache, tempDir, mediaFile, cacheStats, sweepCacheDir };

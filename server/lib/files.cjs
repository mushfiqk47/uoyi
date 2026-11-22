"use strict";

const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { ROOT, DATA_DIR, getConfiguredWorkspaceDir } = require("./paths.cjs");
const { isSandboxedLinuxBinary } = require("./proc.cjs");

const CACHE = process.env.CLIPWEAVE_CACHE_DIR || path.join(DATA_DIR, "cache");
const MODELS_FILE = path.join(ROOT, "models.json");

let activeCacheDir = null;

function isHiddenHomePath(targetPath, homeDir = os.homedir()) {
  const resolved = path.resolve(targetPath);
  const home = path.resolve(homeDir || "");
  if (!home) return false;
  const rel = path.relative(home, resolved);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false;
  return rel.split(path.sep).some((part) => part.startsWith("."));
}

function getCacheDir() {
  return activeCacheDir || CACHE;
}

function isInCacheDir(targetPath) {
  if (!targetPath) return false;
  const resolved = path.resolve(targetPath);
  for (const base of [CACHE, getCacheDir()]) {
    const root = path.resolve(base);
    if (resolved === root || resolved.startsWith(root + path.sep)) return true;
  }
  return false;
}

function cacheCandidates({ avoidHiddenHome = false, exclude = [] } = {}) {
  const excluded = new Set(exclude.filter(Boolean).map((d) => path.resolve(d)));
  const workspaceCache = path.join(getConfiguredWorkspaceDir(), "Cache");
  const tmpCache = path.join(os.tmpdir(), "clipweave-cache");
  const raw = avoidHiddenHome
    ? [workspaceCache, tmpCache, activeCacheDir, CACHE]
    : [activeCacheDir, CACHE, workspaceCache, tmpCache];

  const unique = [];
  const seen = new Set();
  for (const dir of raw) {
    if (!dir) continue;
    const resolved = path.resolve(dir);
    if (seen.has(resolved) || excluded.has(resolved)) continue;
    seen.add(resolved);
    unique.push(resolved);
  }
  if (avoidHiddenHome) {
    const nonHidden = unique.filter((d) => !isHiddenHomePath(d));
    const hidden = unique.filter((d) => isHiddenHomePath(d));
    return [...nonHidden, ...hidden];
  }
  return unique;
}

async function isDirWritable(dir) {
  try {
    await fsp.mkdir(dir, { recursive: true });
    const probeFile = path.join(
      dir,
      `.cw-write-probe-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    );
    await fsp.writeFile(probeFile, "");
    await fsp.rm(probeFile, { force: true }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

async function ensureCache(opts = {}) {
  const candidates = cacheCandidates(opts);
  for (const dir of candidates) {
    if (await isDirWritable(dir)) {
      if (!opts.doNotCacheSelection) {
        activeCacheDir = dir;
      }
      return dir;
    }
  }
  throw new Error(`No writable cache directory found (tried: ${candidates.join(", ")})`);
}

async function tempDir(prefix, opts = {}) {
  const avoidHiddenHome = opts.avoidHiddenHome ?? isSandboxedLinuxBinary("ffmpeg");
  const base = await ensureCache({ ...opts, avoidHiddenHome, doNotCacheSelection: opts.doNotCacheSelection ?? avoidHiddenHome });
  return fsp.mkdtemp(path.join(base, prefix));
}

function mediaFile(jobId, ext = "mp4", baseDir = getCacheDir()) {
  return path.join(baseDir, `media-${jobId}.${ext}`);
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
  const dir = getCacheDir();
  const entries = await fsp.readdir(dir).catch(() => []);
  const bytes = entries.length ? await dirSizeBytes(dir) : 0;
  return { bytes, entries: entries.length, path: dir };
}

/** Removes leftover temp artifacts from crashed runs on startup or explicit prune. */
async function sweepCacheDir({ maxAgeMs = 60 * 60 * 1000, removeAll = false, keepPaths = new Set() } = {}) {
  const roots = [...new Set([path.resolve(CACHE), path.resolve(getCacheDir())])];
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const dir of roots) {
    const entries = await fsp.readdir(dir).catch(() => []);
    for (const name of entries) {
      const full = path.join(dir, name);
      if (keepPaths.has(full)) continue;
      if (!removeAll) {
        const st = await fsp.stat(full).catch(() => null);
        if (st && st.mtimeMs > cutoff) continue;
      }
      await fsp.rm(full, { recursive: true, force: true }).catch(() => {});
      removed++;
    }
  }
  return removed;
}

module.exports = {
  CACHE,
  MODELS_FILE,
  getCacheDir,
  isInCacheDir,
  isHiddenHomePath,
  isDirWritable,
  cacheCandidates,
  ensureCache,
  tempDir,
  mediaFile,
  cacheStats,
  sweepCacheDir,
};

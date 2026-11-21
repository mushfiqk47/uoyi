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

module.exports = { CACHE, MODELS_FILE, ensureCache, tempDir, mediaFile };

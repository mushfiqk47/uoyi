"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { json } = require("../lib/http.cjs");
const {
  ROOT,
  hasTool,
  findOpenCvPython,
  findStreamlink,
  findScenedetect,
  encoderArgs,
  nvencEnabled,
  activeGpuEncoder,
  systemHardwareProfile,
} = require("../lib/proc.cjs");
const { hasGeminiKey } = require("../lib/gemini.cjs");
const { DATA_DIR, getConfiguredWorkspaceDir } = require("../lib/paths.cjs");
const { cacheStats } = require("../lib/files.cjs");
const { pruneAllCache } = require("../state.cjs");
const { getSecretsStatus } = require("../services/workspace.cjs");
const { resolveCli, modelInstalled } = require("../lib/audiocpp.cjs");

function readAppVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    return String(pkg?.version || "0.1.0");
  } catch {
    return "0.1.0";
  }
}

async function apiHealth(req, res) {
  const [ffmpeg, ytDlp, nemo, opencv, streamlink, pyScenedetect, audiocpp, audiocppParakeet] = await Promise.all([
    hasTool("ffmpeg", ["-version"]),
    hasTool("yt-dlp", ["--version"]),
    hasTool("nemo-speech", ["--version"]),
    findOpenCvPython().then((bin) => !!bin),
    findStreamlink().then((tool) => !!tool),
    findScenedetect().then((tool) => !!tool),
    resolveCli().then((cli) => !!cli),
    modelInstalled("parakeet-tdt"),
  ]);
  await encoderArgs();
  const sceneBackend = pyScenedetect ? "pyscenedetect" : ffmpeg ? "ffmpeg" : null;
  const secrets = getSecretsStatus();
  json(res, 200, {
    ok: ffmpeg,
    ffmpeg,
    ytDlp,
    nemo,
    opencv,
    streamlink,
    scenedetect: Boolean(sceneBackend),
    sceneBackend,
    gemini: hasGeminiKey() || Boolean(secrets.gemini),
    nvenc: nvencEnabled(),
    gpu: activeGpuEncoder(),
    system: systemHardwareProfile(),
    audiocpp,
    audiocppParakeet,
    dataDir: DATA_DIR,
    workspaceDir: getConfiguredWorkspaceDir(),
    version: readAppVersion(),
  }, req);
}

async function apiCacheInfo(req, res) {
  json(res, 200, await cacheStats(), req);
}

async function apiCachePrune(req, res) {
  const { removed } = await pruneAllCache();
  const stats = await cacheStats();
  json(res, 200, { ok: true, removed, ...stats }, req);
}

module.exports = {
  "GET /api/health": apiHealth,
  "GET /api/cache": apiCacheInfo,
  "POST /api/cache/prune": apiCachePrune,
};

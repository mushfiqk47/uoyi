"use strict";

const { json } = require("../lib/http.cjs");
const { hasTool, findOpenCvPython, findStreamlink, findScenedetect, encoderArgs, nvencEnabled } = require("../lib/proc.cjs");
const { hasGeminiKey } = require("../lib/gemini.cjs");
const { cacheStats } = require("../lib/files.cjs");
const { pruneAllCache } = require("../state.cjs");
const { resolveCli, modelInstalled } = require("../lib/audiocpp.cjs");

async function apiHealth(_req, res) {
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
  json(res, 200, {
    ok: ffmpeg,
    ffmpeg,
    ytDlp,
    nemo,
    opencv,
    streamlink,
    scenedetect: Boolean(sceneBackend),
    sceneBackend,
    gemini: hasGeminiKey(),
    nvenc: nvencEnabled(),
    audiocpp,
    audiocppParakeet,
  });
}

async function apiCacheInfo(_req, res) {
  json(res, 200, await cacheStats());
}

async function apiCachePrune(_req, res) {
  const { removed } = await pruneAllCache();
  const stats = await cacheStats();
  json(res, 200, { ok: true, removed, ...stats });
}

module.exports = {
  "GET /api/health": apiHealth,
  "GET /api/cache": apiCacheInfo,
  "POST /api/cache/prune": apiCachePrune,
};

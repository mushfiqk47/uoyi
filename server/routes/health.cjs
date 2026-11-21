"use strict";

const { json } = require("../lib/http.cjs");
const { hasTool, resolveYtDlp, findOpenCvPython, encoderArgs, nvencEnabled } = require("../lib/proc.cjs");
const { hasGeminiKey } = require("../lib/gemini.cjs");

async function apiHealth(_req, res) {
  const [ffmpeg, ytDlp, nemo, opencv] = await Promise.all([
    hasTool("ffmpeg", ["-version"]),
    resolveYtDlp().then((bin) => !!bin),
    hasTool("nemo-speech", ["--version"]),
    findOpenCvPython().then((bin) => !!bin),
  ]);
  await encoderArgs();
  json(res, 200, {
    ok: ffmpeg,
    ffmpeg,
    ytDlp,
    nemo,
    opencv,
    gemini: hasGeminiKey(),
    nvenc: nvencEnabled(),
  });
}

module.exports = { "GET /api/health": apiHealth };

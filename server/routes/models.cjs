"use strict";

const fsp = require("node:fs/promises");
const { json, fail, readJson } = require("../lib/http.cjs");
const { run, hasTool } = require("../lib/proc.cjs");
const { MODELS_FILE } = require("../lib/files.cjs");
const { modelJobs, touchEntry } = require("../state.cjs");
const {
  catalogEntries,
  packageFor,
  modelInstalled,
  ensureRuntime,
  downloadModel,
  resolveCli,
} = require("../lib/audiocpp.cjs");

function mbLabel(bytes) {
  return `~${Math.round(bytes / (1024 * 1024))} MB`;
}

function describe(pkg) {
  const langs = pkg.langs > 1 ? `${pkg.langs} languages` : "English";
  const timing = pkg.wordTimes ? "word timestamps" : "segment timing";
  return `${pkg.note} ${langs}, ${timing}.`;
}

async function nemoInstalledIds() {
  const installed = new Set();
  const listing = await run("nemo-speech", ["model", "list", "--json"], { timeout: 30000 });
  if (listing.code === 0) {
    try {
      const data = JSON.parse(listing.stdout);
      const entries = Array.isArray(data) ? data : data.models || [];
      for (const m of entries) if (m.installed || m.downloaded) installed.add(m.id || m.alias);
    } catch {
      /* fall back to nothing installed */
    }
  }
  return installed;
}

/**
 * Merged model catalog for the Caption-model dropdown: every ASR GGUF the pinned
 * audio.cpp release can download (recommended first), plus models.json entries that
 * only nemo-speech provides. `backend` says which local backend will run each entry.
 */
async function availableModels() {
  const [nemoInstalled, audiocppInstalled, modelsFile] = await Promise.all([
    nemoInstalledIds(),
    (async () => {
      const out = new Map();
      for (const entry of catalogEntries()) {
        out.set(entry.id, await modelInstalled(entry.id));
      }
      return out;
    })(),
    fsp.readFile(MODELS_FILE, "utf8").then((t) => JSON.parse(t)).catch(() => []),
  ]);

  const models = [];
  const seen = new Set();
  for (const entry of catalogEntries()) {
    const isInstalled = audiocppInstalled.get(entry.id) || nemoInstalled.has(entry.id);
    const nemoEntry = Array.isArray(modelsFile) ? modelsFile.find((m) => m.id === entry.id) : null;
    models.push({
      id: entry.id,
      label: entry.label,
      repo: nemoEntry?.repo || null,
      size: mbLabel(entry.bytes),
      description: describe(entry),
      installed: isInstalled,
      backend: audiocppInstalled.get(entry.id) ? "audiocpp" : nemoInstalled.has(entry.id) ? "nemo" : null,
    });
    seen.add(entry.id);
  }
  for (const m of Array.isArray(modelsFile) ? modelsFile : []) {
    if (seen.has(m.id)) continue;
    models.push({ ...m, installed: nemoInstalled.has(m.id), backend: nemoInstalled.has(m.id) ? "nemo" : null });
  }
  return models;
}

async function apiModels(_req, res) {
  json(res, 200, { models: await availableModels() });
}

function startNemoPull(model, job) {
  run("nemo-speech", ["pull", model.repo], { timeout: 0 })
    .then((r) => {
      job.status = r.code === 0 ? "ready" : "failed";
      job.log = (r.stdout || r.stderr || "").split("\n").filter(Boolean).slice(-3).join(" ");
      touchEntry(job);
    })
    .catch((e) => {
      job.status = "failed";
      job.log = String(e.message || e);
      touchEntry(job);
    });
}

async function apiModelDownload(req, res) {
  const { id: modelId } = await readJson(req);
  let catalog = [];
  try {
    catalog = JSON.parse(await fsp.readFile(MODELS_FILE, "utf8"));
  } catch {
    catalog = [];
  }
  const model = catalog.find((m) => m.id === modelId) || { id: modelId, repo: modelId };
  const now = Date.now();
  const job = { status: "downloading", log: "Starting download…", progress: 0, createdAt: now, accessedAt: now };

  if (packageFor(modelId)) {
    // audio.cpp path: provision the runtime first (35 MB portable zip), then the GGUF.
    // Both land in app-owned folders invoked by absolute path — no PATH, no restart.
    modelJobs.set(modelId, job);
    if ((await modelInstalled(modelId)) && (await resolveCli())) {
      job.status = "ready";
      job.progress = 100;
      job.log = "Already downloaded.";
      touchEntry(job);
      return json(res, 200, { id: modelId, status: job.status });
    }
    (async () => {
      try {
        const log = (s, pct) => {
          job.log = s;
          if (typeof pct === "number") job.progress = pct;
          touchEntry(job);
        };
        await ensureRuntime((s) => log(s));
        await downloadModel(modelId, (s, pct) => log(s, pct));
        job.status = "ready";
        job.progress = 100;
        job.log = "Model ready (audio.cpp).";
        touchEntry(job);
      } catch (e) {
        job.status = "failed";
        job.log = String(e.message || e);
        touchEntry(job);
      }
    })();
    if (!(await resolveCli())) job.log = "Downloading audio.cpp runtime…";
  } else if (await hasTool("nemo-speech", ["--version"])) {
    modelJobs.set(modelId, job);
    startNemoPull(model, job);
  } else {
    job.status = "failed";
    job.log = "This model needs the nemo-speech CLI, which is not installed. The audio.cpp models can be downloaded without it.";
    modelJobs.set(modelId, job);
  }
  json(res, 200, { id: modelId, status: job.status });
}

function apiModelStatus(_req, res, query) {
  const job = modelJobs.get(query.get("id") || "");
  if (!job) return json(res, 200, { id: query.get("id"), status: "unknown", log: "", progress: 0 });
  touchEntry(job);
  json(res, 200, { id: query.get("id"), status: job.status, log: job.log, progress: job.progress ?? 0 });
}

module.exports = {
  "GET /api/models": apiModels,
  "GET /api/models/status": apiModelStatus,
  "POST /api/models/download": apiModelDownload,
};

"use strict";

const fsp = require("node:fs/promises");
const { json, fail, readJson } = require("../lib/http.cjs");
const { run } = require("../lib/proc.cjs");
const { MODELS_FILE } = require("../lib/files.cjs");
const { modelJobs } = require("../state.cjs");

async function availableModels() {
  let catalog = [];
  try {
    catalog = JSON.parse(await fsp.readFile(MODELS_FILE, "utf8"));
  } catch {
    catalog = [];
  }
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
  return catalog.map((m) => ({ ...m, installed: installed.has(m.id) }));
}

async function apiModels(_req, res) {
  json(res, 200, { models: await availableModels() });
}

async function apiModelDownload(req, res) {
  const { id: modelId } = await readJson(req);
  let catalog = [];
  try {
    catalog = JSON.parse(await fsp.readFile(MODELS_FILE, "utf8"));
  } catch {
    catalog = [];
  }
  const model = catalog.find((m) => m.id === modelId);
  if (!model) return fail(res, 400, `Unknown model: ${modelId}`);
  const job = { status: "downloading", log: `Fetching ${model.repo}` };
  modelJobs.set(model.id, job);
  run("nemo-speech", ["pull", model.repo], { timeout: 0 })
    .then((r) => {
      job.status = r.code === 0 ? "ready" : "failed";
      job.log = (r.stdout || r.stderr || "").split("\n").filter(Boolean).slice(-3).join(" ");
    })
    .catch((e) => {
      job.status = "failed";
      job.log = String(e.message || e);
    });
  json(res, 200, { id: model.id, status: job.status });
}

function apiModelStatus(_req, res, query) {
  const job = modelJobs.get(query.get("id") || "");
  if (!job) return json(res, 200, { id: query.get("id"), status: "unknown", log: "" });
  json(res, 200, { id: query.get("id"), status: job.status, log: job.log });
}

module.exports = {
  "GET /api/models": apiModels,
  "GET /api/models/status": apiModelStatus,
  "POST /api/models/download": apiModelDownload,
};

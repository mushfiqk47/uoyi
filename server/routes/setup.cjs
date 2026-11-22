"use strict";

// Settings → Setup panel: system check per tool plus in-app installation.
// GET  /api/setup/status  — every installable tool with detected state
// POST /api/setup/install — { id } starts provisioning (audio.cpp runtime, FFmpeg, yt-dlp, pip pkgs)
// GET  /api/setup/job?id= — progress of one install job

const { json, fail, readJson } = require("../lib/http.cjs");
const { setupJobs, touchEntry } = require("../state.cjs");
const { setupStatus, installerFor, toolInstalled } = require("../lib/tools.cjs");

async function apiSetupStatus(_req, res) {
  const items = await setupStatus();
  const jobs = {};
  for (const [id, job] of setupJobs) {
    touchEntry(job);
    jobs[id] = { status: job.status, log: job.log, progress: job.progress ?? 0 };
  }
  json(res, 200, { items, jobs });
}

async function apiSetupInstall(req, res) {
  const { id } = await readJson(req);
  const installer = installerFor(id);
  if (!installer) return fail(res, 400, `Unknown setup item: ${id}`);
  const job = setupJobs.get(id);
  if (job && job.status === "installing") {
    return json(res, 200, { id, status: job.status, log: job.log, progress: job.progress ?? 0 });
  }
  if (await toolInstalled(id)) {
    return json(res, 200, { id, status: "ready", log: "Already installed.", progress: 100 });
  }
  const now = Date.now();
  const entry = { status: "installing", log: "Starting setup…", progress: 0, createdAt: now, accessedAt: now };
  setupJobs.set(id, entry);
  (async () => {
    try {
      const log = (s, pct) => {
        entry.log = String(s);
        if (typeof pct === "number") entry.progress = pct;
        touchEntry(entry);
      };
      await installer(log);
      entry.status = "ready";
      entry.progress = 100;
      entry.log = "Setup complete.";
      touchEntry(entry);
    } catch (e) {
      entry.status = "failed";
      entry.log = String(e.message || e);
      touchEntry(entry);
    }
  })();
  json(res, 200, { id, status: entry.status, log: entry.log, progress: 0 });
}

function apiSetupJob(_req, res, query) {
  const id = query.get("id") || "";
  const job = setupJobs.get(id);
  if (!job) return json(res, 200, { id, status: "unknown", log: "", progress: 0 });
  touchEntry(job);
  json(res, 200, { id, status: job.status, log: job.log, progress: job.progress ?? 0 });
}

module.exports = {
  "GET /api/setup/status": apiSetupStatus,
  "POST /api/setup/install": apiSetupInstall,
  "GET /api/setup/job": apiSetupJob,
};

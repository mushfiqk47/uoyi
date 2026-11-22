"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { json, fail, readJson, sendFile } = require("../lib/http.cjs");
const { SESSION_TOKEN, mediaToken, isSameOriginBrowserRequest } = require("../lib/auth.cjs");
const { buildDiagnosticsReport, log } = require("../lib/logger.cjs");
const { CACHE } = require("../lib/files.cjs");
const {
  getWorkspaceSummary,
  setWorkspaceConfig,
  listProjects,
  saveProjectRecord,
  deleteProjectRecord,
  listWorkspaceMedia,
  getWorkspaceMedia,
  deleteWorkspaceMedia,
  saveSecretsPatch,
  getSecretsStatus,
} = require("../services/workspace.cjs");
const { mediaJobs } = require("../state.cjs");
const { setupStatus } = require("../lib/tools.cjs");

async function apiAuthBootstrap(req, res) {
  if (!isSameOriginBrowserRequest(req)) {
    return fail(res, 403, "Cross-site token requests are blocked.", "FORBIDDEN", req);
  }
  json(res, 200, {
    ok: true,
    token: SESSION_TOKEN,
    mediaToken: mediaToken(),
  }, req);
}

async function apiWorkspaceConfigGet(req, res) {
  const summary = await getWorkspaceSummary();
  json(res, 200, summary, req);
}

async function apiWorkspaceConfigSet(req, res) {
  const body = await readJson(req);
  try {
    await setWorkspaceConfig({
      workspaceDir: body.workspaceDir,
      autoSaveExports: body.autoSaveExports,
    });
    const summary = await getWorkspaceSummary();
    json(res, 200, summary, req);
  } catch (e) {
    fail(res, 400, String(e?.message || e || "Invalid workspace directory"), "BAD_WORKSPACE", req);
  }
}

async function apiProjectsList(req, res) {
  json(res, 200, { projects: listProjects() }, req);
}

async function apiProjectsSave(req, res) {
  const body = await readJson(req, 16 * 1024 * 1024);
  const project = body.project && typeof body.project === "object" ? body.project : body;
  if (!project || !project.id) return fail(res, 400, "Project id is required.", "BAD_PROJECT", req);
  const saved = await saveProjectRecord(project);
  json(res, 200, { ok: true, project: saved }, req);
}

async function apiProjectsDelete(req, res) {
  const body = await readJson(req);
  const removed = await deleteProjectRecord(body.id);
  json(res, 200, { ok: true, removed }, req);
}

async function apiMediaList(req, res) {
  const media = listWorkspaceMedia().map((m) => ({
    ...m,
    streamUrl: `/api/workspace/file?id=${encodeURIComponent(m.id)}`,
  }));
  json(res, 200, { media }, req);
}

async function apiMediaDelete(req, res) {
  const body = await readJson(req);
  const id = String(body.id || "");
  const removed = await deleteWorkspaceMedia(id);
  mediaJobs.delete(id);
  json(res, 200, { ok: true, removed }, req);
}

async function apiWorkspaceFile(req, res, query) {
  const id = query.get("id") || "";
  const record = getWorkspaceMedia(id);
  const job = mediaJobs.get(id);
  const filePath = record?.file || (job?.status === "ready" ? job.file : "");
  const mime = record?.mime || job?.mime || "video/mp4";
  if (!filePath || !fs.existsSync(filePath)) {
    return fail(res, 404, "Workspace media file was not found on disk.", "NOT_FOUND", req);
  }
  const resolved = path.resolve(filePath);
  const cfg = await getWorkspaceSummary();
  const allowedRoots = [path.resolve(cfg.workspaceDir), path.resolve(CACHE)];
  if (!allowedRoots.some((root) => resolved === root || resolved.startsWith(root + path.sep))) {
    return fail(res, 403, "Access outside workspace is blocked.", "FORBIDDEN", req);
  }
  await sendFile(req, res, resolved, mime);
}

async function apiSecretsGet(req, res) {
  json(res, 200, { configured: getSecretsStatus() }, req);
}

async function apiSecretsSave(req, res) {
  const body = await readJson(req);
  const configured = await saveSecretsPatch(body.secrets || body);
  log("info", "workspace", "Updated encrypted AI credential store", { configured });
  json(res, 200, { ok: true, configured }, req);
}

async function apiDiagnostics(req, res) {
  const [setup, summary] = await Promise.all([setupStatus().catch(() => null), getWorkspaceSummary().catch(() => null)]);
  const report = await buildDiagnosticsReport({
    setup: setup ? { items: setup.items, system: setup.system } : null,
    workspace: summary,
  });
  json(res, 200, report, req);
}

module.exports = {
  "GET /api/auth/bootstrap": apiAuthBootstrap,
  "GET /api/workspace/config": apiWorkspaceConfigGet,
  "POST /api/workspace/config": apiWorkspaceConfigSet,
  "GET /api/workspace/projects": apiProjectsList,
  "POST /api/workspace/projects": apiProjectsSave,
  "POST /api/workspace/projects/delete": apiProjectsDelete,
  "GET /api/workspace/media": apiMediaList,
  "POST /api/workspace/media/delete": apiMediaDelete,
  "GET /api/workspace/file": apiWorkspaceFile,
  "GET /api/workspace/secrets": apiSecretsGet,
  "POST /api/workspace/secrets": apiSecretsSave,
  "GET /api/diagnostics": apiDiagnostics,
};

"use strict";

const { json, fail, methodAndPath } = require("./lib/http.cjs");
const { applySecurityHeaders, isAuthorized } = require("./lib/auth.cjs");
const { log } = require("./lib/logger.cjs");

// One table per capability. Adding an endpoint means one route module entry and one client call.
const TABLES = [
  require("./routes/health.cjs"),
  require("./routes/workspace.cjs"),
  require("./routes/streams.cjs"),
  require("./routes/media.cjs"),
  require("./routes/clips.cjs"),
  require("./routes/streamlink.cjs"),
  require("./routes/scenedetect.cjs"),
  require("./routes/ai.cjs"),
  require("./routes/facecam.cjs"),
  require("./routes/models.cjs"),
  require("./routes/render.cjs"),
  require("./routes/setup.cjs"),
];

const ROUTES = new Map();
for (const table of TABLES) {
  for (const [key, handler] of Object.entries(table)) ROUTES.set(key, handler);
}

function match(method, pathname) {
  const verb = method === "HEAD" ? "GET" : method;
  return ROUTES.get(`${verb} ${pathname}`) || null;
}

async function route(req, res) {
  const { method, pathname, query } = methodAndPath(req);
  const handler = match(method, pathname);
  if (!handler) return false;
  return handler(req, res, query);
}

async function handle(req, res, next) {
  const { method, pathname, query } = methodAndPath(req);
  try {
    applySecurityHeaders(req, res);
    if (method === "OPTIONS" && (pathname.startsWith("/api") || pathname.startsWith("/stream") || pathname.startsWith("/media"))) {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Clipweave-Token, X-Clipweave-Local-Only");
      res.setHeader("Access-Control-Max-Age", "600");
      res.statusCode = 204;
      res.end();
      return;
    }

    const handler = match(method, pathname);
    if (!handler) {
      if (next) next();
      else json(res, 404, { ok: false, error: "Not found" }, req);
      return;
    }

    if (!isAuthorized(req, query, pathname)) {
      fail(res, 401, "Session authentication required. Reload ClipWeave if this persists.", "UNAUTHORIZED", req);
      return;
    }

    const done = await handler(req, res, query);
    if (done === false) {
      if (next) next();
      else json(res, 404, { ok: false, error: "Not found" }, req);
    }
  } catch (e) {
    log("error", "http", `${method} ${pathname} failed`, String(e?.message || e));
    if (!res.headersSent) fail(res, 500, String(e?.message || e), "INTERNAL_ERROR", req);
    else res.end();
  }
}

module.exports = { handle, route, match, ROUTES };

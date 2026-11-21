"use strict";

const { json, fail, methodAndPath } = require("./lib/http.cjs");

// One table per capability. Adding an endpoint means one route module entry and one client call.
const TABLES = [
  require("./routes/health.cjs"),
  require("./routes/streams.cjs"),
  require("./routes/media.cjs"),
  require("./routes/clips.cjs"),
  require("./routes/ai.cjs"),
  require("./routes/facecam.cjs"),
  require("./routes/models.cjs"),
  require("./routes/render-legacy.cjs"),
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
  try {
    const done = await route(req, res);
    if (done === false) {
      if (next) next();
      else json(res, 404, { ok: false, error: "Not found" });
    }
  } catch (e) {
    if (!res.headersSent) fail(res, 500, String(e.message || e));
    else res.end();
  }
}

module.exports = { handle, route, match, ROUTES };

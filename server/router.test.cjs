"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { match, ROUTES } = require("./router.cjs");

test("every route key is a method and path pair", () => {
  assert.ok(ROUTES.size > 15);
  for (const key of ROUTES.keys()) {
    assert.match(key, /^(GET|POST) \/[A-Za-z0-9/_-]+$/);
  }
});

test("match finds the active API surface and omits dead legacy render routes", () => {
  for (const [method, pathname] of [
    ["GET", "/api/health"],
    ["GET", "/api/cache"],
    ["POST", "/api/cache/prune"],
    ["GET", "/api/models"],
    ["GET", "/api/streamlink/list"],
    ["POST", "/api/streamlink/record"],
    ["POST", "/api/upload"],
    ["POST", "/api/clip/finalize"],
    ["POST", "/api/clip/cut"],
    ["POST", "/api/captions/generate"],
    ["POST", "/api/render/native"],
    ["GET", "/api/render/native/status"],
    ["GET", "/api/render/native/result"],
    ["POST", "/api/render/native/abort"],
    ["GET", "/stream"],
    ["GET", "/media"],
    ["GET", "/media/clip"],
  ]) {
    assert.equal(typeof match(method, pathname), "function", `${method} ${pathname}`);
  }

  for (const [method, pathname] of [
    ["POST", "/api/render"],
    ["POST", "/api/render/start"],
    ["POST", "/api/render/frames"],
    ["POST", "/api/render/finish"],
    ["POST", "/api/render/abort"],
  ]) {
    assert.equal(match(method, pathname), null, `legacy route should be removed: ${method} ${pathname}`);
  }
});

test("match treats HEAD as GET and returns null for unknown paths", () => {
  assert.equal(typeof match("HEAD", "/api/health"), "function");
  assert.equal(match("GET", "/api/nope"), null);
  assert.equal(match("POST", "/api/health"), null);
});

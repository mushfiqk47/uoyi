"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { SESSION_TOKEN, mediaToken, isSameOriginBrowserRequest, applySecurityHeaders, isAuthorized } = require("./auth.cjs");

function fakeReq(headers = {}) {
  return { headers };
}

test("SESSION_TOKEN and mediaToken are non-empty distinct hex tokens", () => {
  assert.ok(SESSION_TOKEN.length >= 16);
  assert.ok(mediaToken().length >= 16);
  assert.notEqual(SESSION_TOKEN, mediaToken());
});

test("isSameOriginBrowserRequest enforces same-origin & loopback equivalence and blocks cross-site", () => {
  assert.equal(isSameOriginBrowserRequest(fakeReq({ host: "localhost:3000" })), true);
  assert.equal(isSameOriginBrowserRequest(fakeReq({ host: "localhost:3000", origin: "http://127.0.0.1:3000" })), true);
  assert.equal(isSameOriginBrowserRequest(fakeReq({ host: "localhost:3000", origin: "https://evil.example" })), false);
  assert.equal(isSameOriginBrowserRequest(fakeReq({ host: "localhost:3000", "sec-fetch-site": "cross-site" })), false);
  assert.equal(isSameOriginBrowserRequest(fakeReq({ host: "localhost:3000", origin: "null" })), false);
});

test("isAuthorized accepts Bearer token and HMAC media token on protected routes", () => {
  const emptyQuery = new URLSearchParams();
  assert.equal(isAuthorized(fakeReq({ host: "localhost:3000" }), emptyQuery, "/api/health"), true);
  assert.equal(isAuthorized(fakeReq({ host: "localhost:3000" }), emptyQuery, "/api/cache"), false);
  assert.equal(isAuthorized(fakeReq({ authorization: `Bearer ${SESSION_TOKEN}` }), emptyQuery, "/api/cache"), true);
  assert.equal(isAuthorized(fakeReq({}), new URLSearchParams(`token=${mediaToken()}`), "/stream"), true);
  assert.equal(isAuthorized(fakeReq({}), new URLSearchParams("token=wrong"), "/stream"), false);
});

test("applySecurityHeaders sets defensive headers and echoes valid same-origin CORS", () => {
  const set = {};
  const res = {
    setHeader(k, v) {
      set[k] = v;
    },
  };
  applySecurityHeaders(fakeReq({ host: "127.0.0.1:3000", origin: "http://localhost:3000" }), res);
  assert.equal(set["X-Content-Type-Options"], "nosniff");
  assert.equal(set["Referrer-Policy"], "no-referrer");
  assert.equal(set["Access-Control-Allow-Origin"], "http://localhost:3000");
});

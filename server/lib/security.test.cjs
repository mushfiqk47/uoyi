"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { isPrivateIp, validateExternalHttpUrl, safeResolvedPath } = require("./security.cjs");

test("isPrivateIp identifies IPv4 and IPv6 private/loopback/metadata addresses", () => {
  assert.equal(isPrivateIp("127.0.0.1"), true);
  assert.equal(isPrivateIp("10.0.5.12"), true);
  assert.equal(isPrivateIp("172.16.0.1"), true);
  assert.equal(isPrivateIp("172.31.255.255"), true);
  assert.equal(isPrivateIp("192.168.1.1"), true);
  assert.equal(isPrivateIp("169.254.169.254"), true);
  assert.equal(isPrivateIp("100.64.0.1"), true);
  assert.equal(isPrivateIp("0.0.0.0"), true);
  assert.equal(isPrivateIp("::1"), true);
  assert.equal(isPrivateIp("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateIp("fe80::1"), true);
  assert.equal(isPrivateIp("fc00::1"), true);

  assert.equal(isPrivateIp("8.8.8.8"), false);
  assert.equal(isPrivateIp("172.32.0.1"), false);
  assert.equal(isPrivateIp("192.169.1.1"), false);
  assert.equal(isPrivateIp("2606:4700:4700::1111"), false);
});

test("validateExternalHttpUrl blocks private hosts, credentials, and bad schemes", async () => {
  for (const bad of [
    "file:///etc/passwd",
    "ftp://example.com/a.mp4",
    "http://user:pass@example.com/live.m3u8",
    "http://localhost:3000/api/health",
    "http://127.0.0.1:8080/live.m3u8",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.4/stream.m3u8",
    "http://[::1]/stream.m3u8",
    "https://my-nas.local/video.mp4",
    "https://metadata.google.internal/computeMetadata/v1/",
  ]) {
    const r = await validateExternalHttpUrl(bad, { resolveDns: false });
    assert.equal(r.ok, false, `expected reject for ${bad}`);
  }

  const ok = await validateExternalHttpUrl("https://cdn.example.com/live/index.m3u8", { resolveDns: false });
  assert.equal(ok.ok, true);
  assert.equal(ok.url.hostname, "cdn.example.com");

  const localAi = await validateExternalHttpUrl("http://localhost:11434/v1", { allowPrivate: true, resolveDns: false });
  assert.equal(localAi.ok, true);
});

test("safeResolvedPath confines paths to base directory", () => {
  const base = path.resolve("/tmp/clipweave-dist");
  assert.equal(safeResolvedPath(base, "/"), path.join(base, "index.html"));
  assert.equal(safeResolvedPath(base, "/assets/app.js"), path.join(base, "assets", "app.js"));
  assert.equal(safeResolvedPath(base, "/../secret.json"), null);
  assert.equal(safeResolvedPath(base, "/../../etc/passwd"), null);
});

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseRange, isPrivateIp, assertSafePublicUrl } = require("./http.cjs");

test("parseRange ignores a missing or non-byte range", () => {
  assert.equal(parseRange(undefined, 1000), null);
  assert.equal(parseRange("", 1000), null);
  assert.equal(parseRange("items=0-10", 1000), null);
});

test("parseRange resolves open and closed ranges", () => {
  assert.deepEqual(parseRange("bytes=0-99", 1000), { start: 0, end: 99, length: 100 });
  assert.deepEqual(parseRange("bytes=900-", 1000), { start: 900, end: 999, length: 100 });
  assert.deepEqual(parseRange("bytes=990-2000", 1000), { start: 990, end: 999, length: 10 });
});

test("parseRange rejects ranges that cannot be served", () => {
  assert.deepEqual(parseRange("bytes=1000-", 1000), { invalid: true });
  assert.deepEqual(parseRange("bytes=50-10", 1000), { invalid: true });
});

test("isPrivateIp identifies loopback, metadata, and RFC1918 ranges", () => {
  assert.equal(isPrivateIp("127.0.0.1"), true);
  assert.equal(isPrivateIp("169.254.169.254"), true);
  assert.equal(isPrivateIp("10.0.0.5"), true);
  assert.equal(isPrivateIp("172.16.0.1"), true);
  assert.equal(isPrivateIp("192.168.1.1"), true);
  assert.equal(isPrivateIp("::1"), true);
  assert.equal(isPrivateIp("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateIp("8.8.8.8"), false);
});

test("assertSafePublicUrl blocks localhost, private IPs, and non-http schemes", async () => {
  await assert.rejects(() => assertSafePublicUrl("http://127.0.0.1:3000/api/health"));
  await assert.rejects(() => assertSafePublicUrl("http://169.254.169.254/latest/meta-data/"));
  await assert.rejects(() => assertSafePublicUrl("http://localhost:8080/video.mp4"));
  await assert.rejects(() => assertSafePublicUrl("file:///etc/passwd"));
  const ok = await assertSafePublicUrl("https://93.184.216.34/video.mp4");
  assert.equal(ok.hostname, "93.184.216.34");
});

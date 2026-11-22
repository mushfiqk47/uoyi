"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseRange } = require("./http.cjs");

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

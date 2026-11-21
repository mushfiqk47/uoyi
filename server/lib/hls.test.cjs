"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isPlaylist, rewritePlaylist } = require("./hls.cjs");

test("isPlaylist detects the content type and the extension", () => {
  assert.equal(isPlaylist("application/vnd.apple.mpegurl", "https://x.test/a"), true);
  assert.equal(isPlaylist("video/mp2t", "https://x.test/a.m3u8?t=1"), true);
  assert.equal(isPlaylist("video/mp2t", "https://x.test/a.ts"), false);
});

test("rewritePlaylist routes segments and key URIs through /stream", () => {
  const target = new URL("https://cdn.example.com/live/index.m3u8");
  const source = [
    "#EXTM3U",
    '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
    "#EXT-X-MAP:URI=\"init.mp4\"",
    "seg1.ts",
    "",
    "https://other.example/seg2.ts",
  ].join("\n");

  const lines = rewritePlaylist(source, target).split("\n");
  const enc = (url) => `/stream?url=${encodeURIComponent(url)}`;

  assert.equal(lines[0], "#EXTM3U");
  assert.equal(lines[1], `#EXT-X-KEY:METHOD=AES-128,URI="${enc("https://cdn.example.com/live/key.bin")}"`);
  assert.equal(lines[2], `#EXT-X-MAP:URI="${enc("https://cdn.example.com/live/init.mp4")}"`);
  assert.equal(lines[3], enc("https://cdn.example.com/live/seg1.ts"));
  assert.equal(lines[4], "");
  assert.equal(lines[5], enc("https://other.example/seg2.ts"));
});

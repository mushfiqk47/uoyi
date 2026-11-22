"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { pickPlayable } = require("./media.cjs");

test("pickPlayable prefers the highest rendition at or below 1080p", () => {
  const info = {
    formats: [
      { url: "a", vcodec: "avc1", height: 2160 },
      { url: "b", vcodec: "avc1", height: 720 },
      { url: "c", vcodec: "avc1", height: 1080 },
      { url: "d", vcodec: "none", height: 1080 },
    ],
  };
  assert.equal(pickPlayable(info).url, "c");
});

test("pickPlayable falls back to the highest video and then the last format", () => {
  const tall = { formats: [{ url: "only", vcodec: "avc1", height: 1440 }] };
  assert.equal(pickPlayable(tall).url, "only");

  const unlabelled = { formats: [{ url: "one", vcodec: "avc1" }, { url: "two", vcodec: "avc1" }] };
  assert.equal(pickPlayable(unlabelled).url, "two");

  assert.equal(pickPlayable({ formats: [] }), null);
});

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { assFontName, assColor, buildOverlayAssContent } = require("./ass.cjs");

test("assFontName maps font ids to TTF families readable by libass", () => {
  assert.equal(assFontName("bebas"), "Bebas Neue");
  assert.equal(assFontName("tiktok"), "TikTok Sans SemiBold");
  assert.equal(assFontName("inter"), "Liberation Sans");
});

test("assColor converts hex RGB to ASS BGR format", () => {
  assert.equal(assColor("#38bdf8", "ffffff"), "&H00f8bd38");
  assert.equal(assColor("bad", "ffffff"), "&H00ffffff");
});

test("buildOverlayAssContent scales split layout captions and preserves text boxes", () => {
  const content = buildOverlayAssContent({
    layout: { mode: "split", facecamShare: 0.3 },
    captionStyle: { font: "inter", highlight: "#38bdf8", color: "#ffffff", y: 0.7, size: 112, wordsPerLine: 2, caps: true, stroke: true, background: false },
    captions: [
      { text: "huge", start: 0.2, end: 0.6 },
      { text: "clutch", start: 0.6, end: 1.1 },
    ],
    texts: [
      { id: "t1", text: "WAIT FOR IT", start: 0, end: 2.5, x: 0.5, y: 0.18, size: 88, color: "#facc15", font: "bebas", stroke: true, background: false },
    ],
  }, 1080, 1920);

  assert.ok(content.includes("Style: Default,Liberation Sans,112"));
  // 0.7 * (1 - 0.3) * 1920 = 941
  assert.ok(content.includes("\\pos(540,941)"));
  assert.ok(content.includes("HUGE"));
  assert.ok(content.includes("WAIT FOR IT"));
});

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseLoudnessAndSilences, parseSceneTimestamps } = require("./signals.cjs");

test("parseLoudnessAndSilences extracts separated peaks and silence windows", () => {
  const stderr = [
    "[silencedetect @ 0x1] silence_start: 4.125",
    "[Parsed_ebur128_1 @ 0x2] t: 2.0   TARGET:-23 LUFS    M: -21.4 S: -22.0",
    "[silencedetect @ 0x1] silence_end: 5.400 | silence_duration: 1.275",
    "[Parsed_ebur128_1 @ 0x2] t: 10.4  TARGET:-23 LUFS    M: -8.5 S: -12.0",
    "[Parsed_ebur128_1 @ 0x2] t: 11.2  TARGET:-23 LUFS    M: -9.0 S: -12.0",
    "[Parsed_ebur128_1 @ 0x2] t: 25.0  TARGET:-23 LUFS    M: -10.2 S: -13.0",
  ].join("\n");

  const { topPeaks, silences } = parseLoudnessAndSilences(stderr, { minSpacingSec: 8 });
  assert.deepEqual(silences, [{ start: 4.125, end: 5.4 }]);
  assert.equal(topPeaks.length, 3);
  assert.deepEqual(topPeaks.map((p) => p.time), [2, 10.4, 25]);
  assert.equal(topPeaks[1].lufs, -8.5);
});

test("parseSceneTimestamps groups showinfo cuts into bounded scene intervals", () => {
  const stderr = [
    "[Parsed_showinfo_1 @ 0x1] n: 0 pts: 0 pts_time:0.000 pos:123",
    "[Parsed_showinfo_1 @ 0x1] n: 1 pts: 45 pts_time:4.500 pos:456",
    "[Parsed_showinfo_1 @ 0x1] n: 2 pts: 49 pts_time:4.900 pos:500",
    "[Parsed_showinfo_1 @ 0x1] n: 3 pts: 120 pts_time:12.000 pos:999",
  ].join("\n");

  const scenes = parseSceneTimestamps(stderr, { duration: 20, minSceneLen: 1.5 });
  assert.deepEqual(scenes, [
    { start: 0, end: 4.5, duration: 4.5 },
    { start: 4.5, end: 12, duration: 7.5 },
    { start: 12, end: 20, duration: 8 },
  ]);
});

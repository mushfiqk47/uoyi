import { describe, expect, it } from "vitest";
import {
  RECORDING_CLIP_FINDER,
  RECORDING_CLIP_LIMITS,
  clipFinderOptions,
  type ClipFinderValues,
} from "./ClipFinderFields";
import { selectClipPicks, type ClipPick } from "../../lib/ai/findClips";

const pick = (score: number, start = 0): ClipPick => ({ start, end: start + 10, title: `clip ${start}`, reason: "", score });

describe("recording clip finder rules", () => {
  it("defaults to four clips and a score above 7", () => {
    expect(RECORDING_CLIP_FINDER.maxClips).toBe(4);
    expect(RECORDING_CLIP_FINDER.minScore).toBe(8);
  });

  it("clamps a larger count and a lower score chosen in the form", () => {
    const loose: ClipFinderValues = { ...RECORDING_CLIP_FINDER, maxClips: 10, minScore: 5 };
    const options = clipFinderOptions(loose, 7, RECORDING_CLIP_LIMITS);
    expect(options.maxClips).toBe(4);
    expect(options.minScore).toBe(8);
  });

  it("keeps auto mode within the recording limits even when the settings threshold is lower", () => {
    const options = clipFinderOptions({ ...RECORDING_CLIP_FINDER, maxClips: "auto", minScore: "auto" }, 7, RECORDING_CLIP_LIMITS);
    expect(options.maxClips).toBe(4);
    expect(options.minScore).toBe(8);
  });

  it("leaves the general finder untouched when no limits are given", () => {
    const options = clipFinderOptions({ ...RECORDING_CLIP_FINDER, maxClips: 8, minScore: 7 }, 7);
    expect(options.maxClips).toBe(8);
    expect(options.minScore).toBe(7);
  });
});

describe("selectClipPicks", () => {
  it("drops scores at or below 7 and keeps 8+", () => {
    const picks = selectClipPicks([pick(7), pick(8), pick(9)], 8, 4);
    expect(picks.map((p) => p.score)).toEqual([8, 9]);
  });

  it("accepts a single qualifying clip", () => {
    const picks = selectClipPicks([pick(6), pick(9)], 8, 4);
    expect(picks).toHaveLength(1);
    expect(picks[0].score).toBe(9);
  });

  it("never saves more than four clips even when more qualify", () => {
    const picks = selectClipPicks([8, 9, 10, 8, 9, 10].map((s, i) => pick(s, i * 20)), 8, 4);
    expect(picks).toHaveLength(4);
  });

  it("returns nothing when no clip reaches the score floor", () => {
    expect(selectClipPicks([pick(5), pick(7)], 8, 4)).toEqual([]);
  });
});

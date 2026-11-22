import { describe, expect, it } from "vitest";
import {
  dedupeOverlappingPicks,
  snapPicksToScenes,
  snapPicksToSignals,
  snapToSceneBoundary,
  sceneStartsForPrompt,
  type SceneSpanLike,
  type SilenceSpanLike,
} from "./scenes";

const span = (start: number, end = start + 8): SceneSpanLike => ({ start, end, duration: end - start });
const scenes = [span(10), span(25.5), span(40), span(60)];

describe("snapToSceneBoundary", () => {
  it("snaps to the nearest scene change inside the tolerance", () => {
    expect(snapToSceneBoundary(11, scenes)).toBe(10);
    expect(snapToSceneBoundary(24, scenes)).toBe(25.5);
  });

  it("keeps the timestamp when no scene change is close", () => {
    expect(snapToSceneBoundary(33, scenes)).toBe(33);
    expect(snapToSceneBoundary(52, scenes, 2)).toBe(52);
  });
});

describe("snapPicksToScenes", () => {
  it("moves starts onto scene changes and keeps the pick long enough", () => {
    const snapped = snapPicksToScenes([{ start: 11, end: 16, title: "t", reason: "", score: 9 }], scenes);
    expect(snapped[0].start).toBe(10);
    expect(snapped[0].end).toBeGreaterThanOrEqual(15);
  });

  it("returns picks untouched when no scenes were detected", () => {
    const picks = [{ start: 3, end: 13, title: "t", reason: "", score: 9 }];
    expect(snapPicksToScenes(picks, [])).toBe(picks);
  });
});

describe("sceneStartsForPrompt", () => {
  it("formats deduped scene starts", () => {
    expect(sceneStartsForPrompt([...scenes, span(10)])).toBe("10, 25.5, 40, 60");
  });

  it("caps the list so a long VOD cannot flood the prompt", () => {
    const many = Array.from({ length: 500 }, (_, i) => span(i * 10));
    expect(sceneStartsForPrompt(many).split(",").length).toBe(250);
  });
});

describe("dedupeOverlappingPicks", () => {
  it("suppresses lower-scoring overlapping duplicates while keeping distinct spans", () => {
    const picks = [
      { start: 10, end: 30, score: 7, title: "Lower overlap" },
      { start: 12, end: 32, score: 9, title: "Winner" },
      { start: 40, end: 55, score: 8, title: "Separate" },
    ];
    const kept = dedupeOverlappingPicks(picks);
    expect(kept.map((p) => p.title)).toEqual(["Winner", "Separate"]);
  });
});

describe("snapPicksToSignals", () => {
  const silences: SilenceSpanLike[] = [
    { start: 18, end: 20, duration: 2 },
    { start: 44.5, end: 46, duration: 1.5 },
  ];

  it("prefers scene boundaries for start, falls back to silence end, and snaps end to silence start", () => {
    const picks = [
      { start: 11.1, end: 18.8, title: "Scene + silence end" },
      { start: 20.6, end: 43.8, title: "Silence resume + end" },
    ];
    const snapped = snapPicksToSignals(picks, scenes, silences, 5);
    expect(snapped[0]).toMatchObject({ start: 10, end: 18 });
    expect(snapped[1]).toMatchObject({ start: 20, end: 44.5 });
  });

  it("never shrinks a pick below minKeep when snapping end to silence", () => {
    const snapped = snapPicksToSignals([{ start: 16, end: 22, title: "Short" }], [], silences, 8);
    expect(snapped[0].end - snapped[0].start).toBeGreaterThanOrEqual(8);
  });
});

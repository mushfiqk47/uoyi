import { describe, expect, it } from "vitest";
import type { CaptionWord } from "../types";
import { mapRawWordsToClipRanges } from "./captions";

const w = (id: string, text: string, start: number, end: number): CaptionWord => ({ id, text, start, end });

describe("mapRawWordsToClipRanges", () => {
  it("maps word timings onto trimmed and split clips with speed scaling", () => {
    const raw: CaptionWord[] = [
      w("1", "before", 0.5, 1.5),
      w("2", "clutch", 2.0, 3.0),
      w("3", "moment", 3.2, 4.0),
      w("4", "later", 10.0, 11.0),
      w("5", "gg", 11.5, 12.0),
    ];

    const mapped = mapRawWordsToClipRanges(raw, [
      { in: 2, out: 6, speed: 2 },
      { in: 10, out: 12, speed: 1 },
    ]);

    expect(mapped.map((m) => ({ text: m.text, start: m.start, end: m.end }))).toEqual([
      { text: "clutch", start: 0, end: 0.5 },
      { text: "moment", start: 0.6, end: 1 },
      { text: "later", start: 2, end: 3 },
      { text: "gg", start: 3.5, end: 4 },
    ]);
  });

  it("clamps words partially overlapping a trim boundary and returns input unchanged when clips are empty", () => {
    const raw = [w("1", "overlap", 1.5, 2.5)];
    expect(mapRawWordsToClipRanges(raw, [])).toBe(raw);
    const mapped = mapRawWordsToClipRanges(raw, [{ in: 2, out: 3, speed: 1 }]);
    expect(mapped[0]).toMatchObject({ text: "overlap", start: 0, end: 0.5 });
  });
});

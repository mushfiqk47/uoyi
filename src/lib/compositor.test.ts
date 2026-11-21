import { describe, expect, it } from "vitest";
import { captionPages } from "./compositor";
import type { CaptionWord } from "./types";

const word = (text: string, start: number, end: number): CaptionWord => ({ id: text, text, start, end });

describe("captionPages", () => {
  it("groups words up to the per-line limit", () => {
    const pages = captionPages([
      word("a", 0, 0.2), word("b", 0.2, 0.4), word("c", 0.4, 0.6), word("d", 0.6, 0.8),
    ], 2);
    expect(pages.map((p) => p.map((w) => w.text))).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("breaks a page when there is a pause over 0.6s", () => {
    const pages = captionPages([word("a", 0, 0.2), word("b", 2, 2.2)], 5);
    expect(pages).toHaveLength(2);
  });

  it("sorts words by start time before grouping", () => {
    const pages = captionPages([word("b", 0.4, 0.6), word("a", 0, 0.2)], 2);
    expect(pages[0].map((w) => w.text)).toEqual(["a", "b"]);
  });

  it("returns nothing for no words", () => {
    expect(captionPages([], 3)).toEqual([]);
  });
});

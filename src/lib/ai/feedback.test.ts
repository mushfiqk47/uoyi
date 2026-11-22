import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { feedbackSummary, loadFeedbackStats, recordClipFeedback, resetFeedbackStats } from "./feedback";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => store.clear(),
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("creator AI feedback calibration", () => {
  it("stays empty until at least two feedback events exist", () => {
    recordClipFeedback({ action: "favourite", score: 9, title: "First clutch" });
    expect(feedbackSummary()).toBe("");
    const stats = loadFeedbackStats();
    expect(stats.total).toBe(1);
    expect(stats.favourites).toBe(1);
    expect(stats.keptAvgScore).toBe(9);
  });

  it("tracks kept vs dismissed averages and generates prompt calibration summary", () => {
    recordClipFeedback({ action: "render", score: 9, title: "Clean win" });
    recordClipFeedback({ action: "edit", score: 8, title: "Funny reaction" });
    recordClipFeedback({ action: "dismiss", score: 6, title: "Slow loot" });

    const stats = loadFeedbackStats();
    expect(stats.total).toBe(3);
    expect(stats.keptAvgScore).toBe(8.5);
    expect(stats.dismissedAvgScore).toBe(6);

    const summary = feedbackSummary();
    expect(summary).toContain("Kept/rendered");
    expect(summary).toContain('"Clean win" (9/10)');
    expect(summary).toContain("Dismissed/deleted");
    expect(summary).toContain('"Slow loot" (6/10)');
  });

  it("clears all calibration stats on reset", () => {
    recordClipFeedback({ action: "favourite", score: 9, title: "One" });
    recordClipFeedback({ action: "dismiss", score: 5, title: "Two" });
    const cleared = resetFeedbackStats();
    expect(cleared.total).toBe(0);
    expect(loadFeedbackStats().total).toBe(0);
    expect(feedbackSummary()).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { isDefaultFacecamRect } from "./facecam";
import { DEFAULT_LAYOUT } from "../lib/project";

describe("isDefaultFacecamRect", () => {
  it("matches the uncustomized default placeholder rect", () => {
    expect(isDefaultFacecamRect({ ...DEFAULT_LAYOUT.facecam }, DEFAULT_LAYOUT.facecam)).toBe(true);
    expect(isDefaultFacecamRect({ x: 0.68001, y: 0.04, w: 0.3, h: 0.3 }, DEFAULT_LAYOUT.facecam)).toBe(true);
  });

  it("returns false when facecam box has been moved or resized", () => {
    expect(isDefaultFacecamRect({ x: 0.1, y: 0.04, w: 0.3, h: 0.3 }, DEFAULT_LAYOUT.facecam)).toBe(false);
    expect(isDefaultFacecamRect({ x: 0.68, y: 0.04, w: 0.25, h: 0.3 }, DEFAULT_LAYOUT.facecam)).toBe(false);
  });
});

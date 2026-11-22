import { describe, expect, it } from "vitest";
import { clamp, fmtBytes, fmtCount, fmtDuration, fmtTime, safeFileName } from "./util";

describe("fmtTime", () => {
  it("formats minutes and seconds", () => {
    expect(fmtTime(65)).toBe("1:05");
  });
  it("adds tenths when asked", () => {
    expect(fmtTime(65.04, true)).toBe("1:05.0");
  });
  it("clamps invalid input to zero", () => {
    expect(fmtTime(-5)).toBe("0:00");
    expect(fmtTime(NaN)).toBe("0:00");
  });
});

describe("fmtDuration", () => {
  it("uses the smallest sensible unit", () => {
    expect(fmtDuration(45)).toBe("45s");
    expect(fmtDuration(125)).toBe("2m 05s");
    expect(fmtDuration(3725)).toBe("1h 2m");
  });
});

describe("fmtCount", () => {
  it("abbreviates thousands and millions", () => {
    expect(fmtCount(999)).toBe("999");
    expect(fmtCount(1500)).toBe("1.5K");
    expect(fmtCount(2_400_000)).toBe("2.4M");
  });
});

describe("fmtBytes", () => {
  it("scales units", () => {
    expect(fmtBytes(500)).toBe("500 B");
    expect(fmtBytes(1_500_000)).toBe("1.5 MB");
  });
});

describe("clamp", () => {
  it("keeps values inside the range", () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(5, 0, 10)).toBe(5);
  });
});

describe("safeFileName", () => {
  it("replaces illegal characters and trims", () => {
    expect(safeFileName('  a/b:c*d?  ')).toBe("a-b-c-d");
  });
  it("falls back when the result is blank", () => {
    expect(safeFileName("///")).toBe("clip");
  });
});

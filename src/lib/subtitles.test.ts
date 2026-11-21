import { describe, expect, it } from "vitest";
import { parseSubtitles } from "./subtitles";

describe("parseSubtitles", () => {
  it("parses SRT cues and spreads words over the cue time", () => {
    const srt = "1\n00:00:01,000 --> 00:00:03,000\nhello world\n";
    const words = parseSubtitles(srt);
    expect(words.map((w) => w.text)).toEqual(["hello", "world"]);
    expect(words[0].start).toBe(1);
    expect(words[0].end).toBe(2);
    expect(words[1].start).toBe(2);
    expect(words[1].end).toBe(3);
  });

  it("parses WebVTT timestamps and strips inline tags", () => {
    const vtt = "WEBVTT\n\n00:00:02.500 --> 00:00:03.500\n<c>big</c> moment\n";
    const words = parseSubtitles(vtt);
    expect(words.map((w) => w.text)).toEqual(["big", "moment"]);
    expect(words[0].start).toBeCloseTo(2.5);
  });

  it("handles hour timestamps", () => {
    const words = parseSubtitles("1\n01:02:03,000 --> 01:02:04,000\nlate\n");
    expect(words[0].start).toBe(3723);
  });

  it("skips malformed cues", () => {
    expect(parseSubtitles("no timecode here\njust text")).toEqual([]);
  });

  it("skips cues whose end does not follow the start", () => {
    expect(parseSubtitles("1\n00:00:05,000 --> 00:00:02,000\nbackwards\n")).toEqual([]);
  });

  it("gives every word a unique id", () => {
    const words = parseSubtitles("1\n00:00:00,000 --> 00:00:02,000\na b c\n");
    expect(new Set(words.map((w) => w.id)).size).toBe(3);
  });
});

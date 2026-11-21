// One SRT/WebVTT reader shared by caption generation and the Editor's import panel.
import type { CaptionWord } from "./types";
import { uid } from "./util";

function parseTime(s: string): number {
  const parts = s.trim().replace(",", ".").split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(parts[0] || 0);
}

/** Reads SRT or WebVTT cues into words, spreading each cue's words evenly over its time. */
export function parseSubtitles(text: string): CaptionWord[] {
  const words: CaptionWord[] = [];
  const blocks = text.replace(/\r/g, "").split(/\n\n+/);
  for (const b of blocks) {
    const lines = b.split("\n");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, z] = lines[i].split("-->").map((x) => x.trim().split(" ")[0]);
    const start = parseTime(a);
    const end = parseTime(z);
    const content = lines
      .slice(i + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .split(/\s+/)
      .filter(Boolean);
    if (!content.length || !(end > start) || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    const each = (end - start) / content.length;
    content.forEach((w, k) => words.push({ id: uid("w"), text: w, start: start + k * each, end: start + (k + 1) * each }));
  }
  return words;
}

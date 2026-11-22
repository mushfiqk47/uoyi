import { loadJson, saveJson } from "../util";

export type ClipFeedbackAction = "favourite" | "edit" | "render" | "dismiss";

export interface FeedbackEntry {
  action: ClipFeedbackAction;
  score: number;
  title: string;
  reason?: string;
  at: number;
}

export interface FeedbackStats {
  total: number;
  favourites: number;
  edited: number;
  rendered: number;
  dismissed: number;
  keptAvgScore: number;
  dismissedAvgScore: number;
  entries: FeedbackEntry[];
}

const FEEDBACK_KEY = "clipkit.aiFeedback.v1";
const MAX_ENTRIES = 60;

const emptyStats = (): FeedbackStats => ({
  total: 0,
  favourites: 0,
  edited: 0,
  rendered: 0,
  dismissed: 0,
  keptAvgScore: 0,
  dismissedAvgScore: 0,
  entries: [],
});

function recompute(entries: FeedbackEntry[]): FeedbackStats {
  const s = emptyStats();
  s.entries = entries.slice(-MAX_ENTRIES);
  s.total = s.entries.length;
  let keptSum = 0;
  let keptCount = 0;
  let disSum = 0;
  let disCount = 0;
  for (const e of s.entries) {
    if (e.action === "favourite") s.favourites++;
    else if (e.action === "edit") s.edited++;
    else if (e.action === "render") s.rendered++;
    else if (e.action === "dismiss") s.dismissed++;
    if (e.action === "dismiss") {
      disSum += e.score;
      disCount++;
    } else {
      keptSum += e.score;
      keptCount++;
    }
  }
  s.keptAvgScore = keptCount ? Number((keptSum / keptCount).toFixed(1)) : 0;
  s.dismissedAvgScore = disCount ? Number((disSum / disCount).toFixed(1)) : 0;
  return s;
}

export function loadFeedbackStats(): FeedbackStats {
  const raw = loadJson<Partial<FeedbackStats> | null>(FEEDBACK_KEY, null);
  const entries = Array.isArray(raw?.entries) ? raw.entries.filter((e): e is FeedbackEntry => Boolean(e && typeof e.title === "string")) : [];
  return recompute(entries);
}

export function recordClipFeedback(entry: Omit<FeedbackEntry, "at"> & { at?: number }): FeedbackStats {
  const cur = loadFeedbackStats();
  const next: FeedbackEntry = {
    action: entry.action,
    score: Math.max(1, Math.min(10, Number(entry.score) || 7)),
    title: String(entry.title || "").slice(0, 80),
    reason: entry.reason ? String(entry.reason).slice(0, 120) : undefined,
    at: entry.at ?? Date.now(),
  };
  const updated = recompute([...cur.entries, next]);
  saveJson(FEEDBACK_KEY, updated);
  return updated;
}

export function resetFeedbackStats(): FeedbackStats {
  const cleared = emptyStats();
  saveJson(FEEDBACK_KEY, cleared);
  return cleared;
}

/** Builds a compact few-shot calibration hint from user actions for AI prompts. */
export function feedbackSummary(maxItems = 4): string {
  const s = loadFeedbackStats();
  if (s.total < 2) return "";
  const kept = s.entries.filter((e) => e.action !== "dismiss").slice(-maxItems);
  const dismissed = s.entries.filter((e) => e.action === "dismiss").slice(-maxItems);
  const lines: string[] = ["User calibration history (use this to match what the creator actually keeps vs skips):"];
  if (kept.length) {
    lines.push(`- Kept/rendered (${kept.length} recent, avg AI score ${s.keptAvgScore}): ${kept.map((e) => `"${e.title}" (${e.score}/10)`).join("; ")}`);
  }
  if (dismissed.length) {
    lines.push(`- Dismissed/deleted (${dismissed.length} recent, avg AI score ${s.dismissedAvgScore}): ${dismissed.map((e) => `"${e.title}" (${e.score}/10)`).join("; ")}`);
  }
  return lines.join("\n");
}

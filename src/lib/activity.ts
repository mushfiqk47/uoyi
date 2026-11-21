/**
 * Tiny in-memory activity feed for the Viewer's bottom console: a rolling list of what the
 * app just did or is about to do ("Recording …", "AI 8/10 — clip saved", errors). Subscribed
 * via useSyncExternalStore; nothing is persisted and there is no server round-trip.
 */
import { uid } from "./util";

export type ActivityTone = "info" | "success" | "warn" | "error";
export interface ActivityEntry {
  id: string;
  at: number;
  tone: ActivityTone;
  text: string;
}

const MAX = 80;
let entries: ActivityEntry[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function logActivity(tone: ActivityTone, text: string): void {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return;
  entries = [...entries, { id: uid("act"), at: Date.now(), tone, text: clean }].slice(-MAX);
  emit();
}

export function getActivity(): ActivityEntry[] {
  return entries;
}

export function subscribeActivity(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function clearActivity(): void {
  entries = [];
  emit();
}

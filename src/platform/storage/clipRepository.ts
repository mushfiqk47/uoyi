import type { Clip } from "../../lib/types";
import { loadJson, saveJson } from "../../lib/util";
import { STORAGE_KEYS } from "./keys";

function isClip(value: unknown): value is Clip {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return typeof c.id === "string" && typeof c.blobKey === "string" && typeof c.capturedAt === "number";
}

export function loadClips(): Clip[] {
  const raw = loadJson<unknown>(STORAGE_KEYS.clips, []);
  return Array.isArray(raw) ? raw.filter(isClip) : [];
}

/** Returns false when localStorage rejects the write (quota), which the store already surfaces. */
export function saveClips(clips: Clip[]): boolean {
  return saveJson(STORAGE_KEYS.clips, clips);
}

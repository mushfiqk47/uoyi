// Clip thumbnails used to live inline in the Clip record as base64 data URLs, which meant the
// whole clips list (2.5 MB at 100 clips) was written to localStorage on every change and started
// silently failing at the ~5 MB origin quota. They are small images, so they belong next to the
// other binary media in IndexedDB with an object URL resolved on demand.
import { deleteBlob, getBlob, putBlob } from "./db";
import type { Clip } from "./types";

const THUMB_PREFIX = "thumb:";
const urls = new Map<string, Promise<string | null>>();
const MAX_LIVE_URLS = 200;

export const thumbKeyFor = (clipId: string): string => `${THUMB_PREFIX}${clipId}`;

export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  const mime = /data:([^;]+)/.exec(dataUrl.slice(0, comma))?.[1] ?? "image/jpeg";
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Stores a capture's data URL and returns its IndexedDB key, or null when it can't be stored. */
export async function saveThumb(clipId: string, dataUrl: string | null | undefined): Promise<string | null> {
  if (!dataUrl || !dataUrl.startsWith("data:")) return null;
  const key = thumbKeyFor(clipId);
  try {
    await putBlob(key, dataUrlToBlob(dataUrl));
    return key;
  } catch {
    return null;
  }
}

export function thumbUrl(blobKey: string): Promise<string | null> {
  let p = urls.get(blobKey);
  if (p) {
    // Re-insert to mark as recently used (Map iterates in insertion order).
    urls.delete(blobKey);
    urls.set(blobKey, p);
    return p;
  }
  p = getBlob(blobKey)
    .then((b) => (b ? URL.createObjectURL(b) : null))
    .catch(() => null);
  urls.set(blobKey, p);
  while (urls.size > MAX_LIVE_URLS) {
    const oldest = urls.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    forgetThumbUrl(oldest);
  }
  return p;
}

function forgetThumbUrl(blobKey: string): void {
  const p = urls.get(blobKey);
  urls.delete(blobKey);
  p?.then((u) => u && URL.revokeObjectURL(u));
}

export async function deleteThumb(clipId: string): Promise<void> {
  const key = thumbKeyFor(clipId);
  forgetThumbUrl(key);
  await deleteBlob(key).catch(() => {});
}

/** One-time move of inline data-URL thumbnails into IndexedDB. */
export async function migrateInlineThumbs(clips: Clip[]): Promise<Map<string, string>> {
  const moved = new Map<string, string>();
  for (const clip of clips) {
    if (!clip.thumb?.startsWith("data:")) continue;
    const key = await saveThumb(clip.id, clip.thumb);
    if (key) moved.set(clip.id, key);
  }
  return moved;
}

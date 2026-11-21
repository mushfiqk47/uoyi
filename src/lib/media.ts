import type { Media, MediaKind } from "./types";
import { putBlob } from "./db";
import { uid } from "./util";

function kindOf(file: File): MediaKind | null {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("image/")) return "image";
  if (/\.(mp4|webm|mov|mkv|m4v)$/i.test(file.name)) return "video";
  if (/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name)) return "audio";
  if (/\.(png|jpe?g|webp|gif)$/i.test(file.name)) return "image";
  return null;
}

/** Recorded WebM has no duration until the browser has looked at its end. */
export function settleDuration(el: HTMLMediaElement): Promise<number> {
  if (Number.isFinite(el.duration)) return Promise.resolve(el.duration);
  return new Promise((resolve) => {
    const done = () => {
      if (!Number.isFinite(el.duration)) return;
      el.removeEventListener("durationchange", done);
      el.removeEventListener("timeupdate", done);
      const d = el.duration;
      el.currentTime = 0;
      resolve(d);
    };
    el.addEventListener("durationchange", done);
    el.addEventListener("timeupdate", done);
    el.currentTime = 1e7;
    setTimeout(() => resolve(Number.isFinite(el.duration) ? el.duration : 0), 4000);
  });
}

async function probe(blob: Blob, kind: MediaKind): Promise<{ duration: number; width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  try {
    if (kind === "image") {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { duration: 4, width: img.naturalWidth, height: img.naturalHeight };
    }
    const el = document.createElement(kind === "video" ? "video" : "audio");
    el.preload = "metadata";
    el.muted = true;
    el.src = url;
    await new Promise<void>((resolve, reject) => {
      el.onloadedmetadata = () => resolve();
      el.onerror = () => reject(new Error("This file can't be read by the browser"));
    });
    const duration = await settleDuration(el);
    const v = el as HTMLVideoElement;
    return { duration, width: v.videoWidth || 0, height: v.videoHeight || 0 };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function importFile(file: File): Promise<Media> {
  const kind = kindOf(file);
  if (!kind) throw new Error(`${file.name} isn't a video, audio or image file`);
  const meta = await probe(file, kind);
  const id = uid("m");
  const blobKey = `media:${id}`;
  await putBlob(blobKey, file);
  return { id, name: file.name.replace(/\.[^.]+$/, ""), kind, blobKey, ...meta };
}

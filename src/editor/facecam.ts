import { activeClipAt } from "../lib/project";
import { clamp } from "../lib/util";
import { detectFacecam as detectFacecamApi } from "../platform/api/ai";
import type { Layout, Project, Rect } from "../lib/types";
import type { Player } from "./player";

export interface FacecamDetection {
  ok: boolean;
  message: string;
  rect?: Rect;
  /** "toast" for problems the user must fix (no clip, no frame); "info" for quiet context. */
  notify: "toast" | "info";
}

/** Grabs the frame currently shown in the preview and asks the server to find the facecam. */
export async function detectFacecam(
  project: Project,
  player: Player,
  faceRef: { current: string | null },
): Promise<FacecamDetection> {
  const a = activeClipAt(project, player.clock.time) ?? (project.video[0] ? { clip: project.video[0] } : null);
  const visual = a ? player.pool.visuals.get(a.clip.mediaId) : undefined;
  if (!visual) return { ok: false, message: "Load a video clip first, then try again.", notify: "toast" };
  const sw = visual instanceof HTMLVideoElement ? visual.videoWidth : visual.naturalWidth;
  const sh = visual instanceof HTMLVideoElement ? visual.videoHeight : visual.naturalHeight;
  if (!sw || !sh) return { ok: false, message: "The clip's frame isn't ready yet.", notify: "toast" };
  const c = document.createElement("canvas");
  c.width = 640;
  c.height = Math.round((640 * sh) / sw);
  c.getContext("2d")!.drawImage(visual, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL("image/jpeg", 0.85);
  const imageBase64 = dataUrl.split(",")[1];
  const data = await detectFacecamApi({ imageBase64, referenceBase64: faceRef.current });
  if (!data.faces?.length || (data.best ?? -1) < 0) {
    return { ok: false, message: "No face found in this frame. Try a moment where the facecam is visible.", notify: "info" };
  }
  const f = data.faces[data.best ?? 0];
  if (!faceRef.current) faceRef.current = imageBase64;
  // Grow the detected face box around its centre so the crop keeps head, headset and
  // shoulders in frame instead of hugging the face tight.
  const w = clamp(f.w * 1.7, 0.05, 1);
  const h = clamp(f.h * 1.7, 0.05, 1);
  return {
    ok: true,
    message: `YuNet found ${data.faces.length} face${data.faces.length === 1 ? "" : "s"}; SFace locked the best match.`,
    rect: {
      x: clamp(f.x + f.w / 2 - w / 2, 0, 1 - w),
      y: clamp(f.y + f.h / 2 - h / 2, 0, 1 - h),
      w,
      h,
    },
    notify: "toast",
  };
}

/** Applies a detected facecam box and switches the project to the split layout. */
export function applyFacecam(editLayout: (patch: Partial<Layout>, key: string) => void, rect: Rect): void {
  editLayout({ facecam: rect, mode: "split" }, "facecam-ai");
}

/** Waits for the preview pool to hold a decodable frame, then returns it once, or null. */
export async function waitForReadyVisual(project: Project, player: Player, timeoutMs = 20000, stop: () => boolean = () => false): Promise<{ clipId: string; mediaId: string } | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (stop()) return null;
    const a = activeClipAt(project, player.clock.time) ?? (project.video[0] ? { clip: project.video[0] } : null);
    const v = a ? player.pool.visuals.get(a.clip.mediaId) : undefined;
    const w = v instanceof HTMLVideoElement ? v.videoWidth : v instanceof HTMLImageElement ? v.naturalWidth : 0;
    if (v && w > 0) return { clipId: a!.clip.id, mediaId: a!.clip.mediaId };
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

import type { CaptionStyle, Clip, Layout, Look, Media, Overlay, Project, Template, TextItem, VClip } from "./types";
import type { Settings } from "./settings";
import { safeFileName, uid } from "./util";

export const DEFAULT_LAYOUT: Layout = {
  mode: "split",
  zoom: 1,
  panX: 0,
  panY: 0,
  facecam: { x: 0.68, y: 0.04, w: 0.3, h: 0.3 },
  facecamShare: 0.3,
};

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  font: "bebas",
  size: 56,
  color: "#ffffff",
  highlight: "#38bdf8",
  stroke: true,
  caps: true,
  // Sits in the lower third of the game section in split mode (s.y is relative to the game area there).
  y: 0.65,
  wordsPerLine: 3,
  background: false,
};

export const DEFAULT_OVERLAY: Overlay = {
  platform: "off",
  name: "yourchannel",
  caption: "wait for it… #clips #gaming",
  song: "original sound",
  likes: 24600,
  comments: 312,
  shares: 1045,
  saves: 2210,
  verified: false,
};

export function lookFromSettings(s: Settings, templates: Template[]): Look & { templateId: string | null } {
  const t = templates.find((x) => x.id === s.defaultTemplateId);
  if (t) return { ...cloneLook(t), templateId: t.id };
  return {
    layout: { ...DEFAULT_LAYOUT, mode: s.defaultLayout },
    captionStyle: { ...DEFAULT_CAPTION_STYLE, font: s.defaultCaptionFont, highlight: s.accent === "#fafafa" ? "#facc15" : s.accent },
    overlay: { ...DEFAULT_OVERLAY, platform: s.defaultOverlay },
    texts: [],
    templateId: null,
  };
}

export function cloneLook(l: Look): Look {
  return {
    layout: { ...l.layout, facecam: { ...l.layout.facecam } },
    captionStyle: { ...l.captionStyle },
    overlay: { ...l.overlay },
    texts: l.texts.map((t) => ({ ...t, id: uid("t") })),
  };
}

export function newProject(name: string, look: Look & { templateId: string | null }, media: Media[] = [], clipId: string | null = null): Project {
  const now = Date.now();
  return {
    version: 1,
    id: uid("p"),
    name,
    clipId,
    media,
    video: [],
    music: [],
    captions: [],
    createdAt: now,
    updatedAt: now,
    ...look,
  };
}

export const clipLength = (c: VClip) => Math.max(0.05, (c.out - c.in) / c.speed);

export function projectDuration(p: Project): number {
  const v = p.video.reduce((a, c) => a + clipLength(c), 0);
  const m = p.music.reduce((a, c) => Math.max(a, c.start + (c.out - c.in)), 0);
  return v > 0 ? v : m;
}

/** Where each video clip starts on the timeline. */
export function clipStarts(p: Project): number[] {
  const out: number[] = [];
  let t = 0;
  for (const c of p.video) {
    out.push(t);
    t += clipLength(c);
  }
  return out;
}

export interface ActiveClip {
  clip: VClip;
  index: number;
  start: number;
  /** Time inside the source media. */
  local: number;
}

export function activeClipAt(p: Project, t: number): ActiveClip | null {
  let start = 0;
  for (let i = 0; i < p.video.length; i++) {
    const c = p.video[i];
    const len = clipLength(c);
    if (t < start + len || i === p.video.length - 1) {
      if (t > start + len) return null;
      return { clip: c, index: i, start, local: c.in + Math.max(0, t - start) * c.speed };
    }
    start += len;
  }
  return null;
}

/**
 * Removes a video clip together with the sound the app mirrored for it. Audio the user added
 * stays, and when multiple auto tracks exist from splits only the matching split range is removed
 * while subsequent auto tracks shift left cleanly.
 */
export function withoutVideoClip(p: Project, clipId: string): Project {
  const starts = clipStarts(p);
  const idx = p.video.findIndex((v) => v.id === clipId);
  if (idx < 0) return p;
  const removed = p.video[idx];
  const removedStart = starts[idx];
  const removedLen = clipLength(removed);
  const video = p.video.filter((v) => v.id !== clipId);
  const autoForMedia = p.music.filter((m) => m.auto && m.mediaId === removed.mediaId);
  const stillUsed = video.some((v) => v.mediaId === removed.mediaId);

  const music = p.music
    .filter((m) => {
      if (!m.auto || m.mediaId !== removed.mediaId) return true;
      if (autoForMedia.length <= 1) return stillUsed;
      const matchesSlice =
        Math.abs(m.start - removedStart) <= 0.15 &&
        Math.abs(m.in - removed.in) <= 0.15 &&
        Math.abs(m.out - removed.out) <= 0.15;
      return !matchesSlice && stillUsed;
    })
    .map((m) => {
      if (!m.auto) return m;
      if (m.start >= removedStart + removedLen - 0.1) {
        return { ...m, start: Math.max(0, Number((m.start - removedLen).toFixed(3))) };
      }
      return m;
    });
  return { ...p, video, music };
}

/** Splits the active video clip at `timelineTime`, also splitting any mirrored auto audio track. */
export function splitVideoClipAt(
  p: Project,
  timelineTime: number,
  makeId: (prefix: string) => string = uid,
): { project: Project; selectedId: string } | null {
  const a = activeClipAt(p, timelineTime);
  if (!a) return null;
  const at = a.local;
  if (at - a.clip.in < 0.1 || a.clip.out - at < 0.1) return null;
  const second = { ...a.clip, id: makeId("v"), in: at };
  const splitTimeline = a.start + (at - a.clip.in) / a.clip.speed;
  const video = p.video.flatMap((v) => (v.id === a.clip.id ? [{ ...v, out: at }, second] : [v]));
  const music = p.music.flatMap((m) => {
    if (!m.auto || m.mediaId !== a.clip.mediaId) return [m];
    const mEnd = m.start + (m.out - m.in);
    if (splitTimeline <= m.start + 0.05 || splitTimeline >= mEnd - 0.05) return [m];
    const acCut = Number((m.in + (splitTimeline - m.start) * a.clip.speed).toFixed(3));
    if (acCut <= m.in + 0.05 || acCut >= m.out - 0.05) return [m];
    return [
      { ...m, out: acCut },
      { ...m, id: makeId("a"), start: Number(splitTimeline.toFixed(3)), in: acCut },
    ];
  });
  return { project: { ...p, video, music }, selectedId: second.id };
}

export function lookOf(p: Project): Look {
  return { layout: p.layout, captionStyle: p.captionStyle, overlay: p.overlay, texts: p.texts };
}

/** Ready-to-post copy for a clip: caption on one line, hashtags on the next. */
export function postCopyText(clip: Clip): string {
  const v = clip.viral;
  if (!v) return "";
  return [v.caption, v.hashtags.join(" ")].filter(Boolean).join("\n").trim();
}

/** Short on-video hook: at most six words and exactly one emoji. */
export function hookTileText(clip: Clip): string {
  const raw = String(clip.viral?.hook || "").trim();
  if (!raw) return "";
  const emojis = raw.match(/\p{Extended_Pictographic}/gu) || [];
  const words = raw
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join(" ")
    .toUpperCase();
  if (!words) return emojis[0] ?? "";
  return `${words} ${emojis[0] ?? "🔥"}`;
}

/** The hook burned in just above the game/face boundary as a text layer. */
export function hookTextItem(clip: Clip): TextItem | null {
  const text = hookTileText(clip);
  if (!text) return null;
  return {
    id: uid("t"),
    text,
    start: 0,
    end: Math.max(1, clip.duration - clip.in),
    x: 0.5,
    y: 0.7,
    size: 40,
    color: "#ffffff",
    font: "tiktok",
    stroke: false,
    background: true,
  };
}

export function fileNameFor(pattern: string, title: string): string {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const time = `${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
  const raw = pattern.replaceAll("{title}", title).replaceAll("{date}", date).replaceAll("{time}", time).trim() || title;
  return safeFileName(raw);
}

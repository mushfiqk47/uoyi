import type { CaptionStyle, Clip, Layout, Look, Media, Overlay, Project, Template, TextItem, VClip } from "./types";
import type { Settings } from "./settings";
import { uid } from "./util";

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
  // Hugs the bottom edge of the game section in split mode (s.y is relative to the game area there).
  y: 0.9,
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
  return {
    version: 1,
    id: uid("p"),
    name,
    clipId,
    media,
    video: [],
    music: [],
    captions: [],
    updatedAt: Date.now(),
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
 * stays, and the mirrored audio only goes once no remaining video clip uses that media (a split
 * produces several video clips from one media).
 */
export function withoutVideoClip(p: Project, clipId: string): Project {
  const removed = p.video.find((v) => v.id === clipId);
  if (!removed) return p;
  const video = p.video.filter((v) => v.id !== clipId);
  if (video.some((v) => v.mediaId === removed.mediaId)) return { ...p, video };
  return { ...p, video, music: p.music.filter((m) => !(m.auto && m.mediaId === removed.mediaId)) };
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
  return pattern.replaceAll("{title}", title).replaceAll("{date}", date).replaceAll("{time}", time).trim() || title;
}

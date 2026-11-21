import { DEFAULT_CAPTION_STYLE, DEFAULT_LAYOUT, DEFAULT_OVERLAY } from "./project";
import type { Template } from "./types";

const BASE_TIME = 1700000000000;

/**
 * Curated viral Shorts / TikTok / Reels presets inspired by top-performing gaming & streamer styles:
 * - Hormozi / MrBeast kinetic pop captions (high-contrast white + neon yellow/green, 2-3 words)
 * - Neon Cyber FPS glow
 * - Safe-zone Fit minimalist box (preserves game HUDs)
 * - Viral Hook Punch & TikTok Stream Ready
 */
export const PREMADE_TEMPLATES: Template[] = [
  {
    id: "preset-beast-pop",
    name: "Beast Kinetic Pop",
    favorite: true,
    updatedAt: BASE_TIME + 6,
    layout: {
      ...DEFAULT_LAYOUT,
      mode: "split",
      facecamShare: 0.34,
    },
    captionStyle: {
      ...DEFAULT_CAPTION_STYLE,
      font: "bebas",
      size: 64,
      color: "#ffffff",
      highlight: "#facc15",
      stroke: true,
      caps: true,
      y: 0.88,
      wordsPerLine: 2,
      background: false,
    },
    overlay: { ...DEFAULT_OVERLAY, platform: "off" },
    texts: [],
  },
  {
    id: "preset-clutch-split",
    name: "Clutch Green Split",
    favorite: false,
    updatedAt: BASE_TIME + 5,
    layout: {
      ...DEFAULT_LAYOUT,
      mode: "split",
      facecamShare: 0.36,
    },
    captionStyle: {
      ...DEFAULT_CAPTION_STYLE,
      font: "bebas",
      size: 58,
      color: "#ffffff",
      highlight: "#22c55e",
      stroke: true,
      caps: true,
      y: 0.9,
      wordsPerLine: 3,
      background: false,
    },
    overlay: { ...DEFAULT_OVERLAY, platform: "off" },
    texts: [],
  },
  {
    id: "preset-neon-cyber",
    name: "Neon Cyber FPS",
    favorite: false,
    updatedAt: BASE_TIME + 4,
    layout: {
      ...DEFAULT_LAYOUT,
      mode: "split",
      facecamShare: 0.32,
    },
    captionStyle: {
      ...DEFAULT_CAPTION_STYLE,
      font: "bebas",
      size: 60,
      color: "#38bdf8",
      highlight: "#ec4899",
      stroke: true,
      caps: true,
      y: 0.84,
      wordsPerLine: 2,
      background: false,
    },
    overlay: { ...DEFAULT_OVERLAY, platform: "off" },
    texts: [],
  },
  {
    id: "preset-clean-box",
    name: "Minimal Frosted Box",
    favorite: false,
    updatedAt: BASE_TIME + 3,
    layout: {
      ...DEFAULT_LAYOUT,
      mode: "fit",
      zoom: 1,
      panX: 0,
      panY: 0,
    },
    captionStyle: {
      ...DEFAULT_CAPTION_STYLE,
      font: "inter",
      size: 46,
      color: "#ffffff",
      highlight: "#38bdf8",
      stroke: false,
      caps: false,
      y: 0.78,
      wordsPerLine: 4,
      background: true,
    },
    overlay: { ...DEFAULT_OVERLAY, platform: "off" },
    texts: [],
  },
  {
    id: "preset-hook-punch",
    name: "Viral Hook Punch",
    favorite: false,
    updatedAt: BASE_TIME + 2,
    layout: {
      ...DEFAULT_LAYOUT,
      mode: "fill",
      zoom: 1.05,
      panX: 0,
      panY: 0,
    },
    captionStyle: {
      ...DEFAULT_CAPTION_STYLE,
      font: "tiktok",
      size: 58,
      color: "#ffffff",
      highlight: "#facc15",
      stroke: true,
      caps: true,
      y: 0.74,
      wordsPerLine: 2,
      background: false,
    },
    overlay: { ...DEFAULT_OVERLAY, platform: "off" },
    texts: [
      {
        id: "preset-hook-text",
        text: "WAIT FOR IT 🔥",
        start: 0,
        end: 2.8,
        x: 0.5,
        y: 0.16,
        size: 64,
        color: "#facc15",
        font: "bebas",
        stroke: true,
        background: true,
      },
    ],
  },
  {
    id: "preset-tiktok-ready",
    name: "TikTok Stream Ready",
    favorite: false,
    updatedAt: BASE_TIME + 1,
    layout: {
      ...DEFAULT_LAYOUT,
      mode: "split",
      facecamShare: 0.38,
    },
    captionStyle: {
      ...DEFAULT_CAPTION_STYLE,
      font: "tiktok",
      size: 54,
      color: "#ffffff",
      highlight: "#fe2c55",
      stroke: true,
      caps: true,
      y: 0.86,
      wordsPerLine: 3,
      background: false,
    },
    overlay: { ...DEFAULT_OVERLAY, platform: "tiktok" },
    texts: [],
  },
];

export function missingPremadeTemplates(existing: Template[]): Template[] {
  const ids = new Set(existing.map((t) => t.id));
  return PREMADE_TEMPLATES.filter((t) => !ids.has(t.id)).map((t) => ({
    ...t,
    layout: { ...t.layout, facecam: { ...t.layout.facecam } },
    captionStyle: { ...t.captionStyle },
    overlay: { ...t.overlay },
    texts: t.texts.map((x) => ({ ...x })),
  }));
}

import type { CaptionFont, LayoutMode, OverlayPlatform, PhoneStyle } from "./types";
import { loadJson, saveJson } from "./util";
import { MIGRATIONS, STORAGE_KEYS } from "../platform/storage/keys";
import { once } from "../platform/storage/migrations";

export interface AiProfile {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** The profile the app should talk to, based on Settings → AI → Endpoint. */
export const activeAi = (s: Pick<Settings, "aiProfile" | "aiLocal" | "aiCloud" | "aiGemini" | "aiOpenAi" | "aiKilo">): AiProfile =>
  s.aiProfile === "cloud" ? s.aiCloud
    : s.aiProfile === "gemini" ? s.aiGemini
      : s.aiProfile === "openai" ? s.aiOpenAi
        : s.aiProfile === "kilo" ? s.aiKilo
          : s.aiLocal;

export type ThemeId = "glint" | "original" | "mono";
export type ButtonStyle = "glint" | "classic" | "keycap" | "mono";

export interface Settings {
  setupDone: boolean;
  theme: ThemeId;
  accent: string;
  background: string | null;
  buttonStyle: ButtonStyle;
  rollingBuffer: boolean;
  captureSeconds: 15 | 30 | 60 | 120;
  /** Hassle-free recording: start a continuous real-time recording on every stream. */
  autoRecord: boolean;
  /** Auto-save the running recording to Records after this many seconds. */
  recordSaveSeconds: number;
  /** Full HD uses a higher bitrate and lets HLS pick a 1080p rendition. */
  recordQuality: "fullhd" | "smooth";
  afterClip: "edit" | "stay";
  defaultLayout: LayoutMode;
  defaultOverlay: OverlayPlatform;
  defaultCaptionFont: CaptionFont;
  phone: PhoneStyle;
  defaultTemplateId: string | null;
  exportHeight: 720 | 1080;
  exportFps: number;
  exportFormat: "webm" | "mp4";
  /** Save each finished render straight to a folder picked once in Settings → Rendering. */
  autoDownloadRenders: boolean;
  /** Open clips in the Editor with the 9:16 frame and Fit layout already applied. */
  autoFitOnOpen: boolean;
  /** Automatically detect the facecam when using the Facecam + game layout (on by default). */
  autoFacecamOnOpen: boolean;
  fileNamePattern: string;
  nameBeforeRender: boolean;
  viewerLayout: "grid" | "rows" | "focus" | "side";
  // AI / automation
  /** Which AI profile the app talks to. */
  aiProfile: "local" | "cloud" | "gemini" | "openai" | "kilo";
  /** Local Ollama (default: the same MiMo model the Colab notebook serves). */
  aiLocal: AiProfile;
  /** Google Colab + Cloudflare quick tunnel from mimo_v26_heretic_ollama_colab.ipynb. */
  aiCloud: AiProfile;
  /** Google Gemini through its OpenAI-compatible endpoint. */
  aiGemini: AiProfile;
  /** OpenAI or any other OpenAI-compatible chat endpoint. */
  aiOpenAi: AiProfile;
  /** Preconfigured 9Router route (OpenAI-compatible tunnel, free auto model). */
  aiKilo: AiProfile;
  nemoSpeechUrl: string;
  /** Catalog id of the local caption model (audio.cpp GGUF or nemo-speech entry). */
  captionModel: string;
  autoCaptionOnClip: boolean;
  aiClipPrompt: string;
  aiAutoClip: boolean;
  /** Minutes between AI checks of each open stream (3–15). */
  aiClipInterval: number;
  aiClipThreshold: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  maxStreams: 2 | 3 | 4;
}

export const ACCENTS = [
  { id: "white", value: "#fafafa" },
  { id: "cyan", value: "#38bdf8" },
  { id: "blue", value: "#0099ff" },
  { id: "violet", value: "#8b5cf6" },
  { id: "green", value: "#22c55e" },
  { id: "amber", value: "#f59e0b" },
  { id: "pink", value: "#ec4899" },
];

export const BACKGROUNDS = [
  { id: "zinc", value: "#18181b" },
  { id: "ink", value: "#111111" },
  { id: "black", value: "#0a0a0a" },
  { id: "slate", value: "#13161c" },
];

export const THEMES: { id: ThemeId; name: string; blurb: string; buttons: ButtonStyle; accent: string }[] = [
  { id: "glint", name: "Glint", blurb: "The default: quiet filled buttons and one cyan accent", buttons: "glint", accent: "#38bdf8" },
  { id: "original", name: "Original", blurb: "The classic look from the early releases", buttons: "classic", accent: "#38bdf8" },
  { id: "mono", name: "Mono", blurb: "Quiet graphite with a white accent", buttons: "mono", accent: "#fafafa" },
];

export const DEFAULT_SETTINGS: Settings = {
  setupDone: false,
  theme: "glint",
  accent: "#38bdf8",
  background: null,
  buttonStyle: "glint",
  rollingBuffer: true,
  captureSeconds: 30,
  autoRecord: false,
  recordSaveSeconds: 300,
  recordQuality: "fullhd",
  afterClip: "stay",
  defaultLayout: "split",
  defaultOverlay: "off",
  defaultCaptionFont: "bebas",
  phone: "iphone",
  defaultTemplateId: null,
  exportHeight: 1080,
  exportFps: 60,
  exportFormat: "mp4",
  autoDownloadRenders: false,
  autoFitOnOpen: false,
  autoFacecamOnOpen: true,
  fileNamePattern: "{title}",
  nameBeforeRender: false,
  viewerLayout: "grid",
  aiProfile: "gemini",
  aiLocal: { baseUrl: "http://localhost:11434/v1", apiKey: "", model: "mimo-v2.6-heretic" },
  aiCloud: { baseUrl: "", apiKey: "", model: "mimo-v2.6-heretic" },
  aiGemini: { baseUrl: "", apiKey: "", model: "gemini-4-hydrogen" },
  aiOpenAi: { baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-4o-mini" },
  aiKilo: { baseUrl: "", apiKey: "", model: "kc/kilo-auto/free" },
  nemoSpeechUrl: "",
  captionModel: "parakeet-tdt",
  autoCaptionOnClip: true,
  aiClipPrompt:
    "You are an expert viral short-form video & livestream editor (TikTok, YouTube Shorts, Instagram Reels). Given timestamped audio/visual logs or stream context, find the highest-retention viral moments (15-60s). Prioritize instant first-3-second visual/audio hooks, intense action or clutch plays, genuine creator reactions (laughter, shock, hype, frustration), surprising reveals, and clear payoffs. Give every clip a punchy title, a 3-second on-screen text hook, viral score breakdown, platform fit, editing tips, and social caption + hashtags.",
  aiAutoClip: false,
  aiClipInterval: 3,
  aiClipThreshold: 7,
  maxStreams: 4,
};

const KEY = STORAGE_KEYS.settings;

/** Small non-reversible string fingerprint (djb2), used to recognize retired default values
 *  without keeping the old endpoint/key literals in source. */
function fingerprint(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

interface LegacyAiFields {
  aiBaseUrl?: string;
  aiApiKey?: string;
  aiModel?: string;
}

export function loadSettings(): Settings {
  const saved = loadJson<Partial<Settings> & LegacyAiFields>(KEY, {});
  const loaded: Settings = { ...DEFAULT_SETTINGS, ...saved };
  // Upgrade legacy Gemini profile defaults (old browser OpenAI-compat URL with no key) to server-side AI Studio Gemini,
  // but never discard a key the user entered in Settings.
  if (loaded.aiGemini) {
    const legacyGeminiUrl = !loaded.aiGemini.baseUrl || loaded.aiGemini.baseUrl.includes("generativelanguage.googleapis.com");
    if (legacyGeminiUrl && !loaded.aiGemini.apiKey) {
      loaded.aiGemini = { baseUrl: "", apiKey: "", model: "gemini-4-hydrogen" };
    } else if (loaded.aiGemini.model === "gemini-2.5-flash") {
      loaded.aiGemini.model = "gemini-4-hydrogen";
    }
  }
  // The single endpoint triple became two profiles; whatever the user had becomes the cloud
  // profile (the Colab tunnel is the usual use case) and activates it.
  once(MIGRATIONS.aiProfile, () => {
    const legacyUrl = String(saved.aiBaseUrl || "").trim();
    if (legacyUrl || saved.aiApiKey || saved.aiModel) {
      loaded.aiCloud = {
        baseUrl: String(saved.aiBaseUrl || ""),
        apiKey: String(saved.aiApiKey || ""),
        model: String(saved.aiModel || "mimo-v2.6-heretic"),
      };
      loaded.aiProfile = "cloud";
    }
  });
  // One-time migration: remove the endpoint/key/model that used to be shipped as defaults.
  // After this, the values are whatever you save yourself in Settings → AI. The old literals
  // are matched by fingerprint so this still fires for sessions saved before the cleanup.
  once(MIGRATIONS.credentials, () => {
    if (fingerprint(loaded.aiCloud.baseUrl) === "845b6daa") loaded.aiCloud.baseUrl = "";
    if (fingerprint(loaded.aiCloud.apiKey) === "f38614cb") loaded.aiCloud.apiKey = "";
    if (fingerprint(loaded.aiCloud.model) === "250965c3" || fingerprint(loaded.aiCloud.model) === "78d13152") loaded.aiCloud.model = "mimo-v2.6-heretic";
    if (fingerprint(loaded.nemoSpeechUrl) === "335dbffd") loaded.nemoSpeechUrl = "";
  });
  if (loaded.aiKilo?.baseUrl && loaded.aiKilo.baseUrl.includes("rjvi38q.abc-tunnel.us")) {
    loaded.aiKilo = { ...loaded.aiKilo, baseUrl: "" };
  }
  delete (loaded as Partial<LegacyAiFields>).aiBaseUrl;
  delete (loaded as Partial<LegacyAiFields>).aiApiKey;
  delete (loaded as Partial<LegacyAiFields>).aiModel;
  once(MIGRATIONS.fps, () => {
    if (loaded.exportFps < 60) loaded.exportFps = 60;
  });
  loaded.exportFps = Math.max(60, Math.round(Number(loaded.exportFps) || 60));
  // The check interval used to be seconds (10/20/30/60); it is now minutes (3–15).
  once(MIGRATIONS.aiInterval, () => {
    if (loaded.aiClipInterval <= 60) loaded.aiClipInterval = 3;
  });
  loaded.aiClipInterval = Math.min(15, Math.max(3, Math.round(loaded.aiClipInterval || 3)));
  // The interval used to be a fixed minute choice; it is now seconds with presets and a custom value.
  once(MIGRATIONS.recordSeconds, () => {
    const legacy = (saved as Record<string, unknown>).recordSaveMinutes;
    if (typeof legacy === "number" && legacy > 0) loaded.recordSaveSeconds = Math.round(legacy * 60);
  });
  delete (loaded as Partial<Record<"recordSaveMinutes", unknown>>).recordSaveMinutes;
  loaded.recordSaveSeconds = Math.min(7200, Math.max(30, Math.round(Number(loaded.recordSaveSeconds) || 300)));
  if (loaded.recordQuality !== "smooth" && loaded.recordQuality !== "fullhd") loaded.recordQuality = "fullhd";
  // Default layout shifted to Facecam + game (split) for streamer/gaming clips.
  once(MIGRATIONS.defaultLayoutSplit, () => {
    if (loaded.defaultLayout === "fill") loaded.defaultLayout = "split";
  });
  // Render filenames dropped the date; only the shipped default is rewritten, custom patterns stay.
  if (loaded.fileNamePattern === "{title} {date}") loaded.fileNamePattern = "{title}";
  return loaded;
}

export function saveSettings(s: Settings): void {
  saveJson(KEY, s);
}

// ---- Theme maths, after themes.ts: accent shades are mixes toward black and white, and the
// ink on the accent is picked by WCAG relative luminance.
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: number[]): string {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

function mix(hex: string, toward: string, amount: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(toward);
  return rgbToHex(a.map((v, i) => v + (b[i] - v) * amount));
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function inkOn(hex: string): string {
  return luminance(hex) > 0.179 ? "#101010" : "#ffffff";
}

export function themeVariables(accent: string, background: string | null): Record<string, string> {
  const [r, g, b] = hexToRgb(accent);
  const vars: Record<string, string> = {
    "--brand": accent,
    "--brand-rgb": `${r}, ${g}, ${b}`,
    "--brand-2": mix(accent, "#000000", 0.12),
    "--brand-soft": `rgba(${r}, ${g}, ${b}, 0.14)`,
    "--brand-light": mix(accent, "#ffffff", 0.35),
    "--brand-ink": inkOn(accent) === "#101010" ? mix(accent, "#000000", 0.92) : "#ffffff",
    "--brand-knob": luminance(accent) > 0.6 ? "#101010" : "#ffffff",
    "--brand-hi": mix(accent, "#ffffff", 0.16),
    "--brand-lo": mix(accent, "#000000", 0.1),
    "--brand-pale": mix(accent, "#ffffff", 0.78),
    "--brand-deep": mix(accent, "#000000", 0.3),
    "--playhead": accent,
  };
  if (background) vars["--chrome"] = background;
  return vars;
}

export function applyAppearance(s: Settings): void {
  const html = document.documentElement;
  html.dataset.palette = s.theme === "mono" ? "mono" : "clipkit";
  html.dataset.buttons = s.buttonStyle;
  html.removeAttribute("style");
  for (const [k, v] of Object.entries(themeVariables(s.accent, s.background))) html.style.setProperty(k, v);
}

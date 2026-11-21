import type { CaptionFont, CaptionWord, Overlay, Project, TextItem } from "./types";
import { activeClipAt } from "./project";
import { iconPath, ICON_PATHS } from "./icons2d";
import { fmtCount } from "./util";

export type Visual = HTMLVideoElement | HTMLImageElement;

export const FONT_FAMILY: Record<CaptionFont, string> = {
  bebas: '"Bebas Neue", Impact, sans-serif',
  tiktok: '"Clipweave TikTok Sans SemiBold", "Inter Variable", sans-serif',
  inter: '"Inter Variable", Inter, system-ui, sans-serif',
};

const FONT_WEIGHT: Record<CaptionFont, number> = { bebas: 400, tiktok: 600, inter: 800 };

function sourceSize(v: Visual): [number, number] {
  if (v instanceof HTMLVideoElement) return [v.videoWidth, v.videoHeight];
  return [v.naturalWidth, v.naturalHeight];
}

function ready(v: Visual | undefined): v is Visual {
  if (!v) return false;
  if (v instanceof HTMLVideoElement) return v.readyState >= 2 && v.videoWidth > 0;
  return v.complete && v.naturalWidth > 0;
}

/** Draws the part (sx,sy,sw,sh) of a source so it covers the box, centred, scaled by zoom. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  v: Visual,
  src: [number, number, number, number],
  box: [number, number, number, number],
  zoom = 1,
  panX = 0,
  panY = 0,
) {
  const [sx, sy, sw, sh] = src;
  const [dx, dy, dw, dh] = box;
  const scale = Math.max(dw / sw, dh / sh) * zoom;
  const cw = dw / scale;
  const ch = dh / scale;
  const cx = sx + (sw - cw) / 2 + ((sw - cw) / 2) * panX;
  const cy = sy + (sh - ch) / 2 + ((sh - ch) / 2) * panY;
  ctx.drawImage(v, cx, cy, cw, ch, dx, dy, dw, dh);
}

function drawContain(ctx: CanvasRenderingContext2D, v: Visual, W: number, H: number, zoom: number, panX: number, panY: number) {
  const [sw, sh] = sourceSize(v);
  const scale = Math.min(W / sw, H / sh) * zoom;
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(v, (W - dw) / 2 + panX * (W / 2), (H - dh) / 2 + panY * (H / 2), dw, dh);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawTextItem(ctx: CanvasRenderingContext2D, t: TextItem, W: number, H: number) {
  const k = W / 1080;
  const size = t.size * k;
  ctx.font = `${FONT_WEIGHT[t.font]} ${size}px ${FONT_FAMILY[t.font]}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = wrap(ctx, t.text, W * 0.86);
  const lh = size * 1.12;
  const top = t.y * H - ((lines.length - 1) * lh) / 2;
  lines.forEach((line, i) => {
    const y = top + i * lh;
    const x = t.x * W;
    if (t.background) {
      const w = ctx.measureText(line).width;
      ctx.fillStyle = "rgba(0,0,0,0.72)";
      roundRect(ctx, x - w / 2 - size * 0.3, y - lh / 2, w + size * 0.6, lh, size * 0.22);
      ctx.fill();
    }
    if (t.stroke) {
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(2, size * 0.14);
      ctx.strokeStyle = "#000";
      ctx.strokeText(line, x, y);
    }
    ctx.fillStyle = t.color;
    ctx.fillText(line, x, y);
  });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxW) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** Groups caption words into the pages shown together. */
export function captionPages(words: CaptionWord[], perLine: number): CaptionWord[][] {
  const sorted = [...words].sort((a, b) => a.start - b.start);
  const pages: CaptionWord[][] = [];
  let cur: CaptionWord[] = [];
  for (const w of sorted) {
    const prev = cur[cur.length - 1];
    if (cur.length >= perLine || (prev && w.start - prev.end > 0.6)) {
      pages.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) pages.push(cur);
  return pages;
}

const pageCache = new WeakMap<CaptionWord[], { perLine: number; pages: CaptionWord[][] }>();

/** Pagination is O(n log n) and the caption array is replaced on every edit, so the identity of
 *  that array is a safe cache key across frames. */
function pagesFor(words: CaptionWord[], perLine: number): CaptionWord[][] {
  const hit = pageCache.get(words);
  if (hit && hit.perLine === perLine) return hit.pages;
  const pages = captionPages(words, perLine);
  pageCache.set(words, { perLine, pages });
  return pages;
}

function drawCaptions(ctx: CanvasRenderingContext2D, p: Project, t: number, W: number, H: number) {
  const s = p.captionStyle;
  const page = pagesFor(p.captions, s.wordsPerLine).find((pg) => t >= pg[0].start && t <= pg[pg.length - 1].end + 0.05);
  if (!page) return;
  const k = W / 1080;
  const size = s.size * k;
  ctx.font = `${FONT_WEIGHT[s.font]} ${size}px ${FONT_FAMILY[s.font]}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const words = page.map((w) => (s.caps ? w.text.toUpperCase() : w.text));
  const space = ctx.measureText(" ").width;
  const widths = words.map((w) => ctx.measureText(w).width);
  const total = widths.reduce((a, b) => a + b, 0) + space * (words.length - 1);
  // Shrink a long page to fit the frame.
  const fit = Math.min(1, (W * 0.9) / total);
  if (fit < 1) ctx.font = `${FONT_WEIGHT[s.font]} ${size * fit}px ${FONT_FAMILY[s.font]}`;
  let x = (W - total * fit) / 2;
  // In split mode the game sits on top; keep captions inside the game area (s.y is relative to it).
  const splitShare = p.layout.mode === "split" ? 1 - p.layout.facecamShare : 1;
  const y = s.y * splitShare * H;
  if (s.background) {
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    roundRect(ctx, x - size * 0.3, y - size * 0.62, total * fit + size * 0.6, size * 1.24, size * 0.2);
    ctx.fill();
  }
  words.forEach((w, i) => {
    const word = page[i];
    const on = t >= word.start && t < word.end;
    if (s.stroke) {
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(3, size * fit * 0.16);
      ctx.strokeStyle = "#000";
      ctx.strokeText(w, x, y);
    }
    ctx.fillStyle = on ? s.highlight : s.color;
    ctx.fillText(w, x, y);
    x += (widths[i] + space) * fit;
  });
}

function icon(ctx: CanvasRenderingContext2D, name: keyof typeof ICON_PATHS, cx: number, cy: number, size: number, fill = false) {
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 6;
  const p = iconPath(name);
  if (fill) {
    ctx.fillStyle = "#fff";
    ctx.fill(p);
  } else {
    ctx.strokeStyle = "#fff";
    ctx.stroke(p);
  }
  ctx.restore();
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, weight = 600, align: CanvasTextAlign = "center") {
  ctx.save();
  ctx.font = `${weight} ${size}px "Inter Variable", system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 4;
  ctx.fillStyle = "#fff";
  ctx.fillText(text, x, y);
  ctx.restore();
}

const overlayGradCache = new WeakMap<CanvasRenderingContext2D, { w: number; h: number; grad: CanvasGradient }>();

function overlayGradient(ctx: CanvasRenderingContext2D, W: number, H: number): CanvasGradient {
  const hit = overlayGradCache.get(ctx);
  if (hit && hit.w === W && hit.h === H) return hit.grad;
  const g = ctx.createLinearGradient(0, H * 0.62, 0, H);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.55)");
  overlayGradCache.set(ctx, { w: W, h: H, grad: g });
  return g;
}

function drawOverlay(ctx: CanvasRenderingContext2D, o: Overlay, progress: number, W: number, H: number) {
  if (o.platform === "off") return;
  const k = W / 1080;
  // Shade under the text so it stays legible on bright footage.
  ctx.fillStyle = overlayGradient(ctx, W, H);
  ctx.fillRect(0, H * 0.62, W, H * 0.38);

  const colX = W - 90 * k;
  const iconSize = 92 * k;
  const countSize = 32 * k;
  type Action = [keyof typeof ICON_PATHS, string, boolean?];
  const actions: Action[] =
    o.platform === "tiktok"
      ? [["heart", fmtCount(o.likes), true], ["comment", fmtCount(o.comments), true], ["bookmark", fmtCount(o.saves), true], ["share", fmtCount(o.shares)]]
      : o.platform === "shorts"
        ? [["thumbsUp", fmtCount(o.likes)], ["thumbsDown", "Dislike"], ["comment", fmtCount(o.comments)], ["share", "Share"], ["remix", "Remix"]]
        : [["heart", fmtCount(o.likes)], ["comment", fmtCount(o.comments)], ["repost", fmtCount(o.shares)], ["share", fmtCount(o.saves)], ["more", ""]];
  let y = H * (o.platform === "tiktok" ? 0.5 : 0.53);
  if (o.platform === "tiktok") {
    // Avatar with the follow plus.
    ctx.fillStyle = "#3f3f46";
    ctx.beginPath();
    ctx.arc(colX, y - 150 * k, 46 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 4 * k;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    label(ctx, (o.name[0] ?? "?").toUpperCase(), colX, y - 150 * k, 40 * k, 700);
    ctx.fillStyle = "#fe2c55";
    ctx.beginPath();
    ctx.arc(colX, y - 104 * k, 18 * k, 0, Math.PI * 2);
    ctx.fill();
    label(ctx, "+", colX, y - 106 * k, 30 * k, 700);
  }
  for (const [name, count, fill] of actions) {
    icon(ctx, name, colX, y, iconSize, fill);
    if (count) label(ctx, count, colX, y + iconSize * 0.78, countSize);
    y += iconSize + 86 * k;
  }

  const left = 40 * k;
  const maxW = W - 200 * k;
  let by = H - (o.platform === "tiktok" ? 250 : 270) * k;
  ctx.save();
  ctx.font = `400 ${32 * k}px "Inter Variable", system-ui, sans-serif`;
  const capLines = wrap(ctx, o.caption, maxW).slice(0, 2);
  ctx.restore();
  by -= (capLines.length - 1) * 40 * k;
  const handle = o.platform === "tiktok" ? o.name : `@${o.name}`;
  if (o.platform !== "tiktok") {
    ctx.fillStyle = "#3f3f46";
    ctx.beginPath();
    ctx.arc(left + 28 * k, by, 28 * k, 0, Math.PI * 2);
    ctx.fill();
    label(ctx, (o.name[0] ?? "?").toUpperCase(), left + 28 * k, by, 26 * k, 700);
  }
  const hx = o.platform === "tiktok" ? left : left + 72 * k;
  label(ctx, handle, hx, by, 34 * k, 700, "left");
  ctx.save();
  ctx.font = `700 ${34 * k}px "Inter Variable", system-ui, sans-serif`;
  const hw = ctx.measureText(handle).width;
  ctx.restore();
  let afterHandle = hx + hw + 14 * k;
  if (o.verified) {
    ctx.fillStyle = o.platform === "tiktok" ? "#20d5ec" : "#3897f0";
    ctx.beginPath();
    ctx.arc(afterHandle + 15 * k, by, 15 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(afterHandle + 5 * k, by - 10 * k);
    ctx.scale((20 * k) / 24, (20 * k) / 24);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3.5;
    ctx.stroke(iconPath("check"));
    ctx.restore();
    afterHandle += 44 * k;
  }
  if (o.platform !== "tiktok") {
    const word = o.platform === "shorts" ? "Subscribe" : "Follow";
    ctx.save();
    ctx.font = `600 ${26 * k}px "Inter Variable", system-ui, sans-serif`;
    const ww = ctx.measureText(word).width + 36 * k;
    ctx.restore();
    if (o.platform === "shorts") {
      ctx.fillStyle = "#fff";
      roundRect(ctx, afterHandle, by - 26 * k, ww, 52 * k, 26 * k);
      ctx.fill();
      ctx.save();
      ctx.font = `600 ${26 * k}px "Inter Variable", system-ui, sans-serif`;
      ctx.fillStyle = "#0f0f0f";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(word, afterHandle + 18 * k, by);
      ctx.restore();
    } else {
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 2 * k;
      roundRect(ctx, afterHandle, by - 24 * k, ww, 48 * k, 12 * k);
      ctx.stroke();
      label(ctx, word, afterHandle + 18 * k, by, 26 * k, 600, "left");
    }
  }
  by += 58 * k;
  capLines.forEach((line, i) => label(ctx, line, left, by + i * 40 * k, 32 * k, 400, "left"));
  by += capLines.length * 40 * k + 20 * k;
  icon(ctx, "music", left + 16 * k, by, 30 * k);
  label(ctx, o.song, left + 46 * k, by, 28 * k, 500, "left");

  // Progress bar.
  const py = H - 22 * k;
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.fillRect(0, py, W, 5 * k);
  ctx.fillStyle = o.platform === "shorts" ? "#ff0033" : "#fff";
  ctx.fillRect(0, py, W * progress, 5 * k);
}

/** False while the footage for time t is still seeking, so the preview can keep its last frame. */
export function frameReady(p: Project, t: number, visuals: Map<string, Visual>): boolean {
  const a = activeClipAt(p, t);
  if (!a) return true;
  const v = visuals.get(a.clip.mediaId);
  return !v || (ready(v) && !(v instanceof HTMLVideoElement && v.seeking));
}

export interface FrameInput {
  project: Project;
  time: number;
  duration: number;
  visuals: Map<string, Visual>;
  /** Preview-only social UI (likes, handle, progress). Never burned into rendered files. */
  includeOverlay?: boolean;
}

const BLUR_W = 135;
const BLUR_H = 240;
let blurCanvas: HTMLCanvasElement | null = null;
let blurCtx: CanvasRenderingContext2D | null = null;

/** Downscaling to 135x240 before running a scaled blur cuts blurred pixels by 64x vs 1080x1920. */
function drawBlurredBackdrop(ctx: CanvasRenderingContext2D, v: Visual, sw: number, sh: number, W: number, H: number) {
  if (typeof document === "undefined") return;
  if (!blurCanvas) {
    blurCanvas = document.createElement("canvas");
    blurCanvas.width = BLUR_W;
    blurCanvas.height = BLUR_H;
    blurCtx = blurCanvas.getContext("2d", { alpha: false });
  }
  if (!blurCtx) {
    ctx.save();
    ctx.filter = "blur(28px) brightness(0.55)";
    drawCover(ctx, v, [0, 0, sw, sh], [-40, -40, W + 80, H + 80]);
    ctx.restore();
    return;
  }
  blurCtx.save();
  blurCtx.filter = "blur(4px) brightness(0.55)";
  drawCover(blurCtx, v, [0, 0, sw, sh], [-8, -8, BLUR_W + 16, BLUR_H + 16]);
  blurCtx.restore();
  ctx.drawImage(blurCanvas, 0, 0, W, H);
}

export function drawFrame(ctx: CanvasRenderingContext2D, W: number, H: number, f: FrameInput): void {
  const { project: p, time } = f;
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  const a = activeClipAt(p, time);
  const v = a ? f.visuals.get(a.clip.mediaId) : undefined;
  if (a && ready(v)) {
    const [sw, sh] = sourceSize(v);
    const L = p.layout;
    if (L.mode === "fit") {
      drawBlurredBackdrop(ctx, v, sw, sh, W, H);
      drawContain(ctx, v, W, H, L.zoom, L.panX, L.panY);
    } else if (L.mode === "split") {
      const gameH = Math.round(H * (1 - L.facecamShare));
      const fc = L.facecam;
      drawCover(ctx, v, [0, 0, sw, sh], [0, 0, W, gameH], L.zoom, L.panX, L.panY);
      drawCover(ctx, v, [fc.x * sw, fc.y * sh, fc.w * sw, fc.h * sh], [0, gameH, W, H - gameH]);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(0, gameH - 2, W, 4);
    } else {
      drawCover(ctx, v, [0, 0, sw, sh], [0, 0, W, H], L.zoom, L.panX, L.panY);
    }
  }
  for (const t of p.texts) if (time >= t.start && time <= t.end) drawTextItem(ctx, t, W, H);
  drawCaptions(ctx, p, time, W, H);
  if (f.includeOverlay !== false) drawOverlay(ctx, p.overlay, f.duration ? Math.min(1, time / f.duration) : 0, W, H);
  ctx.restore();
}

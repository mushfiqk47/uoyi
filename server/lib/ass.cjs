"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");

const clampNumber = (value, lo, hi, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

function assTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const whole = Math.floor(value % 60);
  const centiseconds = Math.floor((value - Math.floor(value)) * 100);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

function assColor(value, fallback) {
  const hex = /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value).slice(1) : fallback;
  return `&H00${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}`;
}

function assFontName(font) {
  if (font === "bebas") return "Bebas Neue";
  // libass matches the font's internal name-table family (nameID 1), not CSS aliases.
  if (font === "tiktok") return "TikTok Sans SemiBold";
  // Canvas draws "inter" as Inter Variable at weight 800; inter-bold.ttf ships Liberation Sans Bold
  // in public/fonts/ so libass renders bold geometric sans deterministically without missing woff2.
  return "Liberation Sans";
}

function assText(value) {
  return String(value || "").replace(/[\\{}]/g, (char) => `\\${char}`).replace(/\r?\n/g, "\\N");
}

function filterPath(file) {
  return file.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function buildOverlayAssContent(project, width = 1080, height = 1920) {
  const words = Array.isArray(project.captions) ? project.captions.filter((word) => Number(word.end) > Number(word.start)) : [];
  const texts = Array.isArray(project.texts) ? project.texts.filter((t) => Number(t.end) > Number(t.start) && String(t.text || "").trim()) : [];
  if (!words.length && !texts.length) return null;

  const style = project.captionStyle || {};
  const pages = [];
  let page = [];
  const perLine = Math.max(1, Number(style.wordsPerLine) || 3);
  for (const word of [...words].sort((a, b) => Number(a.start) - Number(b.start))) {
    const previous = page[page.length - 1];
    if (page.length >= perLine || (previous && Number(word.start) - Number(previous.end) > 0.6)) {
      pages.push(page);
      page = [];
    }
    page.push(word);
  }
  if (page.length) pages.push(page);

  const font = assFontName(style.font);
  const k = width / 1080;
  const fontSize = Math.max(8, Math.round((Number(style.size) || 112) * k));
  // In split mode the game sits on top; keep captions inside the game area, matching the editor preview.
  const splitShare = project.layout?.mode === "split" ? 1 - clampNumber(project.layout?.facecamShare, 0.15, 0.7, 0.3) : 1;
  const y = Math.round(Math.max(0, Math.min(1, Number(style.y) ?? 0.7)) * splitShare * height);
  const xMid = Math.round(width / 2);
  const borderStyle = style.background ? 3 : 1;
  const capMargin = Math.round(width * 0.05);
  const outline = style.background ? 14 : style.stroke ? Math.max(3, Math.round(fontSize * 0.16)) : 0;

  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 1",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${font},${fontSize},${assColor(style.highlight, "38bdf8")},${assColor(style.color, "ffffff")},&H00000000,&HB8000000,${style.font === "inter" ? -1 : 0},0,0,0,100,100,0,0,${borderStyle},${outline},0,5,${capMargin},${capMargin},0,1`,
    `Style: TextOverlay,Bebas Neue,${Math.round(92 * k)},&H0015CCFA,&H0015CCFA,&H00000000,&HB8000000,0,0,0,0,100,100,0,0,1,6,0,5,${Math.round(width * 0.07)},${Math.round(width * 0.07)},0,1`,
    `Style: TextBox,Bebas Neue,${Math.round(92 * k)},&H0015CCFA,&H0015CCFA,&H29000000,&H29000000,0,0,0,0,100,100,0,0,3,14,0,5,${Math.round(width * 0.07)},${Math.round(width * 0.07)},0,1`,
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  for (const current of pages) {
    const start = Number(current[0].start) || 0;
    const end = Number(current[current.length - 1].end) || start + 0.05;
    const text = current
      .map((word) => `{\\kf${Math.max(1, Math.round((Number(word.end) - Number(word.start)) * 100))}}${assText(style.caps ? String(word.text).toUpperCase() : word.text)}`)
      .join(" ");
    lines.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,{\\an5\\pos(${xMid},${y})}${text}`);
  }

  for (const t of texts) {
    const start = Math.max(0, Number(t.start) || 0);
    const end = Math.max(start + 0.05, Number(t.end) || start + 3);
    const nx = Number(t.x);
    const ny = Number(t.y);
    const ns = Number(t.size);
    const tx = Math.round((Number.isFinite(nx) ? nx : 0.5) * width);
    const ty = Math.round((Number.isFinite(ny) ? ny : 0.2) * height);
    const ts = Math.max(12, Math.round((Number.isFinite(ns) ? ns : 88) * k));
    const tf = assFontName(t.font);
    const tc = assColor(t.color, "facc15");
    const bold = t.font === "inter" ? 1 : 0;
    const bord = t.background ? Math.max(10, Math.round(ts * 0.22)) : t.stroke ? Math.max(2, Math.round(ts * 0.14)) : 0;
    const bgc = assColor(t.backgroundColor, "000000");
    const bgTag = t.background ? `\\3c${bgc}\\4c${bgc}\\3a&H29&\\4a&H29&` : "";
    const styleName = t.background ? "TextBox" : "TextOverlay";
    lines.push(
      `Dialogue: 1,${assTime(start)},${assTime(end)},${styleName},,0,0,0,,{\\an5\\pos(${tx},${ty})\\fn${tf}\\fs${ts}\\b${bold}\\c${tc}\\bord${bord}${bgTag}}${assText(t.text)}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

async function writeOverlayAss(dir, project, width = 1080, height = 1920) {
  const content = buildOverlayAssContent(project, width, height);
  if (!content) return null;
  const file = path.join(dir, "captions.ass");
  await fsp.writeFile(file, content, "utf8");
  return file;
}

module.exports = {
  clampNumber,
  assColor,
  assFontName,
  filterPath,
  buildOverlayAssContent,
  writeOverlayAss,
};

import type { Clip, ViralDetails } from "../types";
import type { Settings } from "../settings";
import { putBlob } from "../db";
import { saveThumb } from "../thumbs";
import { uid } from "../util";
import { suggestClipsFromTranscript } from "./openai";
import { analyzeMedia, cutClip, fetchClipBlob, mediaStatus } from "../../platform/api/media";

export interface PreparedMedia {
  id: string;
  title: string;
}

export interface FindClipsOptions {
  maxClips: number;
  minLength: number;
  maxLength: number;
  minScore: number;
  focus: string;
  /** Let the model decide how many clips to return and how long each one is. */
  autoCount?: boolean;
  autoLength?: boolean;
  /** Crop every cut to a vertical 9:16 frame. */
  vertical?: boolean;
}

export type ClipPick = {
  start: number;
  end: number;
  title: string;
  reason: string;
  score: number;
  viral?: ViralDetails;
};

/** Score gate first, then the hard count cap. Kept pure so the rules are testable without
 *  the local API. One surviving pick is a valid result. */
export function selectClipPicks(picks: ClipPick[], minScore: number, maxClips: number): ClipPick[] {
  return picks.filter((p) => p.score >= minScore).slice(0, Math.max(0, maxClips));
}

export interface FindClipsParams {
  media: PreparedMedia;
  settings: Settings;
  options: FindClipsOptions;
  onStatus?: (status: string) => void;
  addClip: (clip: Clip) => void;
  autoCaptionClip?: (id: string, blob: Blob) => Promise<void>;
}

/** Runs the AI Clip Finder pipeline on media the local API already has (an upload or a
 *  prepared link). Both the Clips screen and the per-recording action use this same path. */
export async function findClipsInMedia(params: FindClipsParams): Promise<number> {
  const { media, settings, options, onStatus, addClip, autoCaptionClip } = params;
  const report = (text: string) => onStatus?.(text);

  report("Preparing media…");
  let prepared = false;
  for (let i = 0; i < 240; i++) {
    const s = await mediaStatus(media.id).catch(() => ({ status: "unknown" as const }));
    if (s.status === "ready") { prepared = true; break; }
    if (s.status === "failed") throw new Error(("err" in s && s.err) || "Media preparation failed");
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!prepared) throw new Error("Preparing that video timed out. Check the local server log, then try again.");

  report("Analyzing audio & visual frames with AI…");
  const a = await analyzeMedia(media.id);

  report("Scoring viral moments & generating hooks…");
  const rawPicks = await suggestClipsFromTranscript(
    settings,
    { title: media.title, transcript: a.transcript || "", duration: a.duration || 0 },
    { maxClips: options.maxClips, minLength: options.minLength, maxLength: options.maxLength, focus: options.focus, autoCount: options.autoCount, autoLength: options.autoLength },
  );
  let picks = selectClipPicks(rawPicks, options.minScore, options.maxClips);
  if (!picks.length) {
    const dur = Number(a.duration) || 0;
    if (!rawPicks.length && dur > 0.5 && dur <= 180) {
      picks = selectClipPicks([{ start: 0, end: dur, title: media.title || "Clip", reason: "Full video", score: 10 }], options.minScore, options.maxClips);
    } else {
      throw new Error("No moments reached your minimum score. Lower it or adjust the focus.");
    }
  }

  let saved = 0;
  for (const p of picks) {
    report(`Saving viral clip ${saved + 1}/${picks.length}: ${p.title}`);
    const cj = await cutClip({ id: media.id, start: p.start, end: p.end, title: p.title, vertical: options.vertical });
    const blob = await fetchClipBlob(cj.url);
    const cid = uid("c");
    const blobKey = `clip:${cid}`;
    await putBlob(blobKey, blob);
    const thumbKey = await saveThumb(cid, cj.thumb);
    addClip({
      id: cid, mediaId: uid("m"), blobKey,
      streamTitle: `${media.title} · ${p.title}`,
      capturedAt: Date.now(),
      seconds: cj.duration || p.end - p.start,
      in: 0,
      duration: cj.duration || p.end - p.start,
      width: options.vertical ? 1080 : a.width || 0, height: options.vertical ? 1920 : a.height || 0,
      thumb: thumbKey ? null : (cj.thumb ?? null),
      thumbKey,
      note: `[AI ${p.score}/10] ${p.reason}`,
      aiScore: p.score,
      aiTitle: p.title,
      viral: p.viral,
      favourite: p.score >= 9,
      edited: false, renderedAt: null, removedAt: null,
    });
    if (autoCaptionClip) void autoCaptionClip(cid, blob);
    saved++;
  }
  return saved;
}

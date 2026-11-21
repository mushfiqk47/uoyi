import type { ViralDetails } from "../types";
import { activeAi, type Settings } from "../settings";
import { chatProxy } from "../../platform/api/ai";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

type AiSettings = Pick<Settings, "aiProfile" | "aiLocal" | "aiCloud" | "aiGemini" | "aiOpenAi" | "aiKilo">;

export const VIRAL_FOCUS_PRESETS: { id: string; label: string; focus: string }[] = [
  {
    id: "gta6",
    label: "GTA 6 Viral",
    focus:
      "GTA 6 & Vice City viral highlights: intense police chases, 5-star chaos, explosions, crazy vehicle stunts, funny NPC physics/glitches, trailer/map secrets, and shocked streamer reactions. Start right at the peak visual/audio hook.",
  },
  {
    id: "hype",
    label: "Stream Hype & Clutch",
    focus:
      "High-energy stream moments: loud reactions, screaming, uncontrollable laughter, insane clutch plays, unexpected plot twists, and instant chat-spike payoffs.",
  },
  {
    id: "fails",
    label: "Funny Fails & Glitches",
    focus:
      "Hilarious fails, ragdoll glitches, instant karma, awkward timing, and comedic reactions that make viewers replay and tag friends.",
  },
  {
    id: "trailer",
    label: "Secrets & Breakdowns",
    focus:
      "Key reveals, hidden easter eggs, shocking story details, vehicle/weapon spotted moments, and high-retention commentary hooks.",
  },
];

function baseHeaders(p: { apiKey: string }): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (p.apiKey) h.Authorization = `Bearer ${p.apiKey}`;
  return h;
}

function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((part) => (typeof part === "string" ? part : part?.text ?? part?.content ?? ""))
      .join("")
      .trim();
  }
  return "";
}

/** Gateways disagree on where the answer lives: a string, an array of content parts,
 *  a Responses-API `output_text`, a legacy completion `text`, or a reasoning-only reply. */
function replyText(data: any): string {
  const msg = data?.choices?.[0]?.message ?? data?.choices?.[0]?.delta ?? {};
  return (
    asText(msg.content) ||
    asText(data?.output_text) ||
    asText(data?.choices?.[0]?.text) ||
    asText(data?.response) ||
    asText(data?.result) ||
    asText(msg.reasoning_content) ||
    asText(msg.reasoning)
  );
}

/** Parses a model reply that may be wrapped in prose or truncated. Never throws — the
 *  regex fallback lives in its own try/catch so a half-written reply degrades gracefully. */
export function tryParseJson(s: string): any | null {
  try { return JSON.parse(s); } catch { /* fall through to the embedded-object attempt */ }
  for (let start = s.indexOf("{"); start >= 0; start = s.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try { return JSON.parse(s.slice(start, i + 1)); } catch { break; }
      }
    }
  }
  return null;
}

export async function chatCompletion(
  settings: AiSettings,
  messages: ChatMessage[],
  opts?: { json?: boolean; model?: string },
): Promise<string> {
  const p = activeAi(settings);

  // Built-in Google AI Studio Gemini profile routes through our server-side @google/genai handler.
  if (settings.aiProfile === "gemini" && !p.baseUrl.trim()) {
    const data = await chatProxy<any>({
      provider: "aistudio",
      model: opts?.model || p.model || "gemini-4-hydrogen",
      messages,
      json: opts?.json !== false,
      ...(p.apiKey.trim() ? { apiKey: p.apiKey.trim() } : {}),
    });
    const content = replyText(data);
    if (!content) throw new Error("AI Studio Gemini returned no content");
    return content;
  }

  const direct = p.baseUrl.replace(/\/+$/, "");
  const wantJson = opts?.json !== false && settings.aiProfile !== "gemini";
  const body = {
    model: opts?.model || p.model || "gpt-4o-mini",
    messages,
    temperature: 0.2,
    ...(wantJson ? { response_format: { type: "json_object" as const } } : {}),
    ...(direct ? {} : { baseUrl: p.baseUrl, apiKey: p.apiKey }),
  };
  let data: any;
  if (direct) {
    const res = await fetch(`${direct}/chat/completions`, { method: "POST", headers: baseHeaders(p), body: JSON.stringify(body) });
    const raw = await res.text();
    try { data = JSON.parse(raw); } catch { data = null; }
    if (!res.ok) {
      const msg = data?.error?.message || data?.error || raw.slice(0, 200) || `AI request failed (${res.status})`;
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    if (!data || typeof data !== "object") throw new Error(`AI endpoint returned an unreadable response: ${raw.slice(0, 120)}`);
  } else {
    data = await chatProxy<any>(body);
  }
  const upstreamError = data?.error;
  if (upstreamError) {
    const msg = typeof upstreamError === "string" ? upstreamError : upstreamError.message || JSON.stringify(upstreamError);
    throw new Error(String(msg));
  }
  const content = replyText(data);
  if (!content) {
    const finish = data?.choices?.[0]?.finish_reason;
    throw new Error(`AI returned no content${finish ? ` (finish reason: ${finish})` : ""}. Try another model or check the endpoint.`);
  }
  return content;
}

function clamp10(n: unknown, fallback = 7): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(1, Math.min(10, Math.round(v))) : fallback;
}

function parseViralDetails(c: any, fallbackTitle: string): ViralDetails {
  const hashtags = Array.isArray(c?.hashtags)
    ? c.hashtags.map((h: unknown) => String(h).trim()).filter(Boolean).slice(0, 8)
    : [];
  const platforms = Array.isArray(c?.platforms)
    ? c.platforms.map((p: unknown) => String(p).trim()).filter(Boolean).slice(0, 4)
    : ["TikTok", "YouTube Shorts", "Reels"];
  const bd = c?.breakdown && typeof c.breakdown === "object"
    ? {
        hook: clamp10(c.breakdown.hook, clamp10(c.score)),
        pacing: clamp10(c.breakdown.pacing, clamp10(c.score)),
        emotion: clamp10(c.breakdown.emotion, clamp10(c.score)),
        shareability: clamp10(c.breakdown.shareability, clamp10(c.score)),
      }
    : undefined;
  return {
    hook: String(c?.hook || c?.onScreenHook || fallbackTitle).slice(0, 120),
    whyViral: String(c?.whyViral || c?.reason || c?.why || "").slice(0, 320),
    platforms: platforms.length ? platforms : ["TikTok", "YouTube Shorts", "Reels"],
    caption: String(c?.caption || c?.socialCaption || fallbackTitle).slice(0, 240),
    hashtags,
    editingTips: String(c?.editingTips || c?.editTip || "").slice(0, 260),
    breakdown: bd,
  };
}

export interface ClipFinderOptions {
  maxClips: number;
  minLength: number;
  maxLength: number;
  focus: string;
  autoCount?: boolean;
  autoLength?: boolean;
}

export interface ViralClipSuggestion {
  start: number;
  end: number;
  title: string;
  reason: string;
  score: number;
  viral: ViralDetails;
}

export async function suggestClipsFromTranscript(
  settings: Pick<Settings, "aiProfile" | "aiLocal" | "aiCloud" | "aiGemini" | "aiOpenAi" | "aiKilo" | "aiClipPrompt">,
  input: { title: string; transcript: string; duration: number },
  options?: Partial<ClipFinderOptions>,
): Promise<ViralClipSuggestion[]> {
  const o: ClipFinderOptions = {
    maxClips: options?.maxClips || 6,
    minLength: options?.minLength || 10,
    maxLength: options?.maxLength || 60,
    focus: options?.focus || "",
    autoCount: !!options?.autoCount,
    autoLength: !!options?.autoLength,
  };
  const prompt =
    `${settings.aiClipPrompt}\n\n` +
    `Source: ${input.title}\nDuration: ${Math.round(input.duration)}s\n` +
    (o.focus ? `Creator focus: ${o.focus}\n` : "") +
    `Timestamped audio/visual log:\n${input.transcript.slice(0, 22000)}\n\n` +
    `Return JSON:\n` +
    `{"clips":[{"start":number,"end":number,"title":string,"score":number,"hook":string,"reason":string,"whyViral":string,"platforms":["TikTok","YouTube Shorts","Reels"],"caption":string,"hashtags":["#tag1","#tag2"],"editingTips":string,"breakdown":{"hook":number,"pacing":number,"emotion":number,"shareability":number}}]}\n\n` +
    `Rules:\n` +
    `- score and breakdown numbers are 1-10 (9-10 = sure viral lock, 7-8 = strong viral potential).\n` +
    `- hook: short punchy 3-second on-screen text hook (max 9 words, e.g. "WAIT FOR THE 5-STAR CHASE").\n` +
    `- whyViral: specific explanation of the retention hook, emotional spike, and why viewers replay/share.\n` +
    `- editingTips: concrete edit advice (punch-in zoom timing, captions style, SFX, cut dead air).\n` +
    `- caption + hashtags: ready-to-post short-form social copy.\n` +
    (o.autoCount
      ? `- Choose how many clips the source deserves, up to ${o.maxClips}.\n`
      : `- Keep 1-${o.maxClips} clips.\n`) +
    (o.autoLength
      ? `- Choose each clip's length yourself, roughly 10-60 seconds.\n`
      : `- Each clip must be ${o.minLength}-${o.maxLength} seconds.\n`) +
    `- Stay strictly within 0..${Math.max(1, Math.floor(input.duration))}.`;

  const out = await chatCompletion(settings, [
    { role: "system", content: "You are a viral short-form video strategist. Return valid JSON only." },
    { role: "user", content: prompt },
  ]);
  const parsed: any = tryParseJson(out);
  const clips = Array.isArray(parsed?.clips) ? parsed.clips : Array.isArray(parsed) ? parsed : [];
  return clips
    .map((c: any) => {
      const start = Math.max(0, Number(c.start) || 0);
      const lo = o.autoLength ? 5 : o.minLength;
      const hi = o.autoLength ? Math.min(300, Math.max(lo + 1, input.duration)) : o.maxLength;
      let end = Math.max(start + 1, Number(c.end) || start + lo);
      if (end - start < lo) end = start + lo;
      if (end - start > hi) end = start + hi;
      if (end > input.duration) { end = Math.max(start + 1, input.duration); }
      const title = String(c.title || "Highlight").slice(0, 80);
      const viral = parseViralDetails(c, title);
      return {
        start,
        end,
        title,
        reason: String(c.reason || c.whyViral || c.why || "").slice(0, 240),
        score: Math.max(1, Math.min(10, Number(c.score) || 7)),
        viral,
      };
    })
    .filter((c: any) => c.end > c.start + 1)
    .sort((a: ViralClipSuggestion, b: ViralClipSuggestion) => b.score - a.score)
    .slice(0, o.maxClips);
}

/** Asks the configured model for one short, creator-style title for a transcript. Returns "" when the model gives nothing usable. */
export async function suggestTitle(
  settings: Pick<Settings, "aiProfile" | "aiLocal" | "aiCloud" | "aiGemini" | "aiOpenAi" | "aiKilo">,
  input: { transcript: string },
): Promise<string> {
  const text = input.transcript.trim().slice(0, 12000);
  if (!text) return "";
  const out = await chatCompletion(settings, [
    { role: "system", content: "Return valid JSON only." },
    {
      role: "user",
      content:
        `Read this clip transcript and write ONE short viral title for it, max 60 characters. ` +
        `Write it the way a creator would, not like a summary. No quotes, no emoji, no hashtags.\n\n` +
        `Transcript:\n${text}\n\n` +
        `Return JSON: {"title":string}`,
    },
  ]);
  const parsed = tryParseJson(out);
  return String(parsed?.title ?? parsed?.name ?? "").trim().slice(0, 80);
}

export interface MomentVerdict {
  score: number;
  title: string;
  reason: string;
  clip: boolean;
  viral?: ViralDetails;
}

/** Group simultaneous candidate moments by whether they describe the same real-world event.
 *  Returns one index array per cluster (every input index appears exactly once). */
export async function clusterMoments(
  settings: Pick<Settings, "aiProfile" | "aiLocal" | "aiCloud" | "aiGemini" | "aiOpenAi" | "aiKilo">,
  moments: Array<{ streamTitle: string; transcript: string; reason: string; score: number }>,
): Promise<number[][]> {
  if (moments.length < 2) return moments.map((_, i) => [i]);
  const list = moments
    .map((m, i) => `#${i + 1} — ${m.streamTitle} (score ${m.score}/10): ${m.reason || "(no reason)"} | transcript: ${m.transcript.slice(0, 1200)}`)
    .join("\n");
  const out = await chatCompletion(settings, [
    { role: "system", content: "Return valid JSON only." },
    {
      role: "user",
      content:
        `These transcript excerpts were captured from different streams in the same window. ` +
        `Group the ones that describe the SAME real-world moment (same play, same joke, same announcement), even if phrased differently.\n${list}\n\n` +
        `Return JSON: {"groups":[[number,...],...]} where each array holds the # numbers of one group. Put EVERY moment in exactly one group.`,
    },
  ]);
  const parsed = tryParseJson(out);
  const groups: number[][] = [];
  const seen = new Set<number>();
  for (const g of Array.isArray(parsed?.groups) ? parsed.groups : []) {
    if (!Array.isArray(g)) continue;
    const members = [...new Set(g.map((n) => Number(n) - 1).filter((n) => Number.isInteger(n) && n >= 0 && n < moments.length && !seen.has(n)))] as number[];
    if (!members.length) continue;
    for (const n of members) seen.add(n);
    groups.push(members);
  }
  for (let i = 0; i < moments.length; i++) if (!seen.has(i)) groups.push([i]);
  return groups;
}

/** Asks the configured model whether the just-heard/seen moment is clip-worthy and returns full viral details. */
export async function judgeMoment(
  settings: Pick<Settings, "aiProfile" | "aiLocal" | "aiCloud" | "aiGemini" | "aiOpenAi" | "aiKilo" | "aiClipPrompt">,
  input: { title: string; transcript: string; snapshot?: string },
): Promise<MomentVerdict> {
  const text =
    `${settings.aiClipPrompt}\n\n` +
    `You are watching a LIVE stream right now. Based on the latest speech and optional video frame, decide whether a short vertical clip should be saved NOW.\n` +
    `Stream: ${input.title}\nLatest speech: ${input.transcript.slice(0, 4000) || "(no speech detected — check visual frame if attached)"}\n\n` +
    `Return JSON only: {"score":1-10,"title":string,"reason":string,"clip":boolean,"hook":string,"whyViral":string,"platforms":["TikTok","YouTube Shorts"],"caption":string,"hashtags":["#gaming"],"editingTips":string,"breakdown":{"hook":1-10,"pacing":1-10,"emotion":1-10,"shareability":1-10}}. ` +
    `score: 1=skip, 10=must-clip viral lock. Set clip=true only for a clear reaction, joke, fail, big win, GTA 6 chaos/stunt, or high-energy moment.`;

  const userContent: ChatMessage["content"] = input.snapshot
    ? [
        { type: "text", text },
        { type: "image_url", image_url: { url: input.snapshot } },
      ]
    : text;

  const out = await chatCompletion(
    settings,
    [
      { role: "system", content: "You judge live-stream moments for viral short-form clips. Return valid JSON only." },
      { role: "user", content: userContent },
    ],
    { json: true },
  );
  const parsed: any = tryParseJson(out);
  const score = Math.max(1, Math.min(10, Number(parsed?.score) || 1));
  const title = String(parsed?.title || "AI highlight").slice(0, 80);
  return {
    score,
    title,
    reason: String(parsed?.reason || parsed?.whyViral || "").slice(0, 200),
    clip: !!(parsed?.clip) && score >= 5,
    viral: parseViralDetails(parsed, title),
  };
}

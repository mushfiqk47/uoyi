import { apiPostJson } from "./client";

export interface ResolvedStream {
  url: string;
  originalUrl: string;
  title: string;
  platform: "youtube" | "twitch" | "kick" | "url";
  live?: boolean;
  kind?: string;
}

function directPlayable(url: string): boolean {
  return /\.(m3u8|mp4|webm|mov|mpg|mpeg)(\?|$)/i.test(url);
}

function platformOf(url: string): ResolvedStream["platform"] {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h.includes("youtube.com") || h.includes("youtu.be")) return "youtube";
    if (h.includes("twitch.tv")) return "twitch";
    if (h.includes("kick.com")) return "kick";
  } catch {}
  return "url";
}

export async function resolveStreamInput(input: string): Promise<ResolvedStream> {
  const trimmed = input.trim();
  const u = new URL(trimmed);
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http(s) links are supported.");

  // Direct playable URLs can be proxied client-side for CORS-safe playback when needed.
  if (directPlayable(trimmed)) {
    return {
      url: `/stream?url=${encodeURIComponent(trimmed)}`,
      originalUrl: trimmed,
      title: trimmed,
      platform: platformOf(trimmed),
      kind: /\.m3u8/i.test(trimmed) ? "hls" : "video",
    };
  }

  const data = await apiPostJson<Record<string, unknown>>("/api/resolve", { url: trimmed });
  return {
    url: String(data.url),
    originalUrl: String(data.originalUrl || trimmed),
    title: String(data.title || trimmed),
    platform: (data.platform as ResolvedStream["platform"]) || platformOf(trimmed),
    live: !!data.live,
    kind: data.kind as string | undefined,
  };
}

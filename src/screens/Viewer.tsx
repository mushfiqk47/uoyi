import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { MonitorPlay, Plus, Scissors, Sparkles } from "lucide-react";
import { useViewerStore } from "../store";
import { canClip } from "../lib/recorder";
import { resolveStreamInput } from "../platform/api/streams";
import { MIGRATIONS } from "../platform/storage/keys";
import { once } from "../platform/storage/migrations";
import { StreamCard } from "../features/viewer/StreamCard";
import type { TileApi } from "../features/viewer/types";
import { useAiAutoClip } from "../features/viewer/useAiAutoClip";

function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const part = u.pathname.split("/").filter(Boolean).slice(-2, -1)[0] ?? u.hostname;
    return decodeURIComponent(part).replace(/[-_]+/g, " ").slice(0, 40) || u.hostname;
  } catch {
    return "Stream";
  }
}

export function Viewer() {
  const { streams, addStream, removeStream, updateStream, settings, updateSettings, toast, go } = useViewerStore();
  const [url, setUrl] = useState("");
  const [resolving, setResolving] = useState(false);
  const tiles = useRef(new Map<string, TileApi>());
  const maxStreams = Math.max(1, Math.min(4, settings.maxStreams || 4));
  const full = streams.length >= maxStreams;
  // Last AI error per stream, shown on the card instead of staying silent in the interval pass.
  const [aiErrors, setAiErrors] = useState<Record<string, string>>({});
  const aiFailedRef = useRef(new Set<string>());
  const noteAiError = useCallback((id: string, title: string, msg: string) => {
    setAiErrors((prev) => (prev[id] === msg ? prev : { ...prev, [id]: msg }));
    if (!aiFailedRef.current.has(id)) {
      aiFailedRef.current.add(id);
      toast(`AI can't listen to ${title}: ${msg} — check Settings → AI.`, "error");
    }
  }, [toast]);
  const clearAiError = useCallback((id: string) => {
    aiFailedRef.current.delete(id);
    setAiErrors((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  // One-time migration: older sessions stored audio-only YouTube HLS URLs (black video).
  useEffect(() => {
    once(MIGRATIONS.streamsReresolved, () => {
      for (const s of streams) {
        if (!s.sourceUrl || s.url.startsWith("capture://")) continue;
        void resolveStreamInput(s.sourceUrl)
          .then((r) => updateStream(s.id, { url: r.url, title: r.title, sourceUrl: r.originalUrl, platform: r.platform, live: r.live }))
          .catch(() => {});
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const triggerAi = useAiAutoClip({ streams, settings, tiles, toast, go, noteAiError, clearAiError });

  const add = async (raw: string, title?: string) => {
    const value = raw.trim();
    if (!value) return;
    if (full) {
      toast(`You can watch up to ${maxStreams} streams at once. Close one first, or raise the limit in Settings → AI.`, "error");
      return;
    }
    try {
      const u = new URL(value);
      if (!/^https?:$/.test(u.protocol)) throw new Error();
    } catch {
      toast("Paste a valid http(s) link. Direct media links (.m3u8/.mp4/.webm/.mpg/.mpeg) and supported Twitch/Kick/YouTube links are accepted.", "error");
      return;
    }
    setResolving(true);
    try {
      const r = await resolveStreamInput(value);
      addStream({ url: r.url, sourceUrl: r.originalUrl, title: title ?? r.title ?? titleFromUrl(value), platform: r.platform, live: r.live });
      setUrl("");
      if (r.kind === "video" && (r.platform === "youtube" || r.platform === "twitch" || r.platform === "kick")) {
        toast(`Opened ${r.platform} link as video. For live clipping, open while the stream is live.`, "info");
      }
    } catch (e) {
      toast((e as Error).message || "Couldn't open that link.", "error");
    } finally {
      setResolving(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void add(url);
  };

  const clipAll = async () => {
    const apis = streams.map((s) => tiles.current.get(s.id)).filter(Boolean) as TileApi[];
    const saved = await Promise.all(apis.map((a) => a.clip()));
    const ok = saved.filter(Boolean).length;
    if (ok) toast(`Clipped ${ok} stream${ok === 1 ? "" : "s"}`, "success", { label: "Clips", run: () => go("clips") });
  };

  return (
    <main className="viewer">
      <div className="viewer-content">
        <div className="viewer-bar">
          <form className="addstream" onSubmit={submit}>
            <MonitorPlay className="ic lead" />
            <input
              className="input"
              placeholder="Paste a direct .m3u8 / .mp4 / .webm link (or Twitch/Kick/YouTube)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-label="Stream link"
            />
            <button className="btn accent sm" type="submit" disabled={!url.trim() || full || resolving}>
              <Plus className="ic" /> {resolving ? "Resolving…" : "Add"}
            </button>
          </form>
          <div className="row viewer-actions">
            <button
              className={`btn ${settings.aiAutoClip ? "accent" : "ghost"}`}
              aria-pressed={settings.aiAutoClip}
              onClick={() => {
                updateSettings({ aiAutoClip: !settings.aiAutoClip });
                toast(settings.aiAutoClip ? "AI auto clip finder stopped." : `AI auto clip finder on — checking every ${settings.aiClipInterval} min.`, "info");
              }}
              disabled={!streams.length}
              title="Listen to each stream in the background, let AI find the best moments and save them automatically"
            >
              <Sparkles className="ic" /> AI auto clip
            </button>
            <button className="btn accent" onClick={() => void clipAll()} disabled={!streams.length || !settings.rollingBuffer}>
              <Scissors className="ic" /> Clip all
            </button>
          </div>
        </div>

        {streams.length === 0 ? (
          <div className="viewer-empty">
            <div className="empty">
              <div className="badge">
                <MonitorPlay className="ic" />
              </div>
              <h2>Add a stream</h2>
              <p>Paste a direct .m3u8/.mp4 stream URL (or a Twitch/Kick/YouTube link) above. Clipweave plays it in real time, records it on the server, and lets AI auto-clip viral moments automatically.</p>
              <div className="row viewer-empty-actions">
                <button className="btn ghost" onClick={() => go("clips")}>
                  <Sparkles className="ic" /> Upload video in Clips
                </button>
              </div>
            </div>
            {!canClip() && <p className="warn-note">This browser can play streams but can't record them. Use Chrome, Edge or Firefox to clip.</p>}
          </div>
        ) : (
          <div className="rec-grid">
            {streams.map((s) => (
              <StreamCard
                key={s.id}
                stream={s}
                aiError={aiErrors[s.id] ?? null}
                onEnergySpike={() => triggerAi(s.id)}
                onClose={() => {
                  removeStream(s.id);
                }}
                register={(api) => {
                  if (api) tiles.current.set(s.id, api);
                  else tiles.current.delete(s.id);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

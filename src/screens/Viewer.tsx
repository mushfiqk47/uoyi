import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Circle, MonitorPlay, MonitorUp, Plus, Scissors, Sparkles, TriangleAlert, X } from "lucide-react";
import { useViewerStore } from "../store";
import { canClip } from "../lib/recorder";
import { registerCaptureStream, releaseCaptureStream } from "../lib/captureRegistry";
import { fmtDuration } from "../lib/util";
import { logActivity } from "../lib/activity";
import { resolveStreamInput } from "../platform/api/streams";
import { MIGRATIONS } from "../platform/storage/keys";
import { once } from "../platform/storage/migrations";
import { ActivityLog } from "../features/viewer/ActivityLog";
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
  const [resolveError, setResolveError] = useState<string | null>(null);
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

  useAiAutoClip({ streams, settings, tiles, toast, go, noteAiError, clearAiError });

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
    setResolveError(null);
    setResolving(true);
    try {
      const r = await resolveStreamInput(value);
      addStream({ url: r.url, sourceUrl: r.originalUrl, title: title ?? r.title ?? titleFromUrl(value), platform: r.platform, live: r.live });
      logActivity("info", `Now recording ${title ?? r.title ?? titleFromUrl(value)}`);
      setUrl("");
      if (r.kind === "video" && (r.platform === "youtube" || r.platform === "twitch" || r.platform === "kick")) {
        toast(`Opened ${r.platform} link as video. For live clipping, open while the stream is live.`, "info");
      }
    } catch (e) {
      const msg = (e as Error).message || "Couldn't open that link.";
      setResolveError(msg);
      toast(msg, "error");
    } finally {
      setResolving(false);
    }
  };

  const captureTab = async () => {
    if (full) {
      toast(`You can watch up to ${maxStreams} streams at once. Close one first.`, "error");
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      toast("Tab/screen capture is not supported in this browser.", "error");
      return;
    }
    try {
      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 60, max: 60 } },
        audio: true,
      });
      const vTrack = mediaStream.getVideoTracks()[0];
      const label = vTrack?.label ? vTrack.label.replace(/^tab:/i, "").trim().slice(0, 48) : "Captured Tab";
      const captureUrl = registerCaptureStream(mediaStream);
      addStream({ url: captureUrl, title: label || "Captured Tab", platform: "url", live: true });
      setResolveError(null);
      logActivity("info", `Capturing live tab/screen: ${label || "Captured Tab"}`);
    } catch (e) {
      if ((e as Error)?.name !== "AbortError" && (e as Error)?.name !== "NotAllowedError") {
        toast((e as Error).message || "Could not start tab capture.", "error");
      }
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void add(url);
  };

  const handleCloseStream = useCallback((s: { id: string; title: string; url: string }) => {
    logActivity("info", `Stopped watching ${s.title}`);
    releaseCaptureStream(s.url);
    removeStream(s.id);
  }, [removeStream]);

  const registerTile = useCallback((id: string, api: TileApi | null) => {
    if (api) tiles.current.set(id, api);
    else tiles.current.delete(id);
  }, []);

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
              onChange={(e) => {
                setUrl(e.target.value);
                if (resolveError) setResolveError(null);
              }}
              aria-label="Stream link"
            />
            <button className="btn accent sm" type="submit" disabled={!url.trim() || full || resolving}>
              <Plus className="ic" /> {resolving ? "Resolving…" : "Add"}
            </button>
          </form>
          <div className="row viewer-actions">
            <button
              className="btn ghost"
              onClick={() => void captureTab()}
              disabled={full}
              title="Capture any playing YouTube, GTA 6, Twitch, or Kick browser tab with audio"
            >
              <MonitorUp className="ic" /> Capture tab
            </button>
            <button
              className={`btn ${settings.autoRecord ? "accent" : "ghost"}`}
              aria-pressed={settings.autoRecord}
              onClick={() => {
                updateSettings({ autoRecord: !settings.autoRecord });
                toast(
                  settings.autoRecord ? "Auto record stopped." : `Auto record on. Every stream is recorded in real time and saved to Records every ${fmtDuration(settings.recordSaveSeconds)}.`,
                  "info",
                );
              }}
              disabled={!streams.length}
              title="Record every stream in real time and auto-save a clip to Records after the interval in Settings → Clipping"
            >
              <Circle className="ic" /> Auto record
            </button>
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

        {resolveError && (
          <div className="viewer-callout card" role="alert">
            <TriangleAlert className="ic warn" aria-hidden="true" />
            <p className="grow">{resolveError}</p>
            <div className="row">
              <button className="btn accent sm" onClick={() => void captureTab()} disabled={full}>
                <MonitorUp className="ic" /> Capture tab
              </button>
              <button className="btn ghost sm" onClick={() => go("clips")}>
                <Sparkles className="ic" /> Upload in Clips
              </button>
              <button className="btn plain icon sm" onClick={() => setResolveError(null)} aria-label="Dismiss error">
                <X className="ic" />
              </button>
            </div>
          </div>
        )}

        {streams.length === 0 ? (
          <div className="viewer-empty">
            <div className="empty">
              <div className="badge">
                <MonitorPlay className="ic" />
              </div>
              <h2>Add a stream or capture a tab</h2>
              <p>Paste a direct .m3u8/.mp4 stream URL above, or click <b>Capture tab</b> to grab any playing GTA 6 YouTube video, Twitch stream, or Kick stream directly from your browser. Clipweave buffers the last {settings.captureSeconds} seconds and lets AI auto-clip viral moments automatically.</p>
              <div className="empty-actions">
                <button className="btn accent" onClick={() => void captureTab()}>
                  <MonitorUp className="ic" /> Capture browser tab
                </button>
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
                onClose={handleCloseStream}
                register={registerTile}
              />
            ))}
          </div>
        )}
      </div>
      <ActivityLog />
    </main>
  );
}

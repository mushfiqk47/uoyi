import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type Hls from "hls.js";
import type { Stream } from "../../lib/types";
import type { Settings } from "../../lib/settings";
import { resolveStreamInput } from "../../platform/api/streams";
import { mediaStatus } from "../../platform/api/media";

export function useHlsStream({
  stream,
  videoRef,
  recordQuality,
  isRecordingRef,
  updateStream,
  toast,
  onResetCapture,
  applyAudio,
}: {
  stream: Stream;
  videoRef: RefObject<HTMLVideoElement | null>;
  recordQuality: Settings["recordQuality"];
  isRecordingRef: RefObject<boolean>;
  updateStream: (id: string, patch: Partial<Stream>) => void;
  toast: (text: string, tone?: "info" | "error" | "success") => void;
  onResetCapture: () => void;
  applyAudio: () => void;
}) {
  const hlsRef = useRef<Hls | null>(null);
  const levelsRef = useRef<number[]>([]);
  const [live, setLive] = useState(false);
  const [state, setState] = useState<"loading" | "playing" | "error">("loading");
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const forceFullHdLevel = useCallback(() => {
    const hls = hlsRef.current;
    if (!hls || recordQuality !== "fullhd") return;
    const heights = levelsRef.current.length ? levelsRef.current : hls.levels.map((l) => l.height || 0);
    let best = -1;
    let bestHeight = 0;
    heights.forEach((h, i) => {
      if (h <= 1080 && h > bestHeight) {
        bestHeight = h;
        best = i;
      }
    });
    if (best >= 0) hls.autoLevelCapping = best;
  }, [recordQuality]);

  const releaseLevel = useCallback(() => {
    if (!hlsRef.current) return;
    if (document.hidden && !isRecordingRef.current) {
      hlsRef.current.autoLevelCapping = 0;
    } else {
      hlsRef.current.autoLevelCapping = -1;
    }
  }, [isRecordingRef]);

  // Throttle HLS rendition to lowest quality when the tab is hidden unless browser recording is active.
  useEffect(() => {
    const syncVisibilityCap = () => {
      const hls = hlsRef.current;
      if (!hls) return;
      if (document.hidden && !isRecordingRef.current) {
        hls.autoLevelCapping = 0;
      } else if (isRecordingRef.current && recordQuality === "fullhd") {
        forceFullHdLevel();
      } else {
        hls.autoLevelCapping = -1;
      }
    };
    document.addEventListener("visibilitychange", syncVisibilityCap);
    return () => document.removeEventListener("visibilitychange", syncVisibilityCap);
  }, [forceFullHdLevel, isRecordingRef, recordQuality]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    applyAudio();
    let alive = true;
    const proxied = stream.url.startsWith("/stream?") || stream.url.startsWith("/");
    if (proxied) v.removeAttribute("crossorigin");
    else v.crossOrigin = "anonymous";
    setState("loading");
    setError("");
    const isHls = /\.m3u8(\?|$)/i.test(stream.url) || stream.url.includes("m3u8");
    const onPlaying = () => setState("playing");
    const onErr = () => {
      if (hlsRef.current) return;
      setState("error");
      setError("This link can't be played in the browser.");
    };
    v.addEventListener("playing", onPlaying);
    v.addEventListener("error", onErr);
    void (async () => {
      if (isHls) {
        const { default: HlsModule } = await import("hls.js");
        if (!alive) return;
        if (HlsModule.isSupported()) {
          const hls = new HlsModule({
            lowLatencyMode: true,
            liveSyncDurationCount: 1,
            liveMaxLatencyDurationCount: 3,
            maxLiveSyncPlaybackRate: 1.5,
            backBufferLength: 10,
            maxBufferLength: 10,
            maxMaxBufferLength: 20,
          });
          hlsRef.current = hls;
          hls.on(HlsModule.Events.MANIFEST_PARSED, (_e, data) => {
            levelsRef.current = data.levels.map((l) => l.height || 0);
            if (document.hidden && !isRecordingRef.current) hls.autoLevelCapping = 0;
            v.play().catch(() => {});
          });
          hls.on(HlsModule.Events.LEVEL_LOADED, (_e, data) => setLive(data.details.live));
          hls.on(HlsModule.Events.ERROR, (_e, data) => {
            if (!data.fatal) return;
            if (data.type === HlsModule.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
            else {
              setState("error");
              setError(
                data.type === HlsModule.ErrorTypes.NETWORK_ERROR
                  ? "The stream didn't load. It may be offline, or its server blocks other sites."
                  : "This stream can't be played.",
              );
            }
          });
          hls.loadSource(stream.url);
          hls.attachMedia(v);
          return;
        }
      }
      if (!alive) return;
      v.src = stream.url;
      v.play().catch(() => {});
    })().catch(() => {
      if (!alive) return;
      setState("error");
      setError("This stream couldn't be loaded.");
    });
    return () => {
      alive = false;
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("error", onErr);
      hlsRef.current?.destroy();
      hlsRef.current = null;
      onResetCapture();
      v.srcObject = null;
      v.removeAttribute("src");
      v.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.url, reloadKey, stream.id]);

  // Re-resolve stored unresolved URLs or vanished server media jobs.
  useEffect(() => {
    const u = stream.url;
    const playable = u.startsWith("/stream?") || u.startsWith("/") || /\.(m3u8|mp4|webm|mov|mpg|mpeg)(\?|$)/i.test(u) || u.includes("m3u8");
    let alive = true;
    if (!playable) {
      void resolveStreamInput(stream.sourceUrl || u)
        .then((r) => {
          if (alive) updateStream(stream.id, { url: r.url, title: r.title, sourceUrl: r.originalUrl, platform: r.platform, live: r.live });
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }
    const m = /\/media\?id=([^&]+)/.exec(u);
    if (!m) return;
    void mediaStatus(m[1])
      .then((s) => {
        if (!alive || (s.status !== "unknown" && s.status !== "failed")) return null;
        return resolveStreamInput(stream.sourceUrl || u);
      })
      .then((r) => {
        if (alive && r) updateStream(stream.id, { url: r.url, title: r.title, sourceUrl: r.originalUrl, platform: r.platform, live: r.live });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [stream.id, stream.url, stream.sourceUrl, updateStream]);

  // Catch black-screen streams that report "playing" without video frames.
  useEffect(() => {
    if (state !== "playing") return;
    const started = Date.now();
    const t = window.setInterval(() => {
      const v = videoRef.current;
      if (!v) return;
      if (v.videoWidth > 0 && v.readyState >= 2) return;
      if (Date.now() - started > 12000) {
        clearInterval(t);
        setState("error");
        setError("No video frames arrived. The source may be blocked, protected, or an unsupported format.");
      }
    }, 1000);
    return () => clearInterval(t);
  }, [state, reloadKey, videoRef]);

  const reResolve = useCallback(async () => {
    setReloadKey((n) => n + 1);
    const src = stream.sourceUrl;
    if (!src) return;
    try {
      const r = await resolveStreamInput(src);
      updateStream(stream.id, { url: r.url, title: r.title, sourceUrl: r.originalUrl, platform: r.platform, live: r.live });
      setState("loading");
    } catch (e) {
      toast((e as Error).message || "Could not re-resolve link.", "error");
    }
  }, [stream.id, stream.sourceUrl, updateStream, toast]);

  return { live, state, error, reResolve, forceFullHdLevel, releaseLevel };
}

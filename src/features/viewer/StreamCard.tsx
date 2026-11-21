import { memo, useCallback, useEffect, useRef, useState } from "react";
import type Hls from "hls.js";
import { Clock, Circle, Save, Scissors, Sparkles, Square, X } from "lucide-react";
import { useViewerStore } from "../../store";
import type { Clip, Stream, ViralDetails } from "../../lib/types";
import {
  canClip, captureTracks, captureVideo, LiveRecorder, recordBitrate, RollingRecorder, type LiveSegment,
} from "../../lib/recorder";
import { getCaptureStream } from "../../lib/captureRegistry";
import { forgetUrl, putBlob } from "../../lib/db";
import { saveThumb } from "../../lib/thumbs";
import { fmtDuration, fmtTime, uid } from "../../lib/util";
import { logActivity } from "../../lib/activity";
import { resolveStreamInput } from "../../platform/api/streams";
import { mediaStatus, finalizeClipBlob } from "../../platform/api/media";
import { judgeMoment, type MomentVerdict } from "../../lib/ai/openai";
import { recordAudioChunk } from "../../lib/ai/audioSample";
import { generateCaptionsForBlob } from "../../lib/ai/captions";
import type { TileApi } from "./types";

export const StreamCard = memo(function StreamCard({
  stream,
  aiError,
  onClose,
  register,
}: {
  stream: Stream;
  aiError: string | null;
  onClose: (stream: Stream) => void;
  register: (id: string, api: TileApi | null) => void;
}) {
  const { settings, addClip, updateClip, toast, updateStream, autoCaptionClip, go } = useViewerStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const levelsRef = useRef<number[]>([]);
  const recRef = useRef<RollingRecorder | null>(null);
  const liveRecRef = useRef<LiveRecorder | null>(null);
  const captureRef = useRef<MediaStream | null>(null);
  const autoStartedRef = useRef(false);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [live, setLive] = useState(false);
  const [state, setState] = useState<"loading" | "playing" | "error">("loading");
  const [error, setError] = useState("");
  const [buffered, setBuffered] = useState(0);
  const [recError, setRecError] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [lastVerdict, setLastVerdict] = useState<{ score: number; at: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [reloadKey, setReloadKey] = useState(0);

  // Playback. The <video> element is hidden; it exists to decode and feed the recorder.
  useEffect(() => {
    const v = videoRef.current!;
    // Near-zero volume instead of muted. Chrome has shipped a regression where muting a media
    // element made captureStream() silent, leaving recordings with video and no audio.
    v.muted = false;
    v.volume = 0.001;
    let alive = true;
    const proxied = stream.url.startsWith("/stream?") || stream.url.startsWith("/");
    if (proxied) v.removeAttribute("crossorigin");
    else v.crossOrigin = "anonymous";
    setState("loading");
    setError("");
    const isCapture = stream.url.startsWith("capture://");
    const isHls = !isCapture && (/\.m3u8(\?|$)/i.test(stream.url) || stream.url.includes("m3u8"));
    const onPlaying = () => setState("playing");
    const onErr = () => {
      if (hlsRef.current) return;
      setState("error");
      setError("This link can't be played in the browser.");
    };
    v.addEventListener("playing", onPlaying);
    v.addEventListener("error", onErr);
    void (async () => {
      if (isCapture) {
        const mediaStream = getCaptureStream(stream.url);
        if (!mediaStream) {
          setState("error");
          setError("Tab capture ended. Click Capture tab to start a new capture.");
          return;
        }
        v.srcObject = mediaStream;
        setLive(true);
        v.play().catch(() => {});
        return;
      }
      if (isHls) {
        const { default: HlsModule } = await import("hls.js");
        if (!alive) return;
        if (HlsModule.isSupported()) {
          const hls = new HlsModule({
            // Stay closer to the live edge and catch up automatically when the tab falls behind,
            // otherwise the "live" recording drifts further behind real time the longer it runs.
            liveSyncDurationCount: 2,
            liveMaxLatencyDurationCount: 6,
            // Catching up at 1.5x means 50% more frames decoded and encoded per second at 1080p.
            maxLiveSyncPlaybackRate: 1.1,
            backBufferLength: 10,
            maxBufferLength: 15,
            maxMaxBufferLength: 30,
            // Full HD capture needs the real ABR ladder, not the lowest level a 2x2 surface suggests.
            capLevelToPlayerSize: settings.recordQuality !== "fullhd",
          });
          hlsRef.current = hls;
          hls.on(HlsModule.Events.MANIFEST_PARSED, (_e, data) => {
            levelsRef.current = data.levels.map((l) => l.height || 0);
            v.play().catch(() => {});
          });
          hls.on(HlsModule.Events.LEVEL_LOADED, (_e, data) => setLive(data.details.live));
          hls.on(HlsModule.Events.ERROR, (_e, data) => {
            if (!data.fatal) return;
            if (data.type === HlsModule.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
            else {
              setState("error");
              setError(data.type === HlsModule.ErrorTypes.NETWORK_ERROR ? "The stream didn't load. It may be offline, or its server blocks other sites." : "This stream can't be played.");
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
      // A capture stream belongs to the old media source. Keeping it would make a later
      // recording reuse ended tracks after a reload or re-resolve.
      captureRef.current = null;
      v.srcObject = null;
      v.removeAttribute("src");
      v.load();
    };
  }, [stream.url, reloadKey, stream.id]);

  // A stored stream from an older session may have an unresolved page URL; re-resolve it.
  // A prepared VOD keeps its `/media?id=` URL across reloads — only re-download it when the
  // server says that in-memory job is gone (e.g. after a server restart).
  useEffect(() => {
    const u = stream.url;
    if (u.startsWith("capture://")) return;
    const playable = u.startsWith("/stream?") || u.startsWith("/") || /\.(m3u8|mp4|webm|mov|mpg|mpeg)(\?|$)/i.test(u) || u.includes("m3u8");
    let alive = true;
    if (!playable) {
      void resolveStreamInput(stream.sourceUrl || u)
        .then((r) => {
          if (alive) updateStream(stream.id, { url: r.url, title: r.title, sourceUrl: r.originalUrl, platform: r.platform, live: r.live });
        })
        .catch(() => {});
      return () => { alive = false; };
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
    return () => { alive = false; };
  }, [stream.id, stream.url, stream.sourceUrl, updateStream]);

  const reResolve = async () => {
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
  };

  // Catch streams that report "playing" but never deliver a frame (black screen).
  useEffect(() => {
    if (state !== "playing") return;
    const started = Date.now();
    const t = setInterval(() => {
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
  }, [state, reloadKey]);

  // The rolling buffer, started once frames flow.
  useEffect(() => {
    if (state !== "playing" || !settings.rollingBuffer) return;
    if (!canClip()) {
      setRecError("This browser can't record streams");
      return;
    }
    try {
      recRef.current = new RollingRecorder(videoRef.current!, settings.captureSeconds, recordBitrate(settings.recordQuality));
      setRecError("");
      logActivity("info", `Recording ${stream.title} (rolling ${settings.captureSeconds}s buffer)`);
    } catch (e) {
      const msg = e instanceof DOMException && e.name === "SecurityError" ? "This stream's server doesn't allow recording" : "Recording couldn't start";
      setRecError(msg);
      logActivity("warn", `Can't record ${stream.title}: ${msg}`);
    }
    return () => {
      recRef.current?.dispose();
      recRef.current = null;
      setBuffered(0);
    };
  }, [state, settings.rollingBuffer, settings.captureSeconds]);

  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      setBuffered(recRef.current?.buffered ?? 0);
      setRecordSeconds(liveRecRef.current?.seconds ?? 0);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Hassle-free continuous recording. One extra recorder shares the rolling buffer's captured
  // stream, so recording never makes the player decode the video twice.
  const forceFullHdLevel = () => {
    const hls = hlsRef.current;
    if (!hls || settings.recordQuality !== "fullhd") return;
    const heights = levelsRef.current.length ? levelsRef.current : hls.levels.map((l) => l.height || 0);
    let best = -1;
    let bestHeight = 0;
    heights.forEach((h, i) => {
      if (h <= 1080 && h > bestHeight) { bestHeight = h; best = i; }
    });
    // Cap automatic selection instead of pinning currentLevel. Setting currentLevel flushes
    // the whole buffer and playback visibly stalls; a cap keeps 1080p when the connection
    // allows it and lets ABR drop a level when it does not, so the stream keeps flowing.
    if (best >= 0) hls.autoLevelCapping = best;
  };
  const releaseLevel = () => {
    if (hlsRef.current && settings.recordQuality === "fullhd") hlsRef.current.autoLevelCapping = -1;
  };

  const getCapture = (): MediaStream | null => {
    const v = videoRef.current;
    if (!v) return null;
    const media = captureVideo(v, recRef.current?.mediaStream() ?? captureRef.current);
    captureRef.current = media;
    return media;
  };

  const saveSegment = async (seg: LiveSegment) => {
    const v = videoRef.current;
    const id = uid("c");
    const blobKey = `clip:${id}`;
    const c: Clip = {
      id,
      mediaId: uid("m"),
      blobKey,
      streamTitle: stream.title,
      capturedAt: seg.startedAt,
      seconds: seg.seconds,
      in: 0,
      duration: seg.seconds,
      width: v?.videoWidth ?? 0,
      height: v?.videoHeight ?? 0,
      thumb: null,
      thumbKey: null,
      note: "",
      recording: true,
      favourite: false,
      edited: false,
      renderedAt: null,
      removedAt: null,
    };
    // Store and list the playable WebM first. Waiting for MP4 remuxing used to delay the
    // gallery entry until the server was free, so stopping a recording looked like a no-op.
    try {
      await putBlob(blobKey, seg.blob);
      addClip(c);
    } catch (e) {
      console.error("[record]", e);
      logActivity("error", `Couldn't save a recording of ${stream.title}`);
      toast("A recording couldn't be saved.", "error");
      return;
    }
    logActivity("success", `Auto-saved ${Math.round(seg.seconds)}s recording of ${stream.title}`);
    toast(`Recording saved to Records: ${stream.title}`, "success", { label: "Records", run: () => go("recommend") });
    // Recordings stay raw captures. Auto-captions are for uploaded/manual clips in Clips only.
    // Best-effort MP4 remux on the local API. The clip stays visible even when this fails.
    void finalizeClipBlob(seg.blob, 0, seg.seconds).then(async (final) => {
      if (!final) return;
      try {
        await putBlob(blobKey, final.blob);
        forgetUrl(blobKey);
        updateClip(id, { seconds: final.duration, duration: final.duration });
      } catch {
        /* keep the original WebM */
      }
    }).catch(() => {});
  };
  const saveSegmentRef = useRef(saveSegment);
  saveSegmentRef.current = saveSegment;

  const startRecording = useCallback(() => {
    if (liveRecRef.current?.active) return;
    const media = getCapture();
    if (!media || !canClip()) {
      toast("This browser can't record streams. Use Chrome, Edge or Firefox.", "error");
      return;
    }
    const tracks = captureTracks(media);
    if (!tracks.video) {
      toast("This stream has no video frames to record yet. Wait for it to start and try again.", "error");
      return;
    }
    if (!tracks.audio) {
      logActivity("warn", `${stream.title} has no audio track, so the recording will be silent`);
    }
    try {
      liveRecRef.current = new LiveRecorder({
        stream: media,
        segmentSeconds: settings.recordSaveSeconds,
        bitrate: recordBitrate(settings.recordQuality),
        onSegment: (seg) => saveSegmentRef.current(seg),
        onRotate: () => logActivity("info", `Saving ${stream.title} segment to Records`),
        onError: (msg) => {
          logActivity("error", `Recording ${stream.title}: ${msg}`);
          toast(`Recording of ${stream.title}: ${msg}`, "error");
        },
      });
      setRecording(true);
      forceFullHdLevel();
      logActivity("info", `Recording ${stream.title} in real time, auto-saving every ${fmtDuration(settings.recordSaveSeconds)}`);
    } catch (e) {
      const msg = e instanceof DOMException && e.name === "SecurityError" ? "This stream's server doesn't allow recording" : "Recording couldn't start";
      logActivity("warn", `Can't record ${stream.title}: ${msg}`);
      toast(msg, "error");
    }
  }, [settings.recordSaveSeconds, settings.recordQuality, stream.title, toast]);

  const stopRecording = useCallback(() => {
    const r = liveRecRef.current;
    if (!r) return;
    liveRecRef.current = null;
    autoStartedRef.current = false;
    setSaving(true);
    void r.stop().finally(() => setSaving(false));
    setRecording(false);
    setRecordSeconds(0);
    releaseLevel();
    logActivity("info", `Stopped recording ${stream.title}, saving the final segment`);
  }, [stream.title]);

  const saveNow = useCallback(() => {
    const r = liveRecRef.current;
    if (!r) return;
    setSaving(true);
    void r.flush().finally(() => setSaving(false));
  }, []);

  // Global auto record follows the toggle; a stream stopped on purpose stays stopped.
  useEffect(() => {
    if (state === "error") {
      if (autoStartedRef.current) stopRecording();
      return;
    }
    if (settings.autoRecord && state === "playing" && !liveRecRef.current) {
      autoStartedRef.current = true;
      startRecording();
    } else if (!settings.autoRecord && autoStartedRef.current) {
      stopRecording();
    }
  }, [settings.autoRecord, state, startRecording, stopRecording]);

  useEffect(() => {
    liveRecRef.current?.setSegmentSeconds(settings.recordSaveSeconds);
  }, [settings.recordSaveSeconds]);

  // Background tabs throttle timers. When the tab comes back, flush a segment that is overdue
  // instead of waiting for the delayed timeout to fire.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const r = liveRecRef.current;
      if (r && r.seconds >= settings.recordSaveSeconds) void r.flush();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [settings.recordSaveSeconds]);

  // Flush the running segment when the tile unmounts (stream closed or app reload).
  useEffect(() => () => {
    const r = liveRecRef.current;
    if (r) { liveRecRef.current = null; r.stop(); }
  }, []);

  const clip = async (meta?: { note?: string; score?: number; title?: string; viral?: ViralDetails; groupId?: string; streams?: string[] }): Promise<Clip | null> => {
    const rec = recRef.current;
    const v = videoRef.current;
    if (!rec || !v || busy) return null;
    setBusy(true);
    try {
      let thumb: string | null = null;
      try {
        const c = document.createElement("canvas");
        c.width = 320;
        c.height = Math.round((320 * (v.videoHeight || 9)) / (v.videoWidth || 16));
        c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
        thumb = c.toDataURL("image/jpeg", 0.72);
      } catch {
        thumb = null;
      }
      const r = await rec.capture();
      if (!r || r.length < 0.5) {
        toast("Nothing recorded yet. Give the stream a moment to buffer.", "error");
        return null;
      }
      const id = uid("c");
      const blobKey = `clip:${id}`;
      // Thumbnails go to IndexedDB; an inline data URL here used to push the clips list past
      // localStorage's quota, where new clips would be dropped silently on reload.
      const thumbKey = await saveThumb(id, thumb);
      const wanted = Math.min(r.length, settings.captureSeconds);
      let outBlob: Blob = r.blob;
      let outIn = r.in;
      let outDuration = r.length;
      const final = await finalizeClipBlob(r.blob, r.in, wanted);
      if (final) {
        outBlob = final.blob;
        outIn = 0;
        outDuration = final.duration;
      }
      await putBlob(blobKey, outBlob);
      const c: Clip = {
        id,
        mediaId: uid("m"),
        blobKey,
        streamTitle: stream.title,
        capturedAt: Date.now(),
        seconds: wanted,
        in: outIn,
        duration: outDuration,
        width: v.videoWidth,
        height: v.videoHeight,
        thumb: thumbKey ? null : thumb,
        thumbKey,
        note: meta?.note ?? "",
        aiScore: meta?.score,
        aiTitle: meta?.title,
        viral: meta?.viral,
        aiGroupId: meta?.groupId,
        aiGroupStreams: meta?.streams,
        favourite: (meta?.score ?? 0) >= 9,
        edited: false,
        renderedAt: null,
        removedAt: null,
      };
      addClip(c);
      if (settings.autoCaptionOnClip) void autoCaptionClip(c.id, outBlob);
      if (!meta) {
        logActivity("success", `Clip saved — ${stream.title}`);
        toast(`Clipped ${Math.round(c.seconds)}s of ${stream.title}`, "success", { label: "Clips", run: () => go("clips") });
      }
      return c;
    } catch (e) {
      console.error("[clip]", e);
      toast("The clip couldn't be saved.", "error");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const clipRef = useRef(clip);
  clipRef.current = clip;

  const analyze = async (): Promise<{ verdict: MomentVerdict; transcript: string } | null> => {
    const v = videoRef.current;
    if (!v || state !== "playing" || aiBusy) return null;
    setAiBusy(true);
    try {
      let snapshot: string | undefined;
      try {
        if (v.videoWidth > 0 && v.videoHeight > 0) {
          const c = document.createElement("canvas");
          c.width = 640;
          c.height = Math.round((640 * v.videoHeight) / v.videoWidth);
          c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
          snapshot = c.toDataURL("image/jpeg", 0.72);
        }
      } catch {
        snapshot = undefined;
      }
      const chunk = await recordAudioChunk(v, 5, recRef.current?.audioStream() ?? null);
      let transcript = "";
      if (chunk) {
        try {
          const out = await generateCaptionsForBlob(chunk, settings, { format: "json" });
          transcript = out.text.trim();
        } catch {
          transcript = "";
        }
      }
      if (!transcript && !snapshot) return null;
      const verdict = await judgeMoment(settings, { title: stream.title, transcript, snapshot });
      setLastVerdict({ score: verdict.score, at: Date.now() });
      return { verdict, transcript };
    } finally {
      setAiBusy(false);
    }
  };

  const analyzeRef = useRef(analyze);
  analyzeRef.current = analyze;
  const stateRef = useRef(state);
  stateRef.current = state;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const aiBusyRef = useRef(aiBusy);
  aiBusyRef.current = aiBusy;

  useEffect(() => {
    register(stream.id, {
      clip: (meta) => clipRef.current(meta),
      analyze: () => analyzeRef.current(),
      ready: () => stateRef.current === "playing" && !!recRef.current && !busyRef.current && !aiBusyRef.current,
    });
    return () => register(stream.id, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register, stream.id]);

  const watchingMin = Math.floor((now - stream.openedAt) / 60000);
  const canClipNow = settings.rollingBuffer && !!recRef.current && !recError && state === "playing";
  const clipTitle = !settings.rollingBuffer
    ? "Turn on the rolling buffer in Settings to clip"
    : recError || (state !== "playing" ? "Waiting for the stream" : `Clip the last ${settings.captureSeconds}s`);

  return (
    <article className="rec-card" aria-label={stream.title}>
      <video ref={videoRef} playsInline className="stream-headless-video" />
      <div className="rec-head">
        {live ? (
          <span className="chip live">
            <span className="live-dot" /> Live
          </span>
        ) : (
          <span className="chip overlay-chip">{state === "error" ? "Offline" : "Connecting"}</span>
        )}
        <b className="rec-title" title={stream.title}>{stream.title}</b>
        <button className="btn plain icon sm" onClick={() => onClose(stream)} aria-label={`Stop watching ${stream.title}`} title="Stop watching">
          <X className="ic" />
        </button>
      </div>
      {state === "error" ? (
        <div className="rec-error">
          <p>{error}</p>
          <button className="btn ghost sm" onClick={() => void reResolve()}>Reload stream</button>
        </div>
      ) : (
        <>
          <div className="rec-meta">
            <span className="muted tabular"><Clock className="ic" /> {watchingMin < 1 ? "just started" : `watching ${watchingMin} min`}</span>
            {state === "playing" && !recError && settings.rollingBuffer && (
              <span className="buffer-meter tabular" title="Seconds held in the rolling buffer">
                <i style={{ width: `${(buffered / settings.captureSeconds) * 100}%` }} />
                {Math.floor(buffered)}s
              </span>
            )}
            {recording && (
              <span className="rec-live tabular" title={`Recording in real time. Auto-saves to Records every ${fmtDuration(settings.recordSaveSeconds)}.`}>
                <span className="rec-dot" aria-hidden="true" /> REC {fmtTime(recordSeconds)}
              </span>
            )}
            {recError && <span className="rec-warn">{recError}</span>}
          </div>
          <div className="rec-foot">
            <span className={`ai-state${!settings.aiAutoClip || aiError ? " warn" : ""}`} title={aiError ?? (settings.aiAutoClip ? "Most recent AI score for this stream" : "AI auto clip is off, turn it on in the bar above")}>
              <Sparkles className="ic" />
              {!settings.aiAutoClip
                ? "AI off, enable in the bar above"
                : aiError
                  ? `AI can't listen: ${aiError.slice(0, 72)}`
                  : aiBusy
                    ? "Listening…"
                    : lastVerdict
                      ? `Last check ${lastVerdict.score}/10`
                      : `AI every ${settings.aiClipInterval} min`}
            </span>
            <button
              className={`btn sm ${recording ? "rec-on" : "ghost"}`}
              onClick={recording ? stopRecording : startRecording}
              disabled={state !== "playing" || !canClip() || saving}
              aria-pressed={recording}
              title={recording ? "Stop recording and save the current segment" : `Record this stream in real time and auto-save every ${fmtDuration(settings.recordSaveSeconds)}`}
            >
              {saving ? <span className="spinner" /> : recording ? <Square className="ic" /> : <Circle className="ic" />}
              {saving ? "Saving" : recording ? "Stop" : "Record"}
            </button>
            <button
              className="btn ghost sm"
              onClick={saveNow}
              disabled={!recording || saving}
              title="Save the current segment to Records without stopping the recording"
            >
              <Save className="ic" /> Save now
            </button>
            <button className="btn accent sm" onClick={() => void clip()} disabled={!canClipNow || busy} title={clipTitle}>
              {busy ? <span className="spinner" /> : <Scissors className="ic" />}
              Clip
            </button>
          </div>
        </>
      )}
    </article>
  );
});

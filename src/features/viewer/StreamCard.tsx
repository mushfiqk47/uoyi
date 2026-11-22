import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Clock, Circle, Maximize, Minimize, Scissors, Server, Sparkles, Square, Volume2, VolumeX, X } from "lucide-react";
import { useViewerStore } from "../../store";
import type { Stream } from "../../lib/types";
import { canClip } from "../../lib/recorder";
import { fmtDuration, fmtTime } from "../../lib/util";
import { judgeMoment, type MomentVerdict } from "../../lib/ai/openai";
import { recordAudioChunk } from "../../lib/ai/audioSample";
import { generateCaptionsForBlob } from "../../lib/ai/captions";
import { useHlsStream } from "./useHlsStream";
import { useAudioMonitor } from "./useAudioMonitor";
import { useStreamRecorder } from "./useStreamRecorder";
import type { TileApi } from "./types";

export const StreamCard = memo(function StreamCard({
  stream,
  aiError,
  onClose,
  onEnergySpike,
  register,
}: {
  stream: Stream;
  aiError: string | null;
  onClose: () => void;
  onEnergySpike?: () => void;
  register: (api: TileApi | null) => void;
}) {
  const { settings, addClip, updateClip, toast, updateStream, autoCaptionClip, go } = useViewerStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [lastVerdict, setLastVerdict] = useState<{ score: number; at: number } | null>(null);
  const [now, setNow] = useState(Date.now());

  const [fullSize, setFullSize] = useState(false);
  const toggleFullSize = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      else void v.requestFullscreen().catch(() => toast("Fullscreen was blocked by the browser.", "error"));
    } catch {
      toast("Fullscreen is not supported in this browser.", "error");
    }
  }, [toast]);
  useEffect(() => {
    const onFs = () => setFullSize(document.fullscreenElement === videoRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const isRecordingRef = useRef(false);
  const applyAudioRef = useRef<() => void>(() => {});
  const resetCaptureRef = useRef<() => void>(() => {});
  const [hlsLive, setHlsLive] = useState(false);

  const forceHdRef = useRef<() => void>(() => {});
  const releaseLvlRef = useRef<() => void>(() => {});

  const [playState, setPlayState] = useState<"loading" | "playing" | "error">("loading");

  const rec = useStreamRecorder({
    stream,
    videoRef,
    state: playState,
    settings,
    addClip,
    updateClip,
    autoCaptionClip,
    toast,
    go,
    forceFullHdLevel: () => forceHdRef.current(),
    releaseLevel: () => releaseLvlRef.current(),
  });
  isRecordingRef.current = rec.isRecordingRef.current;
  resetCaptureRef.current = rec.resetCapture;

  const audio = useAudioMonitor({
    videoRef,
    srvAvail: rec.srvAvail,
    playing: playState === "playing",
    aiAutoClip: settings.aiAutoClip,
    getAudioStream: rec.getAudioStream,
    onEnergySpike,
  });
  applyAudioRef.current = audio.applyTileAudio;

  const hls = useHlsStream({
    stream,
    videoRef,
    recordQuality: settings.recordQuality,
    isRecordingRef: rec.isRecordingRef,
    updateStream,
    toast,
    onResetCapture: () => resetCaptureRef.current(),
    applyAudio: () => applyAudioRef.current(),
  });
  forceHdRef.current = hls.forceFullHdLevel;
  releaseLvlRef.current = hls.releaseLevel;

  useEffect(() => {
    setPlayState(hls.state);
    setHlsLive(hls.live);
  }, [hls.state, hls.live]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const analyze = async (): Promise<{ verdict: MomentVerdict; transcript: string } | null> => {
    const v = videoRef.current;
    if (!v || hls.state !== "playing" || aiBusy) return null;
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
      const chunk = await recordAudioChunk(v, 5, rec.getAudioStream());
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

  const clipRef = useRef(rec.clip);
  clipRef.current = rec.clip;
  const analyzeRef = useRef(analyze);
  analyzeRef.current = analyze;
  const readyRef = useRef(false);
  readyRef.current = hls.state === "playing" && rec.hasRollingBuffer && !rec.busy && !aiBusy;

  useEffect(() => {
    register({
      clip: (meta) => clipRef.current(meta),
      analyze: () => analyzeRef.current(),
      ready: () => readyRef.current,
    });
    return () => register(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register]);

  const watchingMin = Math.floor((now - stream.openedAt) / 60000);
  const canClipNow = settings.rollingBuffer && rec.hasRollingBuffer && !rec.recError && hls.state === "playing";
  const clipTitle = !settings.rollingBuffer
    ? "Turn on the rolling buffer in Settings to clip"
    : rec.recError || (hls.state !== "playing" ? "Waiting for the stream" : `Clip the last ${settings.captureSeconds}s`);
  const bufferPct = Math.max(0, Math.min(100, (rec.buffered / settings.captureSeconds) * 100));

  return (
    <article className="rec-card" aria-label={stream.title}>
      <video ref={videoRef} playsInline onDoubleClick={toggleFullSize} className="stream-video" />
      <div className="rec-head">
        {hlsLive ? (
          <span className="chip live">
            <span className="live-dot" /> Live
          </span>
        ) : (
          <span className="chip overlay-chip">{hls.state === "error" ? "Offline" : "Connecting"}</span>
        )}
        <b className="rec-title" title={stream.title}>{stream.title}</b>
        <button
          className="btn plain icon sm"
          onClick={toggleFullSize}
          aria-label={fullSize ? "Exit full size" : "Watch full size"}
          title={fullSize ? "Exit full size (Esc)" : "Watch this stream full size — double-click the video works too"}
        >
          {fullSize ? <Minimize className="ic" /> : <Maximize className="ic" />}
        </button>
        <button
          className="btn plain icon sm"
          onClick={() => audio.setTileAudible(!audio.audible)}
          aria-label={audio.audible ? "Mute this tile" : "Unmute this tile"}
          aria-pressed={audio.audible}
          title={audio.audible ? "Mute this tile — recordings keep full audio regardless" : "Unmute this tile"}
        >
          {audio.audible ? <Volume2 className="ic" /> : <VolumeX className="ic" />}
        </button>
        <button className="btn plain icon sm" onClick={onClose} aria-label={`Stop watching ${stream.title}`} title="Stop watching">
          <X className="ic" />
        </button>
      </div>
      {hls.state === "error" ? (
        <div className="rec-error">
          <p>{hls.error}</p>
          <button className="btn ghost sm" onClick={() => void hls.reResolve()}>Reload stream</button>
        </div>
      ) : (
        <>
          <div className="rec-meta">
            <span className="muted tabular"><Clock className="ic" /> {watchingMin < 1 ? "just started" : `watching ${watchingMin} min`}</span>
            {hls.state === "playing" && !rec.recError && settings.rollingBuffer && (
              <span className="buffer-meter tabular" title="Seconds held in the rolling buffer">
                <progress value={bufferPct} max={100} aria-label="Rolling buffer" />
                {Math.floor(rec.buffered)}s
              </span>
            )}
            {rec.recording && (
              <span className="rec-live tabular" title={`Recording in real time. Auto-saves to Records every ${fmtDuration(settings.recordSaveSeconds)}.`}>
                <span className="rec-dot" aria-hidden="true" /> REC {fmtTime(rec.recordSeconds)}
              </span>
            )}
            {rec.srvRecId && (
              <span className="rec-live tabular" title="Streamlink is recording this stream on the server — original quality, unaffected by this tab.">
                <span className="rec-dot" aria-hidden="true" /> REC {fmtTime(rec.srvSeconds)} · server
              </span>
            )}
            {rec.recError && <span className="rec-warn">{rec.recError}</span>}
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
            <span className="rec-actions">
              <button className="btn accent sm" onClick={() => void rec.clip()} disabled={!canClipNow || rec.busy} title={clipTitle}>
                {rec.busy ? <span className="spinner" /> : <Scissors className="ic" />}
                Clip
              </button>
              {rec.srvUrl && rec.srvAvail ? (
                <button
                  className={`btn sm ${rec.srvRecId ? "rec-on" : "ghost"}`}
                  onClick={() => void (rec.srvRecId ? rec.stopServerRec() : rec.startServerRec())}
                  disabled={rec.srvBusy || rec.saving}
                  aria-pressed={!!rec.srvRecId}
                  title={
                    rec.srvRecId
                      ? "Stop recording and save it to Records"
                      : "Record on the server with Streamlink — original quality, audio + video."
                  }
                >
                  {rec.srvBusy ? <span className="spinner" /> : rec.srvRecId ? <Square className="ic" /> : <Server className="ic" />}
                  {rec.srvBusy ? "Saving" : rec.srvRecId ? "Stop" : "Record"}
                </button>
              ) : (
                <button
                  className={`btn sm ${rec.recording ? "rec-on" : "ghost"}`}
                  onClick={rec.recording ? rec.stopRecording : rec.startRecording}
                  disabled={hls.state !== "playing" || !canClip() || rec.saving}
                  aria-pressed={rec.recording}
                  title={
                    !rec.srvAvail && !!rec.srvUrl
                      ? "Install Streamlink for server-quality recording: pip install streamlink"
                      : rec.recording
                        ? "Stop recording and save the current segment"
                        : `Record this stream in real time and auto-save every ${fmtDuration(settings.recordSaveSeconds)}`
                  }
                >
                  {rec.saving ? <span className="spinner" /> : rec.recording ? <Square className="ic" /> : <Circle className="ic" />}
                  {rec.saving ? "Saving" : rec.recording ? "Stop" : "Record"}
                </button>
              )}
            </span>
          </div>
        </>
      )}
    </article>
  );
});

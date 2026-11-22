import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Clip, Stream, ViralDetails } from "../../lib/types";
import type { Settings } from "../../lib/settings";
import type { Screen } from "../../store";
import {
  canClip,
  captureTracks,
  captureVideo,
  LiveRecorder,
  recordBitrate,
  RollingRecorder,
  type LiveSegment,
} from "../../lib/recorder";
import { forgetUrl, putBlob } from "../../lib/db";
import { saveThumb } from "../../lib/thumbs";
import { uid } from "../../lib/util";
import { finalizeClipBlob } from "../../platform/api/media";
import { apiFetch } from "../../platform/api/client";
import {
  cancelServerRecord,
  listServerRecords,
  serverRecordAvailable,
  serverRecordStatus,
  startServerRecord,
  stopServerRecord,
} from "../../platform/api/streamlink";

const SRV_REC_STORAGE = "clipkit.srvRecs.v1";

function loadSavedRecId(streamId: string): string | null {
  try {
    const raw = sessionStorage.getItem(SRV_REC_STORAGE);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    return typeof map[streamId] === "string" ? map[streamId] : null;
  } catch {
    return null;
  }
}

function saveRecId(streamId: string, recId: string | null): void {
  try {
    const raw = sessionStorage.getItem(SRV_REC_STORAGE);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    if (recId) map[streamId] = recId;
    else delete map[streamId];
    sessionStorage.setItem(SRV_REC_STORAGE, JSON.stringify(map));
  } catch {
    /* ignore quota errors */
  }
}

export function useStreamRecorder({
  stream,
  videoRef,
  state,
  settings,
  addClip,
  updateClip,
  autoCaptionClip,
  toast,
  go,
  forceFullHdLevel,
  releaseLevel,
}: {
  stream: Stream;
  videoRef: RefObject<HTMLVideoElement | null>;
  state: "loading" | "playing" | "error";
  settings: Settings;
  addClip: (c: Clip) => void;
  updateClip: (id: string, patch: Partial<Clip>) => void;
  autoCaptionClip: (id: string, blob: Blob) => Promise<void>;
  toast: (text: string, tone?: "info" | "error" | "success", action?: { label: string; run: () => void }) => void;
  go: (s: Screen) => void;
  forceFullHdLevel: () => void;
  releaseLevel: () => void;
}) {
  const recRef = useRef<RollingRecorder | null>(null);
  const liveRecRef = useRef<LiveRecorder | null>(null);
  const captureRef = useRef<MediaStream | null>(null);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [rollingReady, setRollingReady] = useState(false);
  const [recError, setRecError] = useState("");
  const [busy, setBusy] = useState(false);

  const [srvAvail, setSrvAvail] = useState(false);
  const [srvRecId, setSrvRecId] = useState<string | null>(null);
  const [srvSeconds, setSrvSeconds] = useState(0);
  const [srvBusy, setSrvBusy] = useState(false);
  const srvTicking = useRef(false);
  const srvRecIdRef = useRef<string | null>(null);
  srvRecIdRef.current = srvRecId;

  const isRecordingRef = useRef(false);
  isRecordingRef.current = recording || Boolean(srvRecId);

  const srvUrl = /^https?:\/\//i.test(stream.sourceUrl ?? "")
    ? stream.sourceUrl!
    : /^https?:\/\//i.test(stream.url)
      ? stream.url
      : "";
  const srvMode = !!srvUrl && srvAvail;

  useEffect(() => {
    void serverRecordAvailable().then(setSrvAvail);
  }, []);

  // Reattach any live server recording that survived a component remount / page reload.
  useEffect(() => {
    const savedId = loadSavedRecId(stream.id);
    if (!savedId) return;
    let alive = true;
    void listServerRecords()
      .then((res) => {
        if (!alive) return;
        const found = res.items?.find((item) => item.id === savedId && item.status === "recording");
        if (found) {
          setSrvRecId(found.id);
          setSrvSeconds(found.seconds);
        } else {
          saveRecId(stream.id, null);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [stream.id]);

  // Rolling buffer
  useEffect(() => {
    if (state !== "playing" || !settings.rollingBuffer) return;
    if (!canClip()) {
      setRecError("This browser can't record streams");
      return;
    }
    try {
      recRef.current = new RollingRecorder(videoRef.current!, settings.captureSeconds, recordBitrate(settings.recordQuality));
      setRollingReady(true);
      setRecError("");
    } catch (e) {
      setRollingReady(false);
      const msg = e instanceof DOMException && e.name === "SecurityError" ? "This stream's server doesn't allow recording" : "Recording couldn't start";
      setRecError(msg);
    }
    return () => {
      recRef.current?.dispose();
      recRef.current = null;
      setRollingReady(false);
      setBuffered(0);
    };
  }, [state, settings.rollingBuffer, settings.captureSeconds, settings.recordQuality, videoRef]);

  useEffect(() => {
    const t = window.setInterval(() => {
      setBuffered(recRef.current?.buffered ?? 0);
      setRecordSeconds(liveRecRef.current?.seconds ?? 0);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const resetCapture = useCallback(() => {
    captureRef.current = null;
  }, []);

  const getCapture = useCallback((): MediaStream | null => {
    const v = videoRef.current;
    if (!v) return null;
    const media = captureVideo(v, recRef.current?.mediaStream() ?? captureRef.current);
    captureRef.current = media;
    return media;
  }, [videoRef]);

  const getAudioStream = useCallback((): MediaStream | null => {
    if (recRef.current) return recRef.current.audioStream();
    const cap = getCapture();
    const tracks = cap?.getAudioTracks() ?? [];
    return tracks.length ? new MediaStream(tracks) : null;
  }, [getCapture]);

  const saveSegment = async (seg: LiveSegment & { alreadyFinalized?: boolean }) => {
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
    try {
      await putBlob(blobKey, seg.blob);
      addClip(c);
    } catch (e) {
      console.error("[record]", e);
      toast("A recording couldn't be saved.", "error");
      return;
    }
    toast(`Recording saved to Records: ${stream.title}`, "success", { label: "Records", run: () => go("recommend") });
    if (seg.alreadyFinalized || seg.mime === "video/mp4") return;
    void finalizeClipBlob(seg.blob, 0, seg.seconds)
      .then(async (final) => {
        if (!final) return;
        try {
          await putBlob(blobKey, final.blob);
          forgetUrl(blobKey);
          updateClip(id, { seconds: final.duration, duration: final.duration });
        } catch {
          /* keep the original WebM */
        }
      })
      .catch(() => {});
  };
  const saveSegmentRef = useRef(saveSegment);
  saveSegmentRef.current = saveSegment;

  const autoKindRef = useRef<"browser" | "server" | null>(null);
  const manualPausedAutoRef = useRef(false);

  const saveServerRecording = useCallback(
    async (recId: string, fallbackSeconds: number) => {
      saveRecId(stream.id, null);
      try {
        const res = await stopServerRecord(recId);
        if (!res.url) throw new Error("no recording file");
        const blob = await apiFetch(res.url).then((r) => r.blob());
        await saveSegmentRef.current({
          blob,
          seconds: res.seconds || fallbackSeconds,
          startedAt: Date.now() - (res.seconds || fallbackSeconds) * 1000,
          mime: res.mime || blob.type || "video/mp4",
          alreadyFinalized: Boolean(res.alreadyFinalized || (res.mime || blob.type) === "video/mp4"),
        });
      } catch (e) {
        const msg = (e as Error).message || "unknown error";
        toast(`Server recording could not be saved: ${msg}`, "error");
      }
    },
    [stream.id, toast],
  );

  const startServerRec = useCallback(async () => {
    if (!srvUrl || srvBusy || srvRecId) return;
    manualPausedAutoRef.current = false;
    setSrvBusy(true);
    try {
      const r = await startServerRecord(srvUrl, stream.title, settings.recordQuality);
      setSrvRecId(r.id);
      saveRecId(stream.id, r.id);
      setSrvSeconds(r.seconds ?? 0);
    } catch (e) {
      autoKindRef.current = null;
      toast(`Server recording couldn't start: ${(e as Error).message}`, "error");
    } finally {
      setSrvBusy(false);
    }
  }, [srvUrl, srvBusy, srvRecId, stream.id, stream.title, settings.recordQuality, toast]);

  const stopServerRec = useCallback(async (userInitiated = false) => {
    const recId = srvRecId;
    if (!recId || srvBusy) return;
    if (userInitiated) manualPausedAutoRef.current = true;
    autoKindRef.current = null;
    setSrvBusy(true);
    setSrvRecId(null);
    const seconds = srvSeconds;
    setSrvSeconds(0);
    await saveServerRecording(recId, seconds);
    setSrvBusy(false);
  }, [srvRecId, srvSeconds, srvBusy, saveServerRecording]);

  useEffect(() => {
    if (!srvRecId) return;
    let alive = true;
    const tick = async () => {
      if (srvTicking.current) return;
      srvTicking.current = true;
      try {
        const st = await serverRecordStatus(srvRecId);
        if (!alive) return;
        if (st.status === "failed") {
          setSrvRecId(null);
          setSrvSeconds(0);
          autoKindRef.current = null;
          saveRecId(stream.id, null);
          void cancelServerRecord(srvRecId).catch(() => {});
          toast(`Server recording stopped: ${st.err || "unknown error"}`, "error");
          return;
        }
        if (st.status === "done") {
          setSrvRecId(null);
          autoKindRef.current = null;
          await saveServerRecording(srvRecId, st.seconds);
          return;
        }
        setSrvSeconds(st.seconds);
      } catch {
        /* transient */
      } finally {
        srvTicking.current = false;
      }
    };
    const timer = window.setInterval(() => void tick(), 1000);
    void tick();
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [srvRecId, stream.id, toast, saveServerRecording]);

  const saveServerRecordingRef = useRef(saveServerRecording);
  saveServerRecordingRef.current = saveServerRecording;
  useEffect(
    () => () => {
      const recId = srvRecIdRef.current;
      if (recId) void saveServerRecordingRef.current(recId, 0);
    },
    [],
  );

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
    manualPausedAutoRef.current = false;
    try {
      liveRecRef.current = new LiveRecorder({
        stream: media,
        segmentSeconds: settings.recordSaveSeconds,
        bitrate: recordBitrate(settings.recordQuality),
        onSegment: (seg) => saveSegmentRef.current(seg),
        onError: (msg) => {
          toast(`Recording of ${stream.title}: ${msg}`, "error");
        },
      });
      setRecording(true);
      forceFullHdLevel();
    } catch (e) {
      autoKindRef.current = null;
      const msg = e instanceof DOMException && e.name === "SecurityError" ? "This stream's server doesn't allow recording" : "Recording couldn't start";
      toast(msg, "error");
    }
  }, [getCapture, settings.recordSaveSeconds, settings.recordQuality, stream.title, toast, forceFullHdLevel]);

  const stopRecording = useCallback(
    (userInitiated = false) => {
      const r = liveRecRef.current;
      if (!r) return;
      if (userInitiated) manualPausedAutoRef.current = true;
      autoKindRef.current = null;
      liveRecRef.current = null;
      setSaving(true);
      void r.stop().finally(() => setSaving(false));
      setRecording(false);
      setRecordSeconds(0);
      releaseLevel();
    },
    [releaseLevel],
  );

  useEffect(() => {
    const stopAuto = () => {
      const kind = autoKindRef.current;
      autoKindRef.current = null;
      if (kind === "browser") stopRecording(false);
      else if (kind === "server") void stopServerRec(false);
    };
    if (!settings.autoRecord) {
      manualPausedAutoRef.current = false;
      stopAuto();
      return;
    }
    if (autoKindRef.current === "browser" && state === "error") {
      stopAuto();
      return;
    }
    if (autoKindRef.current || manualPausedAutoRef.current) return;
    if (srvMode) {
      if (!srvRecId && !srvBusy) {
        autoKindRef.current = "server";
        void startServerRec();
      }
      return;
    }
    if (state === "playing" && !liveRecRef.current) {
      autoKindRef.current = "browser";
      startRecording();
    }
  }, [settings.autoRecord, srvMode, srvRecId, srvBusy, state, startServerRec, startRecording, stopRecording, stopServerRec]);

  useEffect(() => {
    liveRecRef.current?.setSegmentSeconds(settings.recordSaveSeconds);
  }, [settings.recordSaveSeconds]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const r = liveRecRef.current;
      if (r && r.seconds >= settings.recordSaveSeconds) void r.flush();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [settings.recordSaveSeconds]);

  useEffect(
    () => () => {
      const r = liveRecRef.current;
      if (r) {
        liveRecRef.current = null;
        void r.stop();
      }
    },
    [],
  );

  const clip = useCallback(
    async (meta?: { note?: string; score?: number; title?: string; viral?: ViralDetails; groupId?: string; streams?: string[] }): Promise<Clip | null> => {
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
    },
    [videoRef, busy, settings.captureSeconds, settings.autoCaptionOnClip, stream.title, addClip, autoCaptionClip, toast, go],
  );

  const hasRollingBuffer = rollingReady;

  return {
    recording,
    saving,
    recordSeconds,
    buffered,
    recError,
    busy,
    hasRollingBuffer,
    srvAvail,
    srvUrl,
    srvRecId,
    srvSeconds,
    srvBusy,
    isRecordingRef,
    resetCapture,
    getAudioStream,
    clip,
    startRecording,
    stopRecording: () => stopRecording(true),
    startServerRec,
    stopServerRec: () => stopServerRec(true),
  };
}

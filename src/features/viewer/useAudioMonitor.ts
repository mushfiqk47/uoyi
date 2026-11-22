import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

const SPIKE_DB_DELTA = 10;
const SPIKE_MIN_RMS = 0.025; // ~ -32 dBFS so quiet static doesn't trigger
const SPIKE_SUSTAIN_MS = 800;
const SPIKE_COOLDOWN_MS = 20_000;

export function useAudioMonitor({
  videoRef,
  srvAvail,
  playing,
  aiAutoClip,
  getAudioStream,
  onEnergySpike,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  srvAvail: boolean;
  playing: boolean;
  aiAutoClip: boolean;
  getAudioStream: () => MediaStream | null;
  onEnergySpike?: () => void;
}) {
  const [audible, setAudible] = useState(false);
  const audibleRef = useRef(false);
  const srvAvailRef = useRef(srvAvail);
  srvAvailRef.current = srvAvail;
  const onSpikeRef = useRef(onEnergySpike);
  onSpikeRef.current = onEnergySpike;

  const applyTileAudio = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (audibleRef.current) {
      v.muted = false;
      v.volume = 1;
    } else if (srvAvailRef.current) {
      v.muted = true;
      v.volume = 0;
    } else {
      // Browser capture still needs non-zero element volume to keep audio active.
      v.muted = false;
      v.volume = 0.001;
    }
  }, [videoRef]);

  const setTileAudible = useCallback(
    (on: boolean) => {
      audibleRef.current = on;
      setAudible(on);
      applyTileAudio();
    },
    [applyTileAudio],
  );

  useEffect(() => {
    applyTileAudio();
  }, [srvAvail, applyTileAudio]);

  // Monitor audio energy spikes (+10dB above rolling baseline for 800ms) when AI Auto-Clip is active.
  useEffect(() => {
    if (!playing || !aiAutoClip || typeof AudioContext === "undefined") return;
    const stream = getAudioStream();
    const audioTracks = stream?.getAudioTracks() ?? [];
    if (!audioTracks.length) return;

    let ctx: AudioContext | null = null;
    let timer: number | null = null;
    try {
      ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(new MediaStream(audioTracks));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      let emaDb = -40;
      let sustainSince = 0;
      let lastSpikeAt = 0;

      timer = window.setInterval(() => {
        if (!ctx || ctx.state === "suspended") {
          void ctx?.resume().catch(() => {});
        }
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        const db = 20 * Math.log10(Math.max(rms, 1e-5));
        const now = Date.now();
        const overDelta = db - emaDb > SPIKE_DB_DELTA && rms >= SPIKE_MIN_RMS;
        // Slowly track baseline noise floor while avoiding spikes pulling baseline right up.
        emaDb = emaDb * (overDelta ? 0.99 : 0.94) + db * (overDelta ? 0.01 : 0.06);

        if (overDelta) {
          if (!sustainSince) sustainSince = now;
          if (now - sustainSince >= SPIKE_SUSTAIN_MS && now - lastSpikeAt >= SPIKE_COOLDOWN_MS) {
            lastSpikeAt = now;
            sustainSince = 0;
            onSpikeRef.current?.();
          }
        } else {
          sustainSince = 0;
        }
      }, 200);
    } catch {
      /* CORS/sandbox limits on audio capture degrade gracefully */
    }
    return () => {
      if (timer !== null) clearInterval(timer);
      void ctx?.close().catch(() => {});
    };
  }, [playing, aiAutoClip, getAudioStream]);

  return { audible, setTileAudible, applyTileAudio };
}

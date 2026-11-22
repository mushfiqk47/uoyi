import { getBlob } from "../lib/db";

const BUCKETS = 160;
const MAX_DECODE_BYTES = 80 * 1024 * 1024;
const peakCache = new Map<string, Promise<Float32Array | null>>();

/** Reduces raw PCM channel samples into normalized 0..1 peak buckets. */
export function computeWaveformPeaks(samples: ArrayLike<number>, buckets = BUCKETS): Float32Array {
  const count = Math.max(1, Math.min(buckets, samples.length || 1));
  const out = new Float32Array(count);
  if (!samples.length) return out;
  const stride = samples.length / count;
  let globalMax = 0;
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * stride);
    const end = Math.max(start + 1, Math.floor((i + 1) * stride));
    const step = Math.max(1, Math.floor((end - start) / 64));
    let peak = 0;
    for (let j = start; j < end; j += step) {
      const a = Math.abs(samples[j]);
      if (a > peak) peak = a;
    }
    out[i] = peak;
    if (peak > globalMax) globalMax = peak;
  }
  if (globalMax > 0.001) {
    for (let i = 0; i < count; i++) out[i] = Math.min(1, out[i] / globalMax);
  }
  return out;
}

/** Extracts and caches normalized amplitude peaks for an IndexedDB media blob. */
export function loadWaveformPeaks(blobKey: string | undefined): Promise<Float32Array | null> {
  if (!blobKey || typeof AudioContext === "undefined") return Promise.resolve(null);
  const existing = peakCache.get(blobKey);
  if (existing) return existing;

  const task = (async () => {
    let ctx: AudioContext | null = null;
    try {
      const blob = await getBlob(blobKey);
      if (!blob || !blob.size || blob.size > MAX_DECODE_BYTES) return null;
      const buf = await blob.arrayBuffer();
      ctx = new AudioContext();
      const audio = await ctx.decodeAudioData(buf);
      if (!audio.length || audio.numberOfChannels < 1) return null;
      return computeWaveformPeaks(audio.getChannelData(0), BUCKETS);
    } catch {
      return null;
    } finally {
      await ctx?.close().catch(() => {});
    }
  })();

  peakCache.set(blobKey, task);
  return task;
}

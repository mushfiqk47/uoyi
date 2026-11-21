/**
 * Records a short audio-only WebM chunk from a playing video element for live AI analysis.
 * Pass the rolling recorder's stream when there is one: calling `captureStream()` a second time
 * runs a second encoder over the same frames.
 */
export async function recordAudioChunk(video: HTMLVideoElement, seconds: number, existing?: MediaStream | null): Promise<Blob | null> {
  if (typeof MediaRecorder === "undefined") return null;
  let audio = existing?.getAudioTracks() ?? [];
  if (!audio.length) {
    const withCapture = video as HTMLVideoElement & { captureStream?: () => MediaStream };
    if (!withCapture.captureStream) return null;
    try {
      audio = withCapture.captureStream().getAudioTracks();
    } catch {
      return null;
    }
  }
  if (!audio.length) return null;
  // Cloned track list: stopping this recorder must not stop the rolling buffer's track.
  const rec = new MediaRecorder(new MediaStream(audio), {
    mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm",
  });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<Blob | null>((resolve) => {
    rec.onstop = () => resolve(chunks.length ? new Blob(chunks, { type: rec.mimeType }) : null);
  });
  rec.start(500);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  if (rec.state !== "inactive") rec.stop();
  return done;
}

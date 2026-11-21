/** Grabs a frame from a rendered video for the Queue card's poster. Never throws. */
export async function makeVideoThumb(blob: Blob): Promise<Blob | null> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  try {
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("thumbnail timeout")), 10000);
      video.onloadeddata = () => { window.clearTimeout(timer); resolve(); };
      video.onerror = () => { window.clearTimeout(timer); reject(new Error("thumbnail decode failed")); };
    });
    if (!video.videoWidth) return null;
    const target = Number.isFinite(video.duration) && video.duration > 1.2 ? Math.min(1, video.duration / 3) : 0;
    if (target > 0) {
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 1500);
        video.onseeked = () => { window.clearTimeout(timer); resolve(); };
        video.currentTime = target;
      });
    }
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = Math.max(1, Math.round(320 * video.videoHeight / video.videoWidth));
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

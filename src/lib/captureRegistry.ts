const captures = new Map<string, MediaStream>();

export function registerCaptureStream(stream: MediaStream): string {
  const id = `cap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  captures.set(id, stream);
  return `capture://${id}`;
}

export function getCaptureStream(url: string): MediaStream | null {
  if (!url.startsWith("capture://")) return null;
  return captures.get(url.slice("capture://".length)) ?? null;
}

export function releaseCaptureStream(url: string): void {
  if (!url.startsWith("capture://")) return;
  const id = url.slice("capture://".length);
  const stream = captures.get(id);
  if (stream) {
    stream.getTracks().forEach((t) => {
      try { t.stop(); } catch { /* already stopped */ }
    });
    captures.delete(id);
  }
}

import { useEffect, useState } from "react";
import { Film } from "lucide-react";
import type { Clip } from "../lib/types";
import { thumbUrl } from "../lib/thumbs";

/** Resolves a clip's thumbnail from IndexedDB, falling back to a legacy inline data URL. */
export function ClipThumb({ clip }: { clip: Clip }) {
  const [src, setSrc] = useState<string | null>(clip.thumb?.startsWith("data:") ? clip.thumb : null);

  useEffect(() => {
    if (!clip.thumbKey) {
      setSrc(clip.thumb?.startsWith("data:") ? clip.thumb : null);
      return;
    }
    let alive = true;
    void thumbUrl(clip.thumbKey).then((url) => {
      if (alive) setSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [clip.thumb, clip.thumbKey]);

  return src ? <img src={src} alt="" /> : <Film className="ic" />;
}

import { useEffect, useMemo, useRef, useState } from "react";
import type { Clip } from "../lib/types";
import { acquireBlobUrl } from "../lib/db";
import { fmtWhen } from "../lib/util";
import { captionPages, FONT_FAMILY } from "../lib/compositor";
import { postCopyText } from "../lib/project";
import { Modal } from "./ui";
import { useStore } from "../store";
import { Clapperboard, Copy, Flame, Sparkles } from "lucide-react";

/** Video preview with word-highlight caption overlay plus full AI viral breakdown when present. */
export function ClipPreviewModal({ clip, onClose }: { clip: Clip; onClose: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const { settings, openClip, toast } = useStore();
  const [url, setUrl] = useState<string | null>(null);
  const [active, setActive] = useState<{ page: number; word: number } | null>(null);

  useEffect(() => {
    let alive = true;
    let release = () => {};
    void acquireBlobUrl(clip.blobKey).then((entry) => {
      if (!entry) return;
      if (!alive) entry.release();
      else {
        release = entry.release;
        setUrl(entry.url);
      }
    });
    return () => {
      alive = false;
      release();
    };
  }, [clip.blobKey]);

  const pages = useMemo(() => (clip.captions?.length ? captionPages(clip.captions, 3) : []), [clip.captions]);
  useEffect(() => {
    if (!pages.length) {
      setActive(null);
      return;
    }
    let raf = 0;
    let last = "";
    const loop = () => {
      const v = ref.current;
      if (v) {
        const t = v.currentTime;
        let pageIndex = -1;
        let wordIndex = -1;
        for (let pi = 0; pi < pages.length; pi++) {
          const pg = pages[pi];
          if (t < pg[0].start || t > pg[pg.length - 1].end + 0.05) continue;
          pageIndex = pi;
          wordIndex = pg.findIndex((w) => t >= w.start && t < w.end);
          break;
        }
        const key = pageIndex >= 0 ? `${pageIndex}:${wordIndex}` : "";
        if (key !== last) {
          last = key;
          setActive(pageIndex >= 0 ? { page: pageIndex, word: wordIndex } : null);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [pages]);

  const page = active ? pages[active.page] : undefined;
  const highlight = settings.accent === "#fafafa" ? "#facc15" : settings.accent;
  const v = clip.viral;

  const copyPostCopy = async () => {
    const text = postCopyText(clip);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast("Caption & hashtags copied", "success");
    } catch {
      toast("Could not copy to clipboard", "error");
    }
  };

  return (
    <Modal
      title={clip.streamTitle}
      description={fmtWhen(clip.capturedAt)}
      onClose={onClose}
      width={780}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Close</button>
          {v && (
            <button
              className="btn accent"
              onClick={() => {
                onClose();
                openClip(clip, { applyViralHook: true });
              }}
            >
              <Sparkles className="ic" /> Open in Editor + Apply 3s Hook
            </button>
          )}
          {!v && (
            <button
              className="btn accent"
              onClick={() => {
                onClose();
                openClip(clip);
              }}
            >
              <Clapperboard className="ic" /> Open in Editor
            </button>
          )}
        </>
      }
    >
      {url ? (
        <div className="clip-preview-frame">
          <video
            ref={ref}
            className="clip-player"
            src={url}
            controls
            autoPlay
            onLoadedMetadata={(e) => {
              e.currentTarget.currentTime = clip.in;
            }}
          />
          {page && (
            <div
              className="clip-captions"
              aria-hidden="true"
              style={{
                fontFamily: FONT_FAMILY[settings.defaultCaptionFont],
                fontWeight: settings.defaultCaptionFont === "bebas" ? 400 : settings.defaultCaptionFont === "tiktok" ? 600 : 800,
              }}
            >
              {page.map((w, i) => {
                const on = active?.word === i;
                return (
                  <span key={w.id} className={on ? "on" : undefined} style={on ? { color: highlight } : undefined}>
                    {w.text.toUpperCase()}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <p className="muted">This clip's video is missing.</p>
      )}

      {v && (
        <div className="card viral-card">
          <div className="viral-card-head">
            <div className="row">
              <Flame className="ic viral-flame" />
              <b>Viral Breakdown</b>
              {clip.aiScore !== undefined && (
                <span className="chip accent">
                  Score {clip.aiScore}/10 {clip.aiScore >= 9 ? "· Viral Lock" : clip.aiScore >= 7 ? "· High Viral" : ""}
                </span>
              )}
            </div>
            <div className="viral-platforms">
              {v.platforms.map((p) => (
                <span key={p} className="chip">{p}</span>
              ))}
            </div>
          </div>

          {v.breakdown && (
            <div className="viral-card-scores">
              <span className="muted">Hook <b>{v.breakdown.hook}/10</b></span>
              <span className="muted">Pacing <b>{v.breakdown.pacing}/10</b></span>
              <span className="muted">Emotion <b>{v.breakdown.emotion}/10</b></span>
              <span className="muted">Shareability <b>{v.breakdown.shareability}/10</b></span>
            </div>
          )}

          {v.hook && (
            <div className="viral-card-line">
              <span className="muted">3s On-Screen Hook: </span>
              <b className="viral-hook-text">{v.hook}</b>
            </div>
          )}

          {v.whyViral && (
            <div className="viral-card-line">
              <span className="muted">Why it goes viral: </span>
              <span>{v.whyViral}</span>
            </div>
          )}

          {v.editingTips && (
            <div className="viral-card-line">
              <span className="muted">Edit blueprint: </span>
              <span>{v.editingTips}</span>
            </div>
          )}

          {(v.caption || v.hashtags.length > 0) && (
            <div className="viral-card-copy">
              <div>
                <span className="muted">Post copy: </span>
                <span>{v.caption} {v.hashtags.join(" ")}</span>
              </div>
              <button className="btn ghost sm" onClick={() => void copyPostCopy()}>
                <Copy className="ic" /> Copy
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

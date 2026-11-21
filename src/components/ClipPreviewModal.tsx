import { useEffect, useMemo, useRef, useState } from "react";
import type { Clip } from "../lib/types";
import { blobUrl } from "../lib/db";
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
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<{ page: number; word: number } | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    blobUrl(clip.blobKey)
      .then((u) => {
        if (!alive) return;
        setUrl(u);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setUrl(null);
        setLoading(false);
      });
    return () => { alive = false; };
  }, [clip.blobKey]);

  const pages = useMemo(() => (clip.captions?.length ? captionPages(clip.captions, 3) : []), [clip.captions]);
  useEffect(() => {
    if (!pages.length || !url) {
      setActive(null);
      return;
    }
    const video = ref.current;
    if (!video) return;
    let raf = 0;
    let last = "";

    const syncAtCurrentTime = () => {
      const t = video.currentTime;
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
    };

    // Only run the 60 fps RAF loop while video is actively playing to avoid idle CPU/battery drain.
    const loop = () => {
      syncAtCurrentTime();
      if (!video.paused && !video.ended) raf = requestAnimationFrame(loop);
      else raf = 0;
    };
    const startLoop = () => {
      if (!raf) raf = requestAnimationFrame(loop);
    };
    const stopLoop = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      syncAtCurrentTime();
    };

    video.addEventListener("play", startLoop);
    video.addEventListener("pause", stopLoop);
    video.addEventListener("ended", stopLoop);
    video.addEventListener("seeked", syncAtCurrentTime);
    if (!video.paused) startLoop();
    else syncAtCurrentTime();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      video.removeEventListener("play", startLoop);
      video.removeEventListener("pause", stopLoop);
      video.removeEventListener("ended", stopLoop);
      video.removeEventListener("seeked", syncAtCurrentTime);
    };
  }, [pages, url]);

  const page = active ? pages[active.page] : undefined;
  const highlight = settings.accent === "#fafafa" ? "#facc15" : settings.accent;
  const v = clip.viral;
  const postText = useMemo(() => postCopyText(clip), [clip]);

  const copyPostCopy = async () => {
    if (!postText) return;
    try {
      await navigator.clipboard.writeText(postText);
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
      {loading ? (
        <p className="muted" role="status" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="spinner" /> Loading clip preview…
        </p>
      ) : url ? (
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
        <div className="card" style={{ padding: 14, marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <Flame className="ic" style={{ color: "var(--brand)" }} />
              <b>Viral Breakdown</b>
              {clip.aiScore !== undefined && (
                <span className="chip accent">
                  Score {clip.aiScore}/10 {clip.aiScore >= 9 ? "· Viral Lock" : clip.aiScore >= 7 ? "· High Viral" : ""}
                </span>
              )}
            </div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {v.platforms.map((p) => (
                <span key={p} className="chip">{p}</span>
              ))}
            </div>
          </div>

          {v.breakdown && (
            <div className="row" style={{ gap: 12, flexWrap: "wrap", fontSize: 12 }}>
              <span className="muted">Hook <b style={{ color: "var(--fg)" }}>{v.breakdown.hook}/10</b></span>
              <span className="muted">Pacing <b style={{ color: "var(--fg)" }}>{v.breakdown.pacing}/10</b></span>
              <span className="muted">Emotion <b style={{ color: "var(--fg)" }}>{v.breakdown.emotion}/10</b></span>
              <span className="muted">Shareability <b style={{ color: "var(--fg)" }}>{v.breakdown.shareability}/10</b></span>
            </div>
          )}

          {v.hook && (
            <div style={{ fontSize: 12.5 }}>
              <span className="muted">3s On-Screen Hook: </span>
              <b style={{ color: "var(--brand)" }}>{v.hook}</b>
            </div>
          )}

          {v.whyViral && (
            <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              <span className="muted">Why it goes viral: </span>
              <span>{v.whyViral}</span>
            </div>
          )}

          {v.editingTips && (
            <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              <span className="muted">Edit blueprint: </span>
              <span>{v.editingTips}</span>
            </div>
          )}

          {(v.caption || v.hashtags.length > 0) && (
            <div className="row" style={{ gap: 8, alignItems: "flex-start", justifyContent: "space-between", paddingTop: 4, borderTop: "1px solid var(--hairline)" }}>
              <div style={{ fontSize: 12, lineHeight: 1.5 }}>
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

import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, Copy, Download, Link2, RotateCcw, Scissors, Search, Sparkles, Star, Trash2, Upload, X } from "lucide-react";
import { useLibrary, useShellStore, useStore, useToastStore } from "../store";
import type { Clip } from "../lib/types";
import { getBlob } from "../lib/db";
import { ClipThumb } from "../components/ClipThumb";
import { downloadBlob, fmtTime, fmtWhen, safeFileName } from "../lib/util";
import { postCopyText } from "../lib/project";
import { Field, Modal, Seg, Switch } from "../components/ui";
import { ClipPreviewModal } from "../components/ClipPreviewModal";
import { suggestTitle } from "../lib/ai/openai";
import { findClipsInMedia } from "../lib/ai/findClips";
import { generateCaptionsForBlob } from "../lib/ai/captions";
import { prepareMedia, uploadMediaFile } from "../platform/api/media";
import { ClipFinderFields, DEFAULT_CLIP_FINDER, clipFinderError, clipFinderOptions, type ClipFinderValues } from "../features/ai-clips/ClipFinderFields";

type Filter = "all" | "favourites" | "removed";

export function Clips() {
  const { go } = useShellStore();
  const { toast } = useToastStore();
  const { clips, deleteClips } = useLibrary();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  // Defer filtering so rapid typing stays 60 fps even with large clip libraries.
  const deferredQ = useDeferredValue(q);
  const [confirmAll, setConfirmAll] = useState(false);

  // Compute library slice and removed count in a single memoized pass.
  const { library, removed } = useMemo(() => {
    const items: Clip[] = [];
    let removedCount = 0;
    for (const c of clips) {
      if (c.recording) continue;
      items.push(c);
      if (c.removedAt) removedCount += 1;
    }
    return { library: items, removed: removedCount };
  }, [clips]);

  const shown = useMemo(() => {
    const needle = deferredQ.trim().toLowerCase();
    return library.filter((c) => {
      if (filter === "removed" ? !c.removedAt : c.removedAt) return false;
      if (filter === "favourites" && !c.favourite) return false;
      if (needle && !`${c.streamTitle} ${c.note}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [library, filter, deferredQ]);

  return (
    <main className="page clips">
      <div className="pagehead">
        <div>
          <h1>Clips</h1>
          <p>Clips from the Viewer and the AI Clip Finder. Continuous recordings are in the Records gallery.</p>
        </div>
        <div className="row">
          <label className="search">
            <Search className="ic" aria-hidden="true" />
            <input
              className="input"
              placeholder="Search titles and notes"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search clips"
            />
            {q && (
              <button
                type="button"
                className="search-clear"
                onClick={() => setQ("")}
                aria-label="Clear search"
                title="Clear search"
              >
                <X className="ic" />
              </button>
            )}
          </label>
          <Seg<Filter>
            label="Show"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "favourites", label: "Favourites" },
              { value: "removed", label: `Removed${removed ? ` · ${removed}` : ""}` },
            ]}
          />
          {filter === "removed" && removed > 0 && (
            <button className="btn danger sm" onClick={() => setConfirmAll(true)}>
              <Trash2 className="ic" /> Delete all
            </button>
          )}
        </div>
      </div>

      <ClipFinder />

      {shown.length === 0 ? (
        <div className="empty card-empty">
          <div className="badge">
            <Scissors className="ic" />
          </div>
          {clips.length === 0 ? (
            <>
              <h2>No clips yet</h2>
              <p>Watch a stream in the Viewer and press Clip when something happens. The last few seconds land here.</p>
              <button className="btn accent" onClick={() => go("viewer")}>
                Go to the Viewer
              </button>
            </>
          ) : (
            <>
              <h2>Nothing here</h2>
              <p>{filter === "removed" ? "Removed clips show up here so you can restore them." : "No clips match. Try another search or filter."}</p>
            </>
          )}
        </div>
      ) : (
        <div className="clip-grid">
          {shown.map((c) => (
            <ClipCard key={c.id} clip={c} />
          ))}
        </div>
      )}

      {confirmAll && (
        <Modal
          title={`Delete all ${removed} removed clips?`}
          description="Their videos and thumbnails are erased from this device. Renders already in the Queue keep working. This can't be undone."
          onClose={() => setConfirmAll(false)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setConfirmAll(false)}>Cancel</button>
              <button
                className="btn danger"
                onClick={() => {
                  void (async () => {
                    const all = library.filter((c) => c.removedAt);
                    await deleteClips(all.map((c) => c.id));
                    toast(`Deleted ${all.length} removed clip${all.length === 1 ? "" : "s"}`, "success");
                    setConfirmAll(false);
                  })();
                }}
              >
                <Trash2 className="ic" /> Delete all
              </button>
            </>
          }
        />
      )}
    </main>
  );
}

function ClipFinder() {
  const { settings } = useShellStore();
  const { toast } = useToastStore();
  const { addClip, autoCaptionClip } = useLibrary();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<"url" | "file">("file");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [ytDlpOk, setYtDlpOk] = useState<boolean | null>(null);
  // Auto by default: the AI picks the count and the lengths, and only moments scoring 7 or
  // higher are saved, so one press gives ready-to-edit clips.
  const [finder, setFinder] = useState<ClipFinderValues>(DEFAULT_CLIP_FINDER);
  const [auto916, setAuto916] = useState(false);
  const [autoCaption, setAutoCaption] = useState(settings.autoCaptionOnClip);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setAutoCaption(settings.autoCaptionOnClip);
    const ac = new AbortController();
    fetch("/api/health", { signal: ac.signal })
      .then((r) => r.json())
      .then((h) => {
        const hasYt = !!h?.ytDlp;
        setYtDlpOk(hasYt);
        if (hasYt) setSource("url");
      })
      .catch((err) => {
        if ((err as Error)?.name !== "AbortError") setYtDlpOk(false);
      });
    return () => ac.abort();
  }, [open, settings.autoCaptionOnClip]);

  const run = async () => {
    if (source === "url" ? !url.trim() : !file) return toast(source === "url" ? "Paste a YouTube link first." : "Choose a local video/audio file first.", "error");
    // "Auto" hands that choice to the AI; the other values stay under your control.
    const invalid = clipFinderError(finder);
    if (invalid) return toast(invalid, "error");
    const opts = clipFinderOptions(finder, settings.aiClipThreshold);
    setBusy(true);
    try {
      let media: { id: string; title: string };
      if (file) {
        setStatus("Uploading file…");
        const j = await uploadMediaFile(file);
        media = { id: j.id, title: j.title || file.name };
      } else {
        setStatus("Preparing video with audio (yt-dlp)…");
        const j = await prepareMedia(url.trim());
        media = { id: j.id, title: url.trim() };
      }

      const saved = await findClipsInMedia({
        media, settings,
        options: { ...opts, vertical: auto916 },
        onStatus: setStatus,
        addClip,
        autoCaptionClip: autoCaption ? autoCaptionClip : undefined,
      });
      setUrl("");
      setFile(null);
      setOpen(false);
      toast(`AI Clip Finder saved ${saved} clip${saved === 1 ? "" : "s"} to Clips`, "success");
    } catch (e) {
      toast((e as Error).message || "Clip finder failed.", "error");
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  return (
    <>
      <section className="card clip-finder">
        <div className="clip-finder-head">
          <div>
            <h2>AI Clip Finder</h2>
            <p>YouTube link or local file in: GPU-transcribed, edit-ready clips, saved here.</p>
          </div>
          <button className="btn accent" onClick={() => setOpen(true)}>
            <Sparkles className="ic" /> Create AI clips
          </button>
        </div>
      </section>

      {open && (
        <Modal
          title="Create AI clips"
          description="Choose a source and set how the AI picks moments. Nothing is uploaded — everything runs on this machine."
          onClose={() => { if (!busy) setOpen(false); }}
          width={620}
          footer={
            <>
              <button className="btn ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
              <button className="btn accent" onClick={() => void run()} disabled={busy}>
                {busy ? <span className="spinner" /> : <Sparkles className="ic" />}
                {busy ? "Finding clips…" : "Find & save clips"}
              </button>
            </>
          }
        >
          <Field label="Source">
            <Seg<"url" | "file">
              label="Source type"
              full
              value={source}
              onChange={setSource}
              options={[
                { value: "file", label: <><Upload className="ic" /> Upload video / audio</> },
                { value: "url", label: <><Link2 className="ic" /> {ytDlpOk ? "YouTube / Media link" : "Direct video link"}</> },
              ]}
            />
          </Field>

          {source === "url" ? (
            <Field
              label="Video link"
              hint={
                ytDlpOk === false
                  ? "Paste a direct .mp4, .webm, or .mov URL. For YouTube/Twitch/Kick tabs, use Capture tab in the Viewer or upload the downloaded video file."
                  : "Paste a YouTube or direct .mp4/.webm video link. Clipweave downloads and prepares it locally."
              }
            >
              <input className="input" placeholder="https://example.com/gta6-trailer.mp4" value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy} />
            </Field>
          ) : (
            <Field label="Video or audio file" hint="Upload any GTA 6 gameplay, trailer, or stream VOD (MP4, WebM, MOV, MPG/MPEG, audio).">
              <div className="file-field">
                <input ref={fileRef} type="file" accept="video/*,audio/*,.mpg,.mpeg,video/mpeg" className="visually-hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} disabled={busy} aria-label="Choose a local video or audio file" />
                <button type="button" className="btn ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
                  <Upload className="ic" />
                  {file ? "Change file" : "Choose file"}
                </button>
                <span className="file-name">{file ? file.name : "No file chosen"}</span>
              </div>
            </Field>
          )}

          <ClipFinderFields value={finder} onChange={setFinder} disabled={busy} scoreAuto />

          <div className="field-row">
            <Field label="Auto 9:16" hint="Fit the full video inside a vertical 9:16 frame (1080×1920) with a blurred background, like the editor’s Fit view—nothing gets cropped out.">
              <label className="switch-line">
                <Switch label="Auto 9:16" checked={auto916} onChange={setAuto916} />
                <span>Save clips as 9:16 (fit, no crop)</span>
              </label>
            </Field>

            <Field label="Auto captions" hint="Generate word-by-word captions for every saved clip so they’re ready to burn into a Short when you render.">
              <label className="switch-line">
                <Switch label="Auto captions" checked={autoCaption} onChange={setAutoCaption} />
                <span>Caption each saved clip</span>
              </label>
            </Field>
          </div>

          {status && <p className="clip-finder-status" role="status" aria-live="polite">{status}</p>}
        </Modal>
      )}
    </>
  );
}

// Memoized so searching or editing one card's note doesn't re-render every card in the grid.
const ClipCard = memo(function ClipCard({ clip }: { clip: Clip }) {
  const { settings, openClip, toast } = useStore();
  const { updateClip, deleteClip } = useLibrary();
  const [note, setNote] = useState(clip.note);
  const [preview, setPreview] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [titling, setTitling] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const postText = useMemo(() => postCopyText(clip), [clip]);
  useEffect(() => setNote(clip.note), [clip.note]);

  const copyPostText = async () => {
    try {
      await navigator.clipboard.writeText(postText);
      toast("Caption & hashtags copied", "success");
    } catch {
      toast("Could not copy to clipboard", "error");
    }
  };

  const aiTitle = async () => {
    setTitling(true);
    try {
      let words = clip.captions;
      if (!words?.length) {
        // No stored transcript — transcribe the clip on the spot first.
        const b = await getBlob(clip.blobKey);
        if (!b) throw new Error("This clip's video is missing.");
        const out = await generateCaptionsForBlob(b, settings, { format: "json" });
        if (out.words.length) {
          updateClip(clip.id, { captions: out.words });
          words = out.words;
        }
      }
      if (!words?.length) throw new Error("No speech heard in this clip, nothing to title.");
      const title = await suggestTitle(settings, { transcript: words.map((w) => w.text).join(" ") });
      if (!title) throw new Error("The AI returned no title.");
      updateClip(clip.id, { streamTitle: title });
      toast(`Renamed to “${title}”`, "success");
    } catch (e) {
      toast((e as Error).message || "Title generation failed.", "error");
    } finally {
      setTitling(false);
    }
  };

  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const b = await getBlob(clip.blobKey);
      if (!b) return toast("This clip's video is missing.", "error");
      downloadBlob(b, `${safeFileName(clip.streamTitle)} raw.${b.type.includes("mp4") ? "mp4" : "webm"}`);
    } finally {
      setDownloading(false);
    }
  };

  const isNew = !clip.removedAt && !clip.edited && !clip.renderedAt;

  return (
    <article className="clip-card card">
      <button className="clip-thumb" onClick={() => setPreview(true)} aria-label={`Preview ${clip.streamTitle}`}>
        <ClipThumb clip={clip} />
        <span className="clip-len tabular">{fmtTime(clip.seconds)}</span>
      </button>
      <div className="clip-info">
        <div className="row">
          <b className="grow clip-title" title={clip.streamTitle}>
            {clip.streamTitle}
          </b>
          <button
            className="btn plain icon sm"
            aria-label="Generate a title with AI"
            title="Generate a title with AI from the transcript"
            onClick={() => void aiTitle()}
            disabled={titling}
          >
            {titling ? <span className="spinner" /> : <Sparkles className="ic" />}
          </button>
          <button
            className={`btn plain icon sm star${clip.favourite ? " on" : ""}`}
            aria-pressed={clip.favourite}
            aria-label={clip.favourite ? "Unfavourite" : "Favourite"}
            onClick={() => updateClip(clip.id, { favourite: !clip.favourite })}
          >
            <Star className="ic" />
          </button>
        </div>
        <div className="row clip-sub">
          <span className="muted">{fmtWhen(clip.capturedAt)}</span>
          {clip.aiScore !== undefined && (
            <span className="chip accent">
              AI {clip.aiScore}/10{clip.aiScore >= 9 ? " · Viral Lock" : ""}
            </span>
          )}
          {clip.aiGroupStreams && clip.aiGroupStreams.length > 1 && (
            <span className="chip accent" title={clip.aiGroupStreams.join(" · ")}>
              Moment in {clip.aiGroupStreams.length} streams
            </span>
          )}
          {isNew && <span className="chip accent">New</span>}
          {clip.edited && <span className="chip warning">Edited</span>}
          {clip.renderedAt && <span className="chip success">Rendered</span>}
          {clip.removedAt && <span className="chip danger">Removed</span>}
        </div>
        {clip.viral?.hook && (
          <button
            type="button"
            className="muted clip-hook"
            onClick={() => setPreview(true)}
            title={`3s Hook: ${clip.viral.hook} — click for full viral details`}
          >
            Hook: <b>{clip.viral.hook}</b>
          </button>
        )}
        <input
          className="input note"
          placeholder="Add a note"
          value={note}
          maxLength={200}
          aria-label="Note"
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== clip.note && updateClip(clip.id, { note })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <div className="row clip-actions">
          {clip.removedAt ? (
            <>
              <button className="btn ghost sm grow" onClick={() => updateClip(clip.id, { removedAt: null })}>
                <RotateCcw className="ic" /> Restore
              </button>
              <button className="btn danger sm" onClick={() => setConfirm(true)}>
                <Trash2 className="ic" /> Delete
              </button>
            </>
          ) : (
            <>
              <button
                className="btn accent icon sm"
                onClick={() => openClip(clip)}
                aria-label={`Edit ${clip.streamTitle}`}
                title="Open in editor"
              >
                <Clapperboard className="ic" />
              </button>
              {postText && (
                <button className="btn ghost icon sm" onClick={() => void copyPostText()} aria-label="Copy post text" title="Copy caption & hashtags">
                  <Copy className="ic" />
                </button>
              )}
              <button
                className="btn ghost icon sm"
                onClick={() => void download()}
                disabled={downloading}
                aria-label="Download the raw clip"
                title="Download the raw clip"
              >
                {downloading ? <span className="spinner" /> : <Download className="ic" />}
              </button>
              <button className="btn ghost icon sm" onClick={() => updateClip(clip.id, { removedAt: Date.now() })} aria-label="Remove" title="Remove">
                <X className="ic" />
              </button>
            </>
          )}
        </div>
      </div>
      {preview && <ClipPreviewModal clip={clip} onClose={() => setPreview(false)} />}
      {confirm && (
        <Modal
          title="Delete this clip for good?"
          description="Its video is erased from this device. Renders already in the Queue keep working."
          onClose={() => { if (!deleting) setConfirm(false); }}
          footer={
            <>
              <button className="btn ghost" onClick={() => setConfirm(false)} disabled={deleting}>
                Keep it
              </button>
              <button
                className="btn danger"
                disabled={deleting}
                onClick={() => {
                  void (async () => {
                    setDeleting(true);
                    try {
                      await deleteClip(clip.id);
                      setConfirm(false);
                    } finally {
                      setDeleting(false);
                    }
                  })();
                }}
              >
                {deleting ? <span className="spinner" /> : null}
                Delete
              </button>
            </>
          }
        />
      )}
    </article>
  );
});

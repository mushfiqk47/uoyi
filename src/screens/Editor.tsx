import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Captions, Clapperboard, Copy, FolderOpen, ImagePlus, LayoutTemplate, Redo2, Save, Scissors, Send, Smartphone, Trash2, Type, Undo2, Crop } from "lucide-react";
import { useLibrary, useStore } from "../store";
import type { Media, Project, TextItem } from "../lib/types";
import { usePlayer } from "../editor/player";
import { Preview } from "../editor/Preview";
import { Timeline, type Selection } from "../editor/Timeline";
import { CaptionsPanel, ClipPanel, FramePanel, MediaPanel, OverlayPanel, TemplatesPanel, TextPanel } from "../editor/panels";
import { applyFacecam, detectFacecam, isDefaultFacecamRect, waitForReadyVisual } from "../editor/facecam";
import { activeClipAt, DEFAULT_LAYOUT, fileNameFor, projectDuration, splitVideoClipAt, withoutVideoClip } from "../lib/project";
import { importFile, kindOf, probe } from "../lib/media";
import { getBlob, putBlob } from "../lib/db";
import { Field, Modal } from "../components/ui";
import { fmtTime, fmtWhen, uid } from "../lib/util";
import { ClipThumb } from "../components/ClipThumb";

type Tab = "frame" | "captions" | "text" | "overlay" | "media" | "templates";

const TABS: { id: Tab; label: string; Icon: typeof Crop }[] = [
  { id: "frame", label: "Frame", Icon: Crop },
  { id: "captions", label: "Captions", Icon: Captions },
  { id: "text", label: "Text", Icon: Type },
  { id: "overlay", label: "Overlay", Icon: Smartphone },
  { id: "media", label: "Media", Icon: ImagePlus },
  { id: "templates", label: "Templates", Icon: LayoutTemplate },
];

export function Editor() {
  const { project } = useStore();
  if (!project) return <EditorEmpty />;
  return <EditorWorkspace key={project.id} project={project} />;
}

function EditorEmpty() {
  const { openClip, go, startProject, toast, savedProjects, openSavedProject, duplicateSavedProject, deleteSavedProject } = useStore();
  const { clips } = useLibrary();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const recent = useMemo(() => clips.filter((c) => !c.removedAt).slice(0, 6), [clips]);

  const onFiles = async (files: FileList) => {
    setBusy(true);
    try {
      const media = [];
      for (const f of Array.from(files)) {
        try {
          media.push(await importFile(f));
        } catch (e) {
          toast((e as Error).message, "error");
        }
      }
      if (media.length) startProject(media[0].name, media);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page editor-empty">
      <div
        className="drop card"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
        }}
      >
        <div className="empty">
          <div className="badge">
            <Clapperboard className="ic" />
          </div>
          <h2>Nothing open in the Editor</h2>
          <p>Open one of your clips, or drop video, pictures and music here to start a 9:16 project from your own files.</p>
          <div className="row editor-empty-actions">
            <button className="btn accent" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? <span className="spinner" /> : <FolderOpen className="ic" />} Choose files
            </button>
            <button className="btn ghost" onClick={() => go("viewer")}>
              <Scissors className="ic" /> Clip a stream
            </button>
          </div>
          <input ref={fileRef} type="file" multiple accept="video/*,audio/*,image/*,.mpg,.mpeg,video/mpeg" hidden onChange={(e) => e.target.files && onFiles(e.target.files)} />
        </div>
      </div>
      {savedProjects.length > 0 && (
        <section className="recent saved-projects">
          <h3>Saved projects</h3>
          <div className="saved-project-grid">
            {savedProjects.map((p) => (
              <div key={p.id} className="saved-project card">
                <div className="grow">
                  <b title={p.name}>{p.name || "Untitled project"}</b>
                  <small className="muted">
                    {fmtWhen(p.updatedAt)} · {fmtTime(projectDuration(p))} · {p.media.length} file{p.media.length === 1 ? "" : "s"}
                  </small>
                </div>
                <div className="row">
                  <button className="btn accent sm" onClick={() => openSavedProject(p.id)}>
                    Open
                  </button>
                  <button
                    className="btn plain icon sm"
                    aria-label={`Duplicate ${p.name}`}
                    title="Duplicate project"
                    onClick={() => duplicateSavedProject(p.id)}
                  >
                    <Copy className="ic" />
                  </button>
                  <button
                    className="btn plain icon sm"
                    aria-label={`Delete ${p.name}`}
                    title="Delete project"
                    onClick={() => {
                      deleteSavedProject(p.id);
                      toast("Project deleted", "info");
                    }}
                  >
                    <Trash2 className="ic" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {recent.length > 0 && (
        <section className="recent">
          <h3>Recent clips</h3>
          <div className="recent-row">
            {recent.map((c) => (
              <button key={c.id} className="recent-clip card" onClick={() => openClip(c)}>
                <span className="clip-thumb">
                  <ClipThumb clip={c} />
                </span>
                <b>{c.streamTitle}</b>
                <small>
                  {fmtWhen(c.capturedAt)} · {fmtTime(c.seconds)}
                </small>
              </button>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function EditorWorkspace({ project }: { project: Project }) {
  const { editProject, undo, redo, canUndo, canRedo, settings, enqueue, toast, go, saveCurrentProject, closeProject } = useStore();
  const player = usePlayer(project);
  const [tab, setTab] = useState<Tab>("frame");
  const [selection, setSelection] = useState<Selection>(null);
  const [frame, setFrame] = useState<"phone" | "plain">("phone");
  const [naming, setNaming] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [missingMedia, setMissingMedia] = useState<Media[]>([]);
  const [relinkTarget, setRelinkTarget] = useState<Media | null>(null);
  const relinkRef = useRef<HTMLInputElement>(null);
  const duration = useMemo(() => projectDuration(project), [project]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const missing: Media[] = [];
      for (const m of project.media) {
        if (!m.blobKey) continue;
        const blob = await getBlob(m.blobKey).catch(() => undefined);
        if (!blob) missing.push(m);
      }
      if (alive) setMissingMedia(missing);
    })();
    return () => { alive = false; };
  }, [project.media]);

  const handleRelinkFile = async (file: File) => {
    if (!relinkTarget) return;
    const kind = kindOf(file);
    if (!kind) {
      toast(`${file.name} isn't a supported media file.`, "error");
      return;
    }
    try {
      const meta = await probe(file, kind);
      const nextBlobKey = `media:${uid("relink")}`;
      await putBlob(nextBlobKey, file);
      editProject((p) => ({
        ...p,
        media: p.media.map((m) =>
          m.id === relinkTarget.id
            ? { ...m, blobKey: nextBlobKey, duration: meta.duration || m.duration, width: meta.width || m.width, height: meta.height || m.height }
            : m,
        ),
      }));
      toast(`Relinked “${relinkTarget.name}”`, "success");
    } catch (e) {
      toast((e as Error).message || "Could not relink media file.", "error");
    } finally {
      setRelinkTarget(null);
      if (relinkRef.current) relinkRef.current.value = "";
    }
  };

  const select = useCallback((s: Selection) => {
    setSelection(s);
    if (s?.kind === "text") setTab("text");
    if (s?.kind === "caption") setTab("captions");
  }, []);

  // Drop a selection whose item was deleted (undo, etc.).
  useEffect(() => {
    if (!selection) return;
    const list = { video: project.video, text: project.texts, caption: project.captions, music: project.music }[selection.kind];
    if (!list.some((x) => x.id === selection.id)) setSelection(null);
  }, [project, selection]);

  // Auto face detection in Facecam + game mode: on by default whenever split mode is active
  // and the facecam box is still at the uncustomized default placeholder. Runs once per
  // project + primary clip so manual drags, Undo, or saved custom templates are respected.
  const latest = useRef({ project, player, editProject, toast });
  latest.current = { project, player, editProject, toast };
  const autoFacecamAttempted = useRef(new Set<string>());
  const faceRef = useRef<string | null>(null);
  const autoFacecam = settings.autoFacecamOnOpen;
  const firstVideoMediaId = project.video[0]?.mediaId ?? "";
  useEffect(() => {
    if (!autoFacecam || project.layout.mode !== "split" || !firstVideoMediaId) return;
    if (!isDefaultFacecamRect(latest.current.project.layout.facecam, DEFAULT_LAYOUT.facecam)) return;
    const attemptKey = `${project.id}:${firstVideoMediaId}`;
    if (autoFacecamAttempted.current.has(attemptKey)) return;

    let stopped = false;
    (async () => {
      const found = await waitForReadyVisual(latest.current.project, player, 20000, () => stopped);
      if (!found || stopped) return;
      if (latest.current.project.layout.mode !== "split") return;
      if (!isDefaultFacecamRect(latest.current.project.layout.facecam, DEFAULT_LAYOUT.facecam)) return;
      autoFacecamAttempted.current.add(attemptKey);
      try {
        const res = await detectFacecam(latest.current.project, player, faceRef);
        if (stopped) return;
        if (latest.current.project.layout.mode !== "split") return;
        if (!isDefaultFacecamRect(latest.current.project.layout.facecam, DEFAULT_LAYOUT.facecam)) return;
        if (res.ok && res.rect) {
          applyFacecam((patch, key) => latest.current.editProject((p) => ({ ...p, layout: { ...p.layout, ...patch } }), key), res.rect);
          latest.current.toast("Facecam detected — game on top, face below", "success");
        }
      } catch {
        /* Detector unavailable or no face in frame; user can drag/resize the facecam box directly. */
      }
    })();
    return () => { stopped = true; };
  }, [project.id, project.layout.mode, firstVideoMediaId, player, autoFacecam]);

  const split = useCallback(() => {
    const t = player.clock.time;
    const a = activeClipAt(latest.current.project, t);
    if (!a) return;
    if (a.local - a.clip.in < 0.1 || a.clip.out - a.local < 0.1) {
      toast("Move the playhead inside a clip to split it.", "info");
      return;
    }
    let nextSel: string | null = null;
    editProject((p) => {
      const res = splitVideoClipAt(p, t);
      if (!res) return p;
      nextSel = res.selectedId;
      return res.project;
    });
    if (nextSel) setSelection({ kind: "video", id: nextSel });
  }, [player, editProject, toast]);

  const removeSelected = useCallback(() => {
    if (!selection) return;
    editProject((p) => {
      switch (selection.kind) {
        case "video":
          return withoutVideoClip(p, selection.id);
        case "text":
          return { ...p, texts: p.texts.filter((x) => x.id !== selection.id) };
        case "caption":
          return { ...p, captions: p.captions.filter((x) => x.id !== selection.id) };
        case "music":
          return { ...p, music: p.music.filter((x) => x.id !== selection.id) };
      }
    });
    setSelection(null);
  }, [selection, editProject]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable], .modal")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (e.key === " ") {
        e.preventDefault();
        player.toggle();
      } else if (e.key.toLowerCase() === "s" && !mod) {
        e.preventDefault();
        split();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeSelected();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (t.closest("[role=slider]")) return;
        e.preventDefault();
        const step = (e.shiftKey ? 5 : 1) / 30;
        player.seek(player.clock.time + (e.key === "ArrowLeft" ? -step : step));
      } else if (e.key === "Home") player.seek(0);
      else if (e.key === "End") player.seek(duration);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player, split, removeSelected, undo, redo, duration]);

  const queue = (name: string) => {
    saveCurrentProject();
    enqueue(name, fileNameFor(settings.fileNamePattern, name));
    setNaming(null);
    toast(`Added “${name}” to the Queue`, "success", { label: "Show", run: () => go("queue") });
  };

  const showClipPanel = selection?.kind === "video" || selection?.kind === "music";

  const addQuickText = useCallback(() => {
    if (duration <= 0) return;
    const start = Math.min(player.clock.time, Math.max(0, duration - 0.5));
    const item: TextItem = {
      id: uid("t"),
      text: "Wait for it…",
      start,
      end: Math.min(Math.max(duration, start + 0.5), start + 3),
      x: 0.5,
      y: 0.7,
      size: 72,
      color: "#ffffff",
      font: "tiktok",
      stroke: false,
      background: true,
      backgroundColor: "#000000",
    };
    editProject((p) => ({ ...p, texts: [...p.texts, item] }));
    select({ kind: "text", id: item.id });
  }, [duration, player, editProject, select]);

  return (
    <main className="editor">
      <div className="editor-head">
        <div className="editor-head-title">
          <input
            className="title-input"
            value={project.name}
            aria-label="Project name"
            maxLength={80}
            onChange={(e) => editProject((p) => ({ ...p, name: e.target.value }), "name")}
          />
          <span className="editor-duration tabular">{fmtTime(duration, true)}</span>
        </div>
        <span className="grow" />
        <div className="editor-head-actions">
          <button className="btn plain icon sm" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
            <Undo2 className="ic" />
          </button>
          <button className="btn plain icon sm" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
            <Redo2 className="ic" />
          </button>
          <span className="editor-head-sep" aria-hidden="true" />
          <button
            className="btn ghost sm"
            onClick={() => {
              if (saveCurrentProject()) toast("Project saved to library & workspace", "success");
            }}
          >
            <Save className="ic" /> Save
          </button>
          <button className="btn ghost sm" onClick={() => setClosing(true)}>
            Close
          </button>
          <button
            className="btn accent sm"
            disabled={duration <= 0}
            onClick={() => (settings.nameBeforeRender ? setNaming(project.name) : queue(project.name || "Untitled"))}
          >
            <Send className="ic" /> Render
          </button>
        </div>
      </div>

      {missingMedia.length > 0 && (
        <div className="missing-media-banner" role="alert">
          <div className="row grow">
            <AlertTriangle className="ic" />
            <span>
              Missing media file{missingMedia.length === 1 ? "" : "s"} in local storage:{" "}
              <b>{missingMedia.map((m) => m.name).join(", ")}</b>
            </span>
          </div>
          <div className="row">
            {missingMedia.map((m) => (
              <button
                key={m.id}
                type="button"
                className="btn ghost sm"
                onClick={() => {
                  setRelinkTarget(m);
                  relinkRef.current?.click();
                }}
              >
                Relink {m.name}
              </button>
            ))}
          </div>
          <input
            ref={relinkRef}
            type="file"
            accept="video/*,audio/*,image/*,.mpg,.mpeg,video/mpeg"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleRelinkFile(f);
            }}
          />
        </div>
      )}

      <div className="editor-body">
        <div className="editor-left">
          <aside className="inspector" aria-label="Editor inspector">
            <div className="insp-tabs" role="tablist" aria-label="Editor tools">
              {TABS.map(({ id, label, Icon }) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                  <Icon className="ic" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div className="insp-main">
              <div className="insp-body" key={tab}>
                {showClipPanel && (
                  <div className="insp-selected">
                    <ClipPanel project={project} selection={selection} onSelect={select} player={player} />
                  </div>
                )}
                {tab === "frame" && <FramePanel project={project} player={player} />}
                {tab === "captions" && <CaptionsPanel project={project} player={player} selection={selection} onSelect={select} />}
                {tab === "text" && <TextPanel project={project} player={player} selection={selection} onSelect={select} />}
                {tab === "overlay" && <OverlayPanel project={project} />}
                {tab === "media" && <MediaPanel project={project} player={player} />}
                {tab === "templates" && <TemplatesPanel project={project} />}
              </div>
            </div>
          </aside>
          <Timeline
            project={project}
            player={player}
            selection={selection}
            onSelect={select}
            onSplit={split}
            onDelete={removeSelected}
            onAddText={addQuickText}
          />
        </div>
        <Preview player={player} phone={settings.phone} frame={frame} onFrame={setFrame} />
      </div>

      {naming !== null && (
        <Modal
          title="Name this render"
          description={`Saved as “${fileNameFor(settings.fileNamePattern, naming || "Untitled")}”.`}
          onClose={() => setNaming(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setNaming(null)}>Cancel</button>
              <button className="btn accent" disabled={!naming.trim()} onClick={() => queue(naming.trim())}>
                <Send className="ic" /> Add to Queue
              </button>
            </>
          }
        >
          <Field label="Name">
            <input className="input" autoFocus value={naming} maxLength={80} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => e.key === "Enter" && naming.trim() && queue(naming.trim())} />
          </Field>
        </Modal>
      )}
      {closing && (
        <Modal
          title="Close this project?"
          description="Save a copy to your Saved Projects library and workspace before closing, or discard unsaved changes."
          onClose={() => setClosing(false)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setClosing(false)}>Keep editing</button>
              <button className="btn danger" onClick={() => closeProject(false)}>Discard</button>
              <button
                className="btn accent"
                onClick={() => {
                  closeProject(true);
                  toast("Project saved", "success");
                }}
              >
                <Save className="ic" /> Save &amp; close
              </button>
            </>
          }
        />
      )}
    </main>
  );
}

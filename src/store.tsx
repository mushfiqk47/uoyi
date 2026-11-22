import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Clip, Media, Project, QueueJob, Stream, Template } from "./lib/types";
import { applyAppearance, loadSettings, saveSettings, type Settings } from "./lib/settings";
import { loadJson, saveJson, setJsonSaveErrorHandler, uid } from "./lib/util";
import { deleteBlob, deleteStaleRecordingChunks } from "./lib/db";
import { deleteThumb, migrateInlineThumbs } from "./lib/thumbs";
import { loadClips, saveClips } from "./platform/storage/clipRepository";
import { MIGRATIONS, STORAGE_KEYS } from "./platform/storage/keys";
import { once } from "./platform/storage/migrations";
import { cloneLook, hookTextItem, lookFromSettings, lookOf, newProject, postCopyText } from "./lib/project";
import { missingPremadeTemplates } from "./lib/templates";
import { generateCaptionsForBlob } from "./lib/ai/captions";
import { recordClipFeedback } from "./lib/ai/feedback";
import { useRenderQueue } from "./queue/useRenderQueue";

export type Screen = "viewer" | "recommend" | "clips" | "editor" | "queue" | "settings";

interface Toast {
  id: string;
  text: string;
  tone: "info" | "error" | "success";
  action?: { label: string; run: () => void };
}

const HISTORY_CAP = 120;

interface Store {
  settings: Settings;
  updateSettings(patch: Partial<Settings>): void;
  screen: Screen;
  go(s: Screen): void;

  streams: Stream[];
  addStream(stream: string | Omit<Stream, "id" | "openedAt">, title?: string): void;
  removeStream(id: string): void;
  updateStream(id: string, patch: Partial<Stream>): void;

  project: Project | null;
  setProject(p: Project | null): void;
  editProject(fn: (p: Project) => Project, coalesce?: string): void;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
  openClip(clip: Clip, opts?: { applyViralHook?: boolean }): void;
  startProject(name: string, media: Media[]): Project;

  templates: Template[];
  saveTemplate(name: string): void;
  updateTemplate(id: string, patch: Partial<Template>): void;
  overwriteTemplate(id: string): void;
  duplicateTemplate(id: string): void;
  deleteTemplate(id: string): void;
  applyTemplate(id: string): void;
  restorePremadeTemplates(): number;

  enqueue(title: string, fileName: string): void;

  toasts: Toast[];
  toast(text: string, tone?: Toast["tone"], action?: Toast["action"]): void;
  dismissToast(id: string): void;
}

export interface LibraryStore {
  clips: Clip[];
  addClip(c: Clip): void;
  updateClip(id: string, patch: Partial<Clip>): void;
  deleteClip(id: string): Promise<void>;
  deleteClips(ids: string[]): Promise<void>;
  autoCaptionClip(id: string, blob: Blob): Promise<void>;
}

type ShellStore = Pick<Store, "settings" | "updateSettings" | "screen" | "go">;
type ToastStore = Pick<Store, "toasts" | "toast" | "dismissToast">;

/** Split out so queue progress cannot invalidate every other subscriber. */
export interface QueueStore {
  jobs: QueueJob[];
  cancelJob(id: string): void;
  retryJob(id: string): void;
  moveJob(id: string, dir: -1 | 1): void;
  removeJob(id: string): Promise<void>;
  markDownloaded(id: string): void;
  queuePaused: boolean;
  setQueuePaused(v: boolean): void;
}
type ViewerStore = Pick<
  Store,
  | "settings"
  | "updateSettings"
  | "go"
  | "streams"
  | "addStream"
  | "removeStream"
  | "updateStream"
  | "openClip"
  | "toast"
> &
  Pick<LibraryStore, "addClip" | "updateClip" | "autoCaptionClip">;

const Ctx = createContext<Store | null>(null);
const ShellCtx = createContext<ShellStore | null>(null);
const ToastCtx = createContext<ToastStore | null>(null);
const LibraryCtx = createContext<LibraryStore | null>(null);
const ViewerCtx = createContext<ViewerStore | null>(null);
const QueueCtx = createContext<QueueStore | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}

export function useShellStore(): ShellStore {
  const s = useContext(ShellCtx);
  if (!s) throw new Error("useShellStore outside StoreProvider");
  return s;
}

export function useToastStore(): ToastStore {
  const s = useContext(ToastCtx);
  if (!s) throw new Error("useToastStore outside StoreProvider");
  return s;
}

export function useLibrary(): LibraryStore {
  const s = useContext(LibraryCtx);
  if (!s) throw new Error("useLibrary outside StoreProvider");
  return s;
}

export function useViewerStore(): ViewerStore {
  const s = useContext(ViewerCtx);
  if (!s) throw new Error("useViewerStore outside StoreProvider");
  return s;
}

export function useQueue(): QueueStore {
  const s = useContext(QueueCtx);
  if (!s) throw new Error("useQueue outside StoreProvider");
  return s;
}

function usePersisted<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [v, setV] = useState<T>(() => loadJson(key, initial));
  useEffect(() => {
    saveJson(key, v);
  }, [key, v]);
  return [v, setV];
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  // Theme variables only depend on the appearance fields, so typing an API URL no longer
  // repaints the document; saves are debounced instead of writing on every keystroke.
  useEffect(() => {
    applyAppearance(settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.theme, settings.accent, settings.background, settings.buttonStyle]);
  useEffect(() => {
    const t = window.setTimeout(() => saveSettings(settings), 250);
    const flush = () => saveSettings(settings);
    window.addEventListener("pagehide", flush);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pagehide", flush);
    };
  }, [settings]);
  const updateSettings = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), []);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const [screen, setScreen] = useState<Screen>(() => loadJson<Screen>(STORAGE_KEYS.screen, "viewer"));
  useEffect(() => {
    saveJson(STORAGE_KEYS.screen, screen);
  }, [screen]);
  const showQueue = useCallback(() => setScreen("queue"), []);

  // ---- toasts
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastTimers = useRef(new Map<string, number>());
  const dismissToast = useCallback((id: string) => {
    const timer = toastTimers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      toastTimers.current.delete(id);
    }
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);
  const toast = useCallback(
    (text: string, tone: Toast["tone"] = "info", action?: Toast["action"]) => {
      const id = uid("toast");
      setToasts((t) => [...t.slice(-2), { id, text, tone, action }]);
      const timer = window.setTimeout(() => dismissToast(id), action ? 7000 : 4200);
      toastTimers.current.set(id, timer);
    },
    [dismissToast],
  );
  useEffect(() => {
    const timers = toastTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  // A full quota used to be a console.warn while new clips quietly failed to persist.
  const storageWarned = useRef(false);
  useEffect(() => {
    setJsonSaveErrorHandler(() => {
      if (storageWarned.current) return;
      storageWarned.current = true;
      toast("This browser's storage is full, so recent changes may not be saved. Free space in Settings → Storage.", "error");
    });
    return () => setJsonSaveErrorHandler(null);
  }, [toast]);

  // ---- streams
  const [streams, setStreams] = usePersisted<Stream[]>(STORAGE_KEYS.streams, []);
  const addStream = useCallback(
    (input: string | Omit<Stream, "id" | "openedAt">, title?: string) => {
      const s: Omit<Stream, "id" | "openedAt"> =
        typeof input === "string" ? { url: input, title: title ?? input, sourceUrl: input } : input;
      setStreams((list) => {
        const max = Math.max(1, Math.min(4, Number(settingsRef.current.maxStreams) || 4));
        if (list.length >= max) return list;
        return [...list, { id: uid("s"), openedAt: Date.now(), ...s }].slice(-max);
      });
    },
    [setStreams],
  );
  const removeStream = useCallback((id: string) => setStreams((s) => s.filter((x) => x.id !== id)), [setStreams]);
  const updateStream = useCallback(
    (id: string, patch: Partial<Stream>) => setStreams((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x))),
    [setStreams],
  );

  // ---- clips
  // Clip metadata is saved through its repository. A 250 ms debounce keeps a burst of edits
  // (note typing, caption attach, finalize) from rewriting the whole array each time.
  const [clips, setClips] = useState<Clip[]>(loadClips);
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  useEffect(() => {
    const timer = window.setTimeout(() => saveClips(clips), 250);
    const flush = () => saveClips(clips);
    window.addEventListener("pagehide", flush);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pagehide", flush);
    };
  }, [clips]);

  // A tab closed mid-segment leaves its 4 s chunks behind. Nothing can still be writing them
  // from this origin after 24 hours, so sweep those at startup instead of growing storage.
  useEffect(() => {
    void deleteStaleRecordingChunks(24 * 60 * 60 * 1000).catch(() => {});
  }, []);

  // One-time move of inline base64 thumbnails into IndexedDB — they were the bulk of a clips
  // list that had to fit in localStorage's ~5 MB.
  useEffect(() => {
    const FLAG = MIGRATIONS.thumbs;
    if (localStorage.getItem(FLAG)) return;
    let alive = true;
    void (async () => {
      const moved = await migrateInlineThumbs(clips);
      if (!alive) return;
      if (moved.size) {
        setClips((cs) => cs.map((c) => (moved.has(c.id) ? { ...c, thumb: null, thumbKey: moved.get(c.id)! } : c)));
      }
      try { localStorage.setItem(FLAG, "1"); } catch { /* retried next load */ }
    })();
    return () => { alive = false; };
    // Runs once; `clips` is read synchronously from localStorage before the first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recordings are raw captures. Earlier builds auto-captioned them from the Clips setting;
  // drop those generated word timings once, without touching captions on uploaded/manual clips.
  useEffect(() => {
    once(MIGRATIONS.recordingCaptions, () => {
      if (clipsRef.current.some((c) => c.recording && c.captions?.length)) {
        setClips((cs) => cs.map((c) => (c.recording && c.captions?.length ? { ...c, captions: undefined } : c)));
      }
    });
    // Runs once from the synchronously loaded clips list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addClip = useCallback((c: Clip) => setClips((cs) => [c, ...cs]), [setClips]);
  const updateClip = useCallback(
    (id: string, patch: Partial<Clip>) => {
      const prev = clipsRef.current.find((c) => c.id === id);
      if (prev && (prev.aiScore !== undefined || prev.aiTitle)) {
        const title = prev.aiTitle || prev.streamTitle;
        if (!prev.favourite && patch.favourite) {
          recordClipFeedback({ action: "favourite", score: prev.aiScore ?? 7, title, reason: prev.note });
        }
        if (!prev.renderedAt && patch.renderedAt) {
          recordClipFeedback({ action: "render", score: prev.aiScore ?? 7, title, reason: prev.note });
        }
        if (!prev.removedAt && patch.removedAt && !prev.edited && !prev.favourite && !prev.renderedAt) {
          recordClipFeedback({ action: "dismiss", score: prev.aiScore ?? 7, title, reason: prev.note });
        }
      }
      setClips((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    },
    [setClips],
  );
  // One state update and one blob pass for a bulk delete, so "Delete all" stays O(n) instead
  // of searching the clip list and re-rendering once per clip.
  const deleteClips = useCallback(
    async (ids: string[]) => {
      const set = new Set(ids);
      const targets = clipsRef.current.filter((c) => set.has(c.id));
      for (const c of targets) {
        if ((c.aiScore !== undefined || c.aiTitle) && !c.removedAt && !c.edited && !c.favourite && !c.renderedAt) {
          recordClipFeedback({ action: "dismiss", score: c.aiScore ?? 7, title: c.aiTitle || c.streamTitle, reason: c.note });
        }
      }
      setClips((cs) => cs.filter((c) => !set.has(c.id)));
      await Promise.all(
        targets.map(async (c) => {
          await deleteBlob(c.blobKey).catch(() => {});
          await deleteThumb(c.id).catch(() => {});
        }),
      );
    },
    [setClips],
  );
  const deleteClip = useCallback((id: string) => deleteClips([id]), [deleteClips]);

  const autoCaptionClip = useCallback(
    async (id: string, blob: Blob) => {
      try {
        const out = await generateCaptionsForBlob(blob, settingsRef.current, { format: "json" });
        if (out.words.length) updateClip(id, { captions: out.words });
      } catch {
        /* captions are best-effort; the clip itself is already saved */
      }
    },
    [updateClip],
  );

  // ---- templates
  const [templates, setTemplates] = usePersisted<Template[]>(STORAGE_KEYS.templates, []);
  const templatesRef = useRef(templates);
  templatesRef.current = templates;
  useEffect(() => {
    once(MIGRATIONS.premadeTemplates, () => {
      const missing = missingPremadeTemplates(templatesRef.current);
      if (missing.length) setTemplates((ts) => [...ts, ...missing]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- project with undo/redo
  const [project, setProjectState] = useState<Project | null>(() => loadJson<Project | null>(STORAGE_KEYS.project, null));
  const [past, setPast] = useState<Project[]>([]);
  const [future, setFuture] = useState<Project[]>([]);
  const pastRef = useRef(past);
  pastRef.current = past;
  const futureRef = useRef(future);
  futureRef.current = future;
  const lastEdit = useRef<{ key: string; at: number } | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  useEffect(() => {
    const t = window.setTimeout(() => saveJson(STORAGE_KEYS.project, projectRef.current), 300);
    const flush = () => saveJson(STORAGE_KEYS.project, projectRef.current);
    window.addEventListener("pagehide", flush);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pagehide", flush);
    };
  }, [project]);

  const setProject = useCallback(
    (p: Project | null) => {
      // Update the ref here too: callers such as openClip save/read the project in the same tick,
      // before the next render would have refreshed it.
      projectRef.current = p;
      pastRef.current = [];
      futureRef.current = [];
      setProjectState(p);
      setPast([]);
      setFuture([]);
      lastEdit.current = null;
    },
    [setProjectState],
  );

  const editProject = useCallback(
    (fn: (p: Project) => Project, coalesce?: string) => {
      const cur = projectRef.current;
      if (!cur) return;
      const next = { ...fn(cur), updatedAt: Date.now() };
      const now = performance.now();
      const merge = coalesce && lastEdit.current?.key === coalesce && now - lastEdit.current.at < 800;
      lastEdit.current = coalesce ? { key: coalesce, at: now } : null;
      if (!merge) {
        const nextPast = [...pastRef.current, cur].slice(-HISTORY_CAP);
        pastRef.current = nextPast;
        setPast(nextPast);
      }
      futureRef.current = [];
      setFuture([]);
      projectRef.current = next;
      setProjectState(next);
      if (next.clipId) {
        const existing = clipsRef.current.find((c) => c.id === next.clipId);
        if (existing && !existing.edited) {
          if (existing.aiScore !== undefined || existing.aiTitle) {
            recordClipFeedback({ action: "edit", score: existing.aiScore ?? 7, title: existing.aiTitle || existing.streamTitle, reason: existing.note });
          }
          setClips((cs) => cs.map((c) => (c.id === next.clipId && !c.edited ? { ...c, edited: true } : c)));
        }
      }
    },
    [setProjectState, setClips],
  );

  const undo = useCallback(() => {
    const cur = projectRef.current;
    const history = pastRef.current;
    if (!cur || !history.length) return;
    const prev = history[history.length - 1];
    const nextPast = history.slice(0, -1);
    const nextFuture = [cur, ...futureRef.current].slice(0, HISTORY_CAP);
    // Sync refs immediately so same-tick actions (e.g. saveTemplate/editProject) see the undone project.
    pastRef.current = nextPast;
    futureRef.current = nextFuture;
    projectRef.current = prev;
    setPast(nextPast);
    setFuture(nextFuture);
    lastEdit.current = null;
    setProjectState(prev);
  }, [setProjectState]);

  const redo = useCallback(() => {
    const cur = projectRef.current;
    const stack = futureRef.current;
    if (!cur || !stack.length) return;
    const next = stack[0];
    const nextFuture = stack.slice(1);
    const nextPast = [...pastRef.current, cur].slice(-HISTORY_CAP);
    pastRef.current = nextPast;
    futureRef.current = nextFuture;
    projectRef.current = next;
    setFuture(nextFuture);
    setPast(nextPast);
    lastEdit.current = null;
    setProjectState(next);
  }, [setProjectState]);

  const startProject = useCallback(
    (name: string, media: Media[]) => {
      const p = newProject(name, lookFromSettings(settings, templates), media);
      // Video and audio are separate tracks. Video clips are muted and their sound is mirrored
      // into the Audio lane so it can be moved/edited independently.
      p.video = media
        .filter((m) => m.kind !== "audio")
        .map((m) => ({ id: uid("v"), mediaId: m.id, in: 0, out: m.kind === "image" ? 4 : m.duration, speed: 1, volume: 0 }));
      // `auto` marks sound the app mirrored from a video clip, so deleting that clip can
      // remove it without touching audio the user added deliberately.
      const mirrored: typeof p.music = media
        .filter((m) => m.kind === "video")
        .map((m) => ({ id: uid("a"), mediaId: m.id, start: 0, in: 0, out: m.duration, volume: 1, auto: true }));
      p.music = [
        ...mirrored,
        ...media
          .filter((m) => m.kind === "audio")
          .map((m) => ({ id: uid("a"), mediaId: m.id, start: 0, in: 0, out: m.duration, volume: 0.8 })),
      ];
      setProject(p);
      return p;
    },
    [settings, templates, setProject],
  );

  const openClip = useCallback(
    (clip: Clip, opts?: { applyViralHook?: boolean }) => {
      if (projectRef.current?.clipId === clip.id && !opts?.applyViralHook) {
        setScreen("editor");
        return;
      }
      const media: Media = {
        id: clip.mediaId,
        name: clip.streamTitle,
        kind: "video",
        duration: clip.duration,
        width: clip.width,
        height: clip.height,
        blobKey: clip.blobKey,
      };
      const p = newProject(clip.streamTitle, lookFromSettings(settings, templates), [media], clip.id);
      if (settings.autoFitOnOpen) p.layout = { ...p.layout, mode: "fit", zoom: 1, panX: 0, panY: 0 };
      p.video = [{ id: uid("v"), mediaId: media.id, in: clip.in, out: clip.duration, speed: 1, volume: 0 }];
      p.music = [{ id: uid("a"), mediaId: media.id, start: 0, in: clip.in, out: clip.duration, volume: 1, auto: true }];
      if (clip.captions?.length) p.captions = clip.captions.map((w) => ({ ...w, id: uid("w") }));
      if (clip.viral) {
        const social = postCopyText(clip);
        if (social) {
          p.overlay = { ...p.overlay, caption: social };
          // The post copy's caption line becomes the video title, so the editor header and
          // render filenames name the moment instead of the stream. Hashtags stay out of it.
          const title = social.split("\n")[0].replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
          if (title) p.name = title;
        }
        if (opts?.applyViralHook && clip.viral.hook) {
          p.texts = [
            ...p.texts,
            {
              id: uid("t"),
              text: clip.viral.hook.toUpperCase(),
              start: 0,
              end: Math.min(3.5, Math.max(1.5, clip.duration - clip.in)),
              x: 0.5,
              y: 0.18,
              size: 74,
              color: "#facc15",
              font: "bebas",
              stroke: true,
              background: true,
            },
          ];
        } else {
          const hook = hookTextItem(clip);
          if (hook) p.texts = [...p.texts, hook];
        }
      }
      setProject(p);
      setScreen("editor");
    },
    [settings, templates, setProject],
  );

  // ---- template actions
  const saveTemplate = useCallback(
    (name: string) => {
      const p = projectRef.current;
      if (!p) return;
      const t: Template = { id: uid("tpl"), name, favorite: false, updatedAt: Date.now(), ...cloneLook(lookOf(p)) };
      setTemplates((ts) => [t, ...ts]);
      editProject((x) => ({ ...x, templateId: t.id }));
    },
    [setTemplates, editProject],
  );
  const updateTemplate = useCallback(
    (id: string, patch: Partial<Template>) =>
      setTemplates((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t))),
    [setTemplates],
  );
  const overwriteTemplate = useCallback(
    (id: string) => {
      const p = projectRef.current;
      if (!p) return;
      setTemplates((ts) => ts.map((t) => (t.id === id ? { ...t, ...cloneLook(lookOf(p)), updatedAt: Date.now() } : t)));
    },
    [setTemplates],
  );
  const duplicateTemplate = useCallback(
    (id: string) =>
      setTemplates((ts) => {
        const t = ts.find((x) => x.id === id);
        if (!t) return ts;
        return [{ ...t, ...cloneLook(t), id: uid("tpl"), name: `${t.name} copy`, favorite: false, updatedAt: Date.now() }, ...ts];
      }),
    [setTemplates],
  );
  const deleteTemplate = useCallback(
    (id: string) => {
      setTemplates((ts) => ts.filter((t) => t.id !== id));
      setSettings((s) => (s.defaultTemplateId === id ? { ...s, defaultTemplateId: null } : s));
    },
    [setTemplates],
  );
  const applyTemplate = useCallback(
    (id: string) => {
      const t = templates.find((x) => x.id === id);
      if (!t) return;
      editProject((p) => ({ ...p, ...cloneLook(t), templateId: t.id }));
    },
    [templates, editProject],
  );
  const restorePremadeTemplates = useCallback(() => {
    const missing = missingPremadeTemplates(templatesRef.current);
    if (!missing.length) return 0;
    setTemplates((ts) => [...ts, ...missing]);
    return missing.length;
  }, [setTemplates]);

  const renderQueue = useRenderQueue({ projectRef, settings, updateClip, toast, showQueue });
  const { jobs, enqueue, cancelJob, retryJob, moveJob, removeJob, markDownloaded, queuePaused, setQueuePaused } = renderQueue;

  const queueValue = useMemo<QueueStore>(
    () => ({ jobs, cancelJob, retryJob, moveJob, removeJob, markDownloaded, queuePaused, setQueuePaused }),
    [jobs, cancelJob, retryJob, moveJob, removeJob, markDownloaded, queuePaused, setQueuePaused],
  );

  const shellValue = useMemo<ShellStore>(
    () => ({ settings, updateSettings, screen, go: setScreen }),
    [settings, updateSettings, screen],
  );
  const toastValue = useMemo<ToastStore>(
    () => ({ toasts, toast, dismissToast }),
    [toasts, toast, dismissToast],
  );
  // The clip library changes far more often than settings or the open project. Its own context
  // keeps note/favourite/removal edits from notifying screens that do not read clips.
  const libraryValue = useMemo<LibraryStore>(
    () => ({ clips, addClip, updateClip, deleteClip, deleteClips, autoCaptionClip }),
    [clips, addClip, updateClip, deleteClip, deleteClips, autoCaptionClip],
  );
  const viewerValue = useMemo<ViewerStore>(
    () => ({
      settings,
      updateSettings,
      go: setScreen,
      streams,
      addStream,
      removeStream,
      updateStream,
      addClip,
      updateClip,
      autoCaptionClip,
      openClip,
      toast,
    }),
    [settings, updateSettings, streams, addStream, removeStream, updateStream, addClip, updateClip, autoCaptionClip, openClip, toast],
  );

  const value = useMemo<Store>(
    () => ({
      settings,
      updateSettings,
      screen,
      go: setScreen,
      streams,
      addStream,
      removeStream,
      updateStream,
      project,
      setProject,
      editProject,
      undo,
      redo,
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      openClip,
      startProject,
      templates,
      saveTemplate,
      updateTemplate,
      overwriteTemplate,
      duplicateTemplate,
      deleteTemplate,
      applyTemplate,
      restorePremadeTemplates,
      enqueue,
      toasts,
      toast,
      dismissToast,
    }),
    [
      settings, updateSettings, screen, streams, addStream, removeStream, updateStream,
      project, setProject, editProject, undo, redo, past.length, future.length, openClip, startProject, templates, saveTemplate,
      updateTemplate, overwriteTemplate, duplicateTemplate, deleteTemplate, applyTemplate, restorePremadeTemplates, enqueue,
      toasts, toast, dismissToast,
    ],
  );

  return (
    <ShellCtx.Provider value={shellValue}>
      <ToastCtx.Provider value={toastValue}>
        <LibraryCtx.Provider value={libraryValue}>
          <ViewerCtx.Provider value={viewerValue}>
            <QueueCtx.Provider value={queueValue}>
              <Ctx.Provider value={value}>{children}</Ctx.Provider>
            </QueueCtx.Provider>
          </ViewerCtx.Provider>
        </LibraryCtx.Provider>
      </ToastCtx.Provider>
    </ShellCtx.Provider>
  );
}

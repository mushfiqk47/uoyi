# 02 — Architecture

## Runtime and request boundary

Clipweave is a browser-first React 19 + TypeScript application built with Vite. `src/App.tsx`
switches between the Viewer, Clips, Editor, Queue, and Settings screens. The Viewer remains mounted
while other screens are open so live streams and rolling buffers keep running. The other screens
are loaded on first visit, so the initial bundle does not include screens the user has not opened.

During development, `vite.config.ts` mounts `server/dev-api.cjs` as middleware. That file is a
thin compatibility shim over `server/index.cjs`, which composes a declarative router
(`server/router.cjs`), one module per capability in `server/routes/`, domain services in
`server/services/`, and pure helpers in `server/lib/`. The same handler serves `dist/` on port 8080
with `npm run server`. An optional legacy sibling `../web-server.cjs` is still accepted when the
in-repo server is absent; otherwise Vite answers local API requests with 503 JSON.

```text
Browser
  └─ React app (Vite)
      ├─ Viewer / Clips / Editor / Queue / Settings
      └─ typed local API requests
          └─ server/dev-api.cjs (shim)
              └─ server/index.cjs + router.cjs
                  ├─ routes/  health, streams, media, clips, streamlink, scenedetect, ai, facecam, models, render
                  ├─ services/ media preparation, FFmpeg work
                  ├─ lib/      http, multipart, proc, hls, files, id, security, ass, signals
                  └─ external tools: yt-dlp, ffmpeg/ffprobe, streamlink, scenedetect, nemo-speech, scripts/facecam_detect.py
```

## Product capabilities and code areas

| Capability | Main code |
| --- | --- |
| Stream viewing and rolling capture | `src/screens/Viewer.tsx`, `src/features/viewer/` (`useHlsStream`, `useAudioMonitor`, `useStreamRecorder`, `useAiAutoClip`), `src/lib/recorder.ts` |
| Clip library and AI clip finding | `src/screens/Clips.tsx`, `src/features/ai-clips/`, `src/lib/ai/` (`findClips`, `openai`, `scenes`, `feedback`, `captions`) |
| Timeline editing and preview | `src/screens/Editor.tsx`, `src/editor/` (`panels/`, `waveform.ts`, `Timeline.tsx`, `Preview.tsx`), `src/lib/project.ts`, `src/lib/compositor.ts` |
| Render queue and export | `src/queue/useRenderQueue.ts`, `src/screens/Queue.tsx`, `src/lib/render.ts`, `server/routes/render.cjs` |
| Settings and local persistence | `src/screens/Settings.tsx`, `src/lib/settings.ts`, `src/lib/db.ts`, `src/platform/storage/` |

## State and persistence

`src/store.tsx` coordinates settings, navigation, streams, clip metadata, the active project and
its undo/redo history, templates, queue actions, and toasts. `useLibrary()` exposes the clip
library and its mutations; the app shell and persistent Viewer use narrower contexts, so project
edits do not notify them. `src/queue/useRenderQueue.ts` owns the queue's persistence and render
lifecycle. Project edits are immutable, undo/redo keeps up to 120 steps, and coalescing keys
combine rapid slider changes.

Settings, screen, streams, clip metadata, templates, and the active project are persisted in
`localStorage` (with debounced active-project saves). Keys and one-shot migration flags live in
`src/platform/storage/keys.ts`; clip metadata loads and saves through `clipRepository.ts` with a
short debounce. Media blobs, render outputs, and queued project snapshots are stored in IndexedDB
(`clipkit-media`, object store `blobs`) with refcounted object URLs (`acquireBlobUrl` / `release`).
The local server automatically reaps expired temp media every 30 minutes and exposes manual cache
inspection/pruning via `/api/cache` and `/api/cache/prune`.

## Capture and rendering flows

1. The Viewer resolves stream URLs through the local API (validated against SSRF via
   `server/lib/security.cjs`) and uses `RollingRecorder` to keep a rolling capture buffer, plus
   optional Streamlink lossless TS→MP4 server recording (`sessionStorage` recovery across reloads)
   and an RMS audio-spike listener that triggers live AI evaluation on loud hype moments.
2. Clip finalization streams to `/api/clip/finalize`; this is separate from timeline export.
3. The Editor updates a `Project` and previews frames through the playback pool and compositor,
   with audio waveforms (`src/editor/waveform.ts`), magnetic timeline snapping, and preview safe
   zone overlays.
4. The Queue snapshots the project. When `/api/health` reports server FFmpeg, `src/lib/render.ts`
   uploads source media to `POST /api/render/native?async=1` and polls FFmpeg progress + streams
   the result via HTTP Range (`server/lib/ass.cjs` renders stylized ASS captions/text). When server
   FFmpeg is unavailable, it falls back cleanly to real-time browser Canvas + `MediaRecorder`.

The social overlay is preview-only. Timeline output uses the project compositor without that
overlay.

## Framework boundary

The app is a Vite SPA, not a Next.js app. Its core workflows depend on browser media elements,
canvas, MediaRecorder, and IndexedDB, while its API is a local machine service. Keep Vite while the
product remains a local browser editor. Revisit a framework with server rendering if public,
searchable pages or server-rendered routes become a product requirement.

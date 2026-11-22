# 02 — Architecture

## Runtime and request boundary

Clipweave runs as either a **Vite + React 19 SPA** (browser preview on port `3000`) or an
**Electron Desktop App** (`electron/main.cjs` + sandboxed `electron/preload.cjs` loading the local
Node HTTP server on `127.0.0.1` over an ephemeral loopback port). `src/App.tsx` switches between
Viewer, Clips, Editor, Queue, and Settings while keeping the Viewer mounted so live streams and
rolling buffers continue uninterrupted.

During development, `vite.config.ts` mounts `server/dev-api.cjs` on port `3000`; in production and
desktop mode, `server/index.cjs` serves `dist/` alongside `/api/*`, `/stream`, and `/media`.

```text
Browser / Electron Renderer (contextIsolation + sandbox)
  └─ React app (Vite)
      ├─ Auth bootstrap (Bearer token + HMAC mediaToken)
      ├─ Viewer / Clips / Editor / Queue / Settings
      └─ Typed local API requests (src/platform/api/*)
          └─ server/index.cjs + router.cjs
              ├─ auth & security (loopback CORS, CSPRNG token, local-only egress guard)
              ├─ routes/    health, setup, workspace, ai, clips, facecam, media, models, render, scenedetect, streamlink, streams
              ├─ services/  workspace (projects, media registry, AES-256-GCM secret vault), media prep
              ├─ lib/       paths (OS AppData + User Workspace), logger (rotating redacted), archive, proc, hls, security, ass, signals
              └─ tools:     ffmpeg/ffprobe (NVENC/VideoToolbox/QSV/AMF/CPU), yt-dlp, audio.cpp, streamlink, scenedetect, scripts/facecam_detect.py
```

## Product capabilities and code areas

| Capability | Main code |
| --- | --- |
| Desktop wrapper & IPC bridge | `electron/main.cjs`, `electron/preload.cjs`, `src/platform/desktop.ts` |
| Stream viewing and rolling capture | `src/screens/Viewer.tsx`, `src/features/viewer/`, `src/lib/recorder.ts` |
| Clip library and AI clip finding | `src/screens/Clips.tsx`, `src/features/ai-clips/`, `src/lib/ai/` (`findClips`, `openai`, `scenes`, `feedback`, `captions`) |
| Timeline editing and saved projects | `src/screens/Editor.tsx`, `src/editor/`, `src/platform/storage/projectRepository.ts`, `src/lib/project.ts`, `src/lib/compositor.ts` |
| Render queue and Exports folder | `src/queue/useRenderQueue.ts`, `src/screens/Queue.tsx`, `src/lib/render.ts`, `server/routes/render.cjs` |
| Settings, setup, privacy, diagnostics | `src/screens/Settings.tsx`, `src/components/Onboarding.tsx`, `src/lib/settings.ts`, `server/services/workspace.cjs` |

## State, persistence & security

`src/store.tsx` coordinates settings, `localOnlyMode` synchronization, saved project persistence
(synced between `localStorage` and OS `Workspace/Projects/`), undo/redo history, templates, queue
actions, and toasts. Media bytes live in IndexedDB (`clipkit-media`) without destructive auto-wipes
on transient errors, while uploads and rendered videos can be persisted directly into the user's
OS Workspace (`Workspace/Media/` and `Workspace/Exports/`).

Sensitive AI keys stored in the **Server Secret Vault** are encrypted using AES-256-GCM with an
OS-restricted `0600` key file in App Data and are redacted from diagnostic exports and rotating logs.

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

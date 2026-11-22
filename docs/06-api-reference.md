# 06 — API reference

All endpoints are served by the same handler. With `npm run dev`, use the Vite port (5173). With
`npm run server`, use port 8080. Implementation: `server/router.cjs` merges the tables in
`server/routes/*.cjs`; `server/dev-api.cjs` is only a compatibility shim. Server tests run with
`npm run test:server`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/ai/chat` | Chat completions proxy (AI Studio Gemini via `@google/genai` or OpenAI-compatible endpoints). |
| POST | `/api/resolve` | Resolve a pasted URL via `yt-dlp`; SSRF-validated; returns a proxied playable URL. |
| POST | `/api/media/prepare` | Download + merge a link into a local MP4. Returns `{id, url}`. |
| GET | `/api/media/status?id=` | `preparing` / `ready` / `failed`. |
| GET | `/media?id=` | Stream the prepared MP4 with HTTP Range (`206`). |
| GET | `/stream?url=` | SSRF-guarded HLS/media proxy with playlist rewriting and bounded segment caching. |
| POST | `/api/captions/generate` | Streamed multipart audio → 16 kHz WAV → transcript + word timings. |
| POST | `/api/clip/finalize` | Streamed multipart WebM → H.264/AAC MP4; returns bytes plus `X-Clipweave-Has-Audio/Video/Gpu` headers. |
| POST | `/api/render/native` | Native FFmpeg/NVENC timeline export with ASS overlays (`?async=1` returns `{id, duration}`). |
| GET | `/api/render/native/status?id=` | Native render progress (`status`, `progress`, `fps`, `remaining`, `error`). |
| GET | `/api/render/native/result?id=` | Stream completed native render output with HTTP Range (`206`). |
| POST | `/api/render/native/abort?id=` | Cancel a running native render and delete temp files. |
| POST | `/api/upload` | Stream a local file into a media job. |
| POST | `/api/analyze` | Extract audio, transcribe, and run FFmpeg energy peaks + silence detection in parallel. |
| POST | `/api/scenedetect/start` | Start visual scene-change detection (PySceneDetect, or FFmpeg `scenedetect` fallback). |
| GET | `/api/scenedetect/status?id=` | Poll scene spans and `backend` (`pyscenedetect` or `ffmpeg`). |
| POST | `/api/scenedetect/cancel?id=` | Cancel a running scene-detection job. |
| POST | `/api/streamlink/record` | Start server-side Streamlink live recording (`?url`, `title`, `quality`). |
| GET | `/api/streamlink/list` | List active/recent server-side Streamlink recordings for reload recovery. |
| GET | `/api/streamlink/status?id=` | Poll duration/byte size/status of a Streamlink recording. |
| POST | `/api/streamlink/stop?id=` | Stop Streamlink, losslessly remux `.ts` → faststart `.mp4`, register `/media?id=`. |
| POST | `/api/streamlink/cancel?id=` | Cancel a Streamlink recording and remove temp files. |
| POST | `/api/clip/cut` | Cut a moment into MP4 + thumbnail. |
| GET | `/media/clip?id=` | Stream a cut clip. |
| POST | `/api/facecam/detect` | YuNet + SFace detection from a frame. |
| GET | `/api/setup/status` | System check per installable tool (FFmpeg, yt-dlp, audio.cpp, pip tools) with source (`app` / `path` / `missing`). |
| POST | `/api/setup/install` | Provision a tool into the app's `bin\` folder for the current OS (per-platform static builds, pip via detected Python). |
| GET | `/api/setup/job?id=` | Setup job progress (status, log, percent). |
| GET | `/api/models` | Model catalog with installed flags and per-model backend (`audiocpp` / `nemo`). |
| POST | `/api/models/download` | Provision a model: audio.cpp runtime (when missing) + GGUF download, or `nemo-speech pull` for nemo-only entries. |
| GET | `/api/models/status?id=` | Download status, log, and percent. |
| GET | `/api/health` | Binary, AI, and capability status (`ffmpeg`, `gemini`, `scenedetect`, `sceneBackend`, `streamlink`, `opencv`, `nemo`, `nvenc`, `audiocpp`, `audiocppParakeet`). |
| GET | `/api/cache` | Temp cache directory size, entry count, and path. |
| POST | `/api/cache/prune` | Manually clear cached temp media/downloads and report reclaimed bytes. |

Example:
```powershell
(Invoke-WebRequest http://127.0.0.1:3000/api/health).Content
```

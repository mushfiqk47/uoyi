# 06 — API reference

All endpoints are served by the same handler. With `npm run dev`, use the Vite port (5173). With
`npm run server`, use port 8080. Implementation: `server/router.cjs` merges the tables in
`server/routes/*.cjs`; `server/dev-api.cjs` is only a compatibility shim. Server tests run with
`npm run test:server`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/ai/chat` | OpenAI-compatible chat proxy. Body may include `baseUrl`, `apiKey`, `model`, `messages`. |
| POST | `/api/resolve` | Resolve a pasted URL via `yt-dlp`; returns a proxied playable URL. |
| POST | `/api/media/prepare` | Download + merge a link into a local MP4. Returns `{id, url}`. |
| GET | `/api/media/status?id=` | `preparing` / `ready` / `failed`. |
| GET | `/media?id=` | Stream the prepared MP4 with HTTP Range. |
| GET | `/stream?url=` | CORS-safe HLS/media proxy with playlist rewriting and segment caching. |
| POST | `/api/captions/generate` | Audio (base64) → 16 kHz WAV → transcript + word timings. |
| POST | `/api/clip/finalize` | WebM → H.264/AAC MP4 with NVENC; returns the MP4 bytes plus `X-Clipweave-Has-Audio/Video/Gpu` headers. |
Note: timeline export no longer calls the `/api/render*` endpoints — rendering happens in the
browser with `MediaRecorder` (see `src/lib/render.ts`). The endpoints are retained in the local
API but are unused by the client and may be deleted.

| POST | `/api/render` | Single-request render: timeline JPEG frames + optional mixed WAV → selected video format through FFmpeg. (Unused by the client.) |
| POST | `/api/render/native` | Fast path for a single plain clip: original media + project layout → FFmpeg/NVENC without browser frame generation. (Unused by the client.) |
| POST | `/api/render/start` | Opens a render session from `{fps,width,height,format,duration}`; returns `{id}`. (Unused by the client.) |
| POST | `/api/render/frames?id=` | Append a batch of `frames` JPEG parts to a session. Returns the running `{frames}` count. (Unused by the client.) |
| POST | `/api/render/finish?id=` | Optional `audio` WAV part → encode the session and return the video. (Unused by the client.) |
| POST | `/api/render/abort?id=` | Discard a session and delete its frames. (Unused by the client.) |
| POST | `/api/upload` | Stream a local file into a media job. |
| POST | `/api/analyze` | Transcribe a prepared media file; returns timestamped transcript. |
| POST | `/api/clip/cut` | Cut a moment into MP4 + thumbnail. |
| GET | `/media/clip?id=` | Stream a cut clip. |
| POST | `/api/facecam/detect` | YuNet + SFace detection from a frame. |
| GET | `/api/models` | Model catalog with installed flags. |
| POST | `/api/models/download` | Start `nemo-speech pull`. |
| GET | `/api/models/status?id=` | Download progress/log. |
| GET | `/api/health` | Service status. |

Timeline export used to upload through the three session endpoints because Chrome only permits a streaming `fetch` body over HTTP/2 and the dev server is HTTP/1.1. Export now happens in the browser, so this no longer applies.

Example:
```powershell
(Invoke-WebRequest http://127.0.0.1:5173/api/models).Content
```

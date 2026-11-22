# Clipweave

A browser-based tool that turns live streams (Twitch, Kick, YouTube, direct HLS/MP4/WebM) into
vertical 9:16 clips. Weave the best live moments into finished shorts — locally, with GPU AI. It watches up to four streams at once, keeps a rolling buffer of recent video,
uses local AI to transcribe and find highlights, saves clips for later editing, and renders finished
shorts through a queue.

All media bytes stay on this device (IndexedDB). AI transcription runs locally on the GPU with
NVIDIA NeMo-Speech.cpp; clip suggestion uses any OpenAI-compatible chat endpoint.

## Documentation

The full documentation is split into subpages under [`docs/`](docs/README.md):

1. [Quick start](docs/01-quick-start.md)
2. [Architecture](docs/02-architecture.md)
3. [Viewer & clipping](docs/03-viewer-and-clipping.md)
4. [Editor](docs/04-editor.md)
5. [AI & models](docs/05-ai-and-models.md)
6. [API reference](docs/06-api-reference.md)
7. [Troubleshooting](docs/07-troubleshooting.md)
8. [Design audit](docs/08-design-audit.md)
9. [Live streaming latency](docs/09-live-streams.md)
10. [Record gallery](docs/10-recommend-mode.md)
11. [Colab MiMo as the app's AI](docs/11-colab-ai.md)
12. [Platform compatibility, workspace & AI privacy](docs/12-compatibility-and-privacy.md)

The visual system lives in [DESIGN.md](DESIGN.md).

---

## Requirements & Dependency Tiers

ClipWeave organizes tools into three transparent tiers in both the **First-Run Wizard** and **Settings → Setup & Hardware**:

| Tier | Tool | Purpose |
| --- | --- | --- |
| **Required** | `ffmpeg` / `ffprobe` | Timeline rendering (NVENC/VideoToolbox/QSV/AMF/CPU), audio prep, and MP4 finalization |
| **Recommended** | `yt-dlp` | Resolves YouTube/Twitch/Kick/channel links and prepares VODs with sound |
| **Recommended** | `audio.cpp` + Parakeet TDT | Offline word-level captions and speech transcription with zero cloud uploads |
| **Optional** | `streamlink` | Lossless server-side live stream recording (`.ts` → faststart `.mp4`) |
| **Optional** | `scenedetect` (PySceneDetect) | Visual scene-change boundary detection (falls back to FFmpeg scene detection) |
| **Optional** | `opencv` (`cv2`) + YuNet/SFace | Local facecam bounding-box detection in Editor → Frame |
| **AI Provider** | Local Ollama / Gemini / OpenAI-compatible | Highlight scoring (`Local-Only Mode` blocks cloud AI endpoints) |

No large AI models or binaries are bundled or downloaded silently. The **Welcome & System Check Wizard** and **Settings → Setup & Hardware** install tools on demand into the OS **App Data** folder (`%APPDATA%\ClipWeave`, `~/Library/Application Support/ClipWeave`, or `~/.local/share/ClipWeave`), while user projects, recordings, clips, and finished renders live in your configurable **Workspace Folder** (`~/Documents/ClipWeave` by default).

---

## Quick start

The app runs cleanly on **port 3000** (`npm run dev` mounts `server/dev-api.cjs` inside Vite; `npm run build && npm run start` serves `dist/` from `server/index.cjs`).

### 1. Install and launch

```bash
npm install
npm run dev
```

Open `http://localhost:3000/`. Follow the 3-step **Welcome & System Check Wizard** to check hardware, install required tools, and select **Local-Only Privacy Mode** or **Hybrid / Cloud AI Mode**.

### 2. Everyday launch & security

- API requests require per-session authentication (`CLIPWEAVE_API_TOKEN`) bootstrapped securely over same-origin `/api/auth/bootstrap` (or Electron IPC in desktop builds).
- Use **Settings → Folders & Storage** to change your Workspace directory or prune temp cache, and **Settings → Diagnostics & Updates** to download a redacted JSON diagnostic bundle.
- See [Platform Compatibility, Workspace & AI Privacy](docs/12-compatibility-and-privacy.md) for Windows, macOS, and Linux support details and Electron packaging scripts (`npm run desktop:pack`).

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check + production build to `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit suite (timeline math, subtitle parsing, captions, formatters) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run preview` | Vite preview |
| `npm run nemo:gpu` | Optional: starts `nemo-speech serve` with Parakeet on **GPU**, port 8081. Not needed for `npm run dev`. |

---

## Local server API (`server/dev-api.cjs`)

The same dependency-free Node handler is used two ways:
- In `npm run dev`, it is mounted as **Vite middleware** (so `npm run dev` is a single server; use the Vite port, usually 5173).
- With `npm run server`, it serves `dist/` at `http://127.0.0.1:8080` (run `npm run build` first).

| Endpoint | Purpose |
| --- | --- |
| `POST /api/ai/chat` (alias `/ai/chat`) | OpenAI-compatible `chat/completions` proxy. Accepts `baseUrl`, `apiKey`, `model`, `messages`. |
| `POST /api/resolve` | Resolves a pasted URL with `yt-dlp -J`. Picks a **video** format (avoids audio-only HLS), returns a proxied playable URL. YouTube VODs return a `/media?id=...` MP4 prepared with video+audio. |
| `POST /api/media/prepare` | Starts a background `yt-dlp` download + ffmpeg merge (H.264/AAC, ≤720p) into a local MP4. Returns `{id, url}`. |
| `GET /api/media/status?id=...` | `preparing` / `ready` / `failed`. |
| `GET /media?id=...` | Serves the prepared MP4 with HTTP Range support. Waits until preparation finishes. |
| `GET /stream?url=...` | CORS-safe proxy for HLS playlists and media segments. Rewrites playlist URIs, caches signed segments locally, supports Range/206. |
| `POST /api/captions/generate` | Converts uploaded audio to 16 kHz mono WAV with ffmpeg, then transcribes with word-level timestamps: audio.cpp first (`transcript\`), then the `nemo-speech transcribe` CLI, then Gemini as last resort. If a NeMo URL is configured, it tries that HTTP server first. |
| `POST /api/clip/finalize` | Trims/finalizes a captured WebM into H.264/AAC MP4 using **NVENC** (CPU fallback) and returns the bytes with `X-Clipweave-Has-Audio/Video/Gpu` response headers. |
| `POST /api/render/native` · `GET /api/render/native/status` · `GET /api/render/native/result` · `POST /api/render/native/abort` | Native FFmpeg/NVENC timeline export (`?async=1` progress polling, ASS text/caption burn-in, HTTP Range output download). |
| `POST /api/upload` | Streams an uploaded local file into a media job (`/media?id=...`). |
| `GET /api/streamlink/list` · `POST /api/streamlink/record` · `GET /api/streamlink/status` · `POST /api/streamlink/stop` · `POST /api/streamlink/cancel` | Server-side live recording via Streamlink: writes straight to disk, losslessly remuxes `.ts` → faststart `.mp4` on stop, and exposes active jobs across reloads. |
| `POST /api/scenedetect/start` · `GET /api/scenedetect/status` · `POST /api/scenedetect/cancel` | Detects visual scene changes with PySceneDetect or automatic FFmpeg `scenedetect` fallback (`{start,end,duration}` spans). |
| `POST /api/analyze` | Extracts audio, transcribes with NeMo/Gemini, and extracts FFmpeg audio peaks + silences. |
| `POST /api/clip/cut` | Cuts a moment from a prepared media file into an H.264/AAC MP4 + thumbnail (`/media/clip?id=...`). |
| `POST /api/facecam/detect` | YuNet + SFace detection via `scripts/facecam_detect.py`; returns normalized face boxes and the best matching face. |
| `GET /api/models` | Model catalog from `models.json` with `installed` flags and the backend that will run each entry (`audiocpp` / `nemo`). |
| `POST /api/models/download` | Provisions the model: downloads the latest audio.cpp prebuilt runtime when missing (`transcript\`), then the GGUF into the repo's `models\` folder; entries without an audio.cpp package fall back to `nemo-speech pull <repo>`. |
| `GET /api/models/status?id=...` | Download progress/log/percent (`downloading` / `ready` / `failed`). |
| `GET /api/health` · `GET /api/cache` · `POST /api/cache/prune` | Service/binary readiness plus temp media cache usage and manual pruning. |

AI credentials are **not bundled**. Set the base URL, API key, and model in **Settings → AI**, then
press **Test connection**. The values are saved in this browser's `localStorage` only.

The server can optionally read a fallback config from `%TEMP%\opencode\clipkit-ai-config.json`
(`{"baseUrl": "...", "apiKey": "...", "model": "..."}`), but no such file is shipped or created.
If your endpoint requires paid credits, switch to a free model in Settings → AI.

---

## How it works

### Watching and clipping
- **Viewer** supports up to **4 simultaneous streams** (Settings → Clipping). Layouts: grid, rows, focus, side.
- Paste Twitch/Kick/YouTube links or direct `.m3u8/.mp4/.webm/.mpg/.mpeg`. Resolution goes through `yt-dlp`
  and the local proxy so playback and `captureStream()` recording work despite CORS.
- HLS segments are cached by the local proxy; first fetch is ~150 ms, cached repeats ~5–20 ms.
  720p is preferred to keep preview and clipping smooth. Recorders prefer H.264 so the browser can
  use its hardware encoder instead of software VP8, which matters at 1080p with several encoders
  running per stream.
- Each tile runs a **RollingRecorder** (two overlapping MediaRecorders, VP8/Opus) holding the last
  15/30/60/120 seconds. **Clip** or **Clip all** saves that trailing window to **Clips**.
- Every new clip is finalized server-side into a clean **MP4 (H.264 + AAC)** with GPU encoding.
  This fixes intermittent WebM duration/seek/video issues and audio timestamp gaps. A warning is
  shown if the source itself has no audio track.
- **Auto record** (Viewer bar or Settings → Clipping) records every stream in real time from the
  moment it opens. The recorder shares the rolling buffer's captured video, so the stream is
  decoded once. Settings → Clipping → **Auto-save recording every** offers presets from 30 seconds
  to 30 minutes plus a custom interval from 30 seconds to 2 hours. Each save closes one segment,
  puts it in the **Records** gallery, and starts a fresh recording. Stopping a recording saves the
  final segment too. Recordings stay out of the Clips screen. Each tile also has its own
  **Record / Stop** button.
- **Recording quality** in Settings → Clipping switches between **Full HD** (4 Mbps, HLS may use a
  1080p rendition) and **Smooth** (1.5 Mbps, low HLS rendition) when several streams run at once.
- Every card in the Records gallery has a **Find clips** button. It runs the same local AI Clip
  Finder on that recording: GPU transcription, best-moment scoring, then clips saved to Clips with
  an option to open them in the Editor.
- When Streamlink is installed and the tile plays a real http(s) stream URL, the tile's **Record**
  button records **on the server** (shown as `Record … · server`): Streamlink writes the stream
  straight to disk at the live edge — original quality, no dropped frames, and it keeps recording
  while the tab is hidden or closed. One continuous take: **Stop** saves the whole file to
  **Records**, and closing the tile auto-saves it. Without Streamlink the tile falls back to
  browser recording and hints `pip install streamlink`.

### AI auto clip finder
1. Toggle **Viewer → AI auto clip** (or press the Sparkles button on a tile for a one-off check).
2. Every 10–60 s (Settings → AI), each live tile records a 5 s audio-only chunk.
3. The chunk is transcribed locally by NeMo-Speech/Parakeet on the **GPU**.
4. The transcript is sent to the configured OpenAI-compatible model with the clip-finding prompt.
5. If the moment scores at or above the threshold (default 7/10), the rolling buffer is captured
   and saved to **Clips** with an `AI n/10` note. It is not auto-opened, so you can edit later.

### AI Clip Finder (Clips screen)
The **AI Clip Finder** card on the Clips screen accepts a **YouTube link** or a **local file upload**:

1. `POST /api/media/prepare` or `POST /api/upload` creates a local MP4 with video + audio.
2. `POST /api/analyze` extracts 16 kHz audio, transcribes it with NeMo/Parakeet on the **GPU**, and returns a timestamped transcript.
3. `suggestClipsFromTranscript` asks the OpenAI-compatible model for the best 1–8 moments (`start`, `end`, `title`, `reason`, `score`).
4. `POST /api/clip/cut` uses ffmpeg + NVENC to cut each moment into a clean H.264/AAC MP4 with a thumbnail.
5. The clips are stored in IndexedDB and appear in **Clips** with an `AI n/10` chip, ready to edit.

The **Create AI clips** button opens a setup modal where you choose the source (YouTube link or local file), max clips, minimum AI score, min/max clip length, an optional focus hint, and **Scene detection**.

**Scene detection** (on by default when PySceneDetect is installed) runs `POST /api/scenedetect/start` in parallel with the audio analysis — it adds no extra wall time. The detected scene-change timestamps are passed to the AI as extra candidates for moments that speech alone misses (kills, big plays, scene transitions), and every pick's start is snapped onto the nearest visual cut so each clip opens on a clean boundary. The same toggle appears on the Records **Find clips** form.

### Facecam detection (Editor → Frame → Facecam detection)
Local **YuNet** face detection + **SFace** identity matching, via OpenCV in Python:

- Models: `web/models/yunet.onnx`, `web/models/sface.onnx` (OpenCV Zoo).
- Editor button **Detect with AI** captures the current clip frame and calls `POST /api/facecam/detect`.
- `scripts/facecam_detect.py` runs `cv2.FaceDetectorYN` and `cv2.FaceRecognizerSF`; the first detection becomes the identity reference, later detections keep the same streamer.
- The detected box is applied to `layout.facecam` and the layout switches to **Facecam + game**. “Reset face lock” clears the reference.

### Captions
- **Settings → Clipping → Auto-caption added clips** transcribes uploaded videos and manual or AI
  clips in Clips with the selected local model and stores word-level captions on the clip. Opening
  it in the Editor shows the captions already on the timeline; you can regenerate them any time.
  Continuous recordings in Records are raw captures and never get auto-captions.
- **Editor → Captions → Generate captions with AI** transcribes the clip’s audio with the selected
  model and loads word-level timings into the timeline.
- Built-in caption style presets: Shorts pop, TikTok clean, Bold karaoke, Minimal.
- You can also paste a transcript, spread words from the playhead, or import `.srt`/`.vtt`.

### Editor / rendering
- Editor layout: preview/phone on the **right**; inspector panels + timeline stacked on the **left**.
- Inspector tabs: Frame, Captions, **Text**, Overlay, Media, Templates (Text is fully supported, with its own timeline lane).
- The timeline has separate **Video**, **Text**, **Captions**, and **Audio** lanes. Video clips are
  muted and their sound is mirrored into the Audio lane at creation, so picture and sound can be
  moved/edited independently.
- Timeline toolbar: zoom out, **Fit**, and an accent **+ Zoom** button; drag clip edges to trim.
- Frame layout (fill/fit/facecam split), zoom/pan, captions, text, social overlays (TikTok/Shorts/Reels),
  media import, reusable templates with undo/redo (120 steps).
- **Render** snapshots the project into the **Queue** (`1` job at a time). When server FFmpeg is
  available (`/api/health`), `src/lib/render.ts` exports via `POST /api/render/native?async=1` using
  FFmpeg/NVENC and ASS caption/text overlays; otherwise it falls back to browser Canvas + `MediaRecorder`.
- Preview transport bar includes a **Safe zones** toggle to preview TikTok/Reels/Shorts clearances,
  and the timeline features decoded audio waveforms (`src/editor/waveform.ts`) and magnetic snapping.
- The social overlay is **preview-only**: it shows on the Editor phone frame, never in the exported file.

### Storage
- `localStorage`: settings, screen, streams, clip metadata, templates, active project.
- IndexedDB `clipkit-media` / `blobs`: clip bytes, imports, queue jobs and project snapshots, and
  render outputs. The DB self-heals if the `blobs` store is missing.
- **Settings → Storage** shows usage and can erase everything.

---

## Settings reference

### AI
| Setting | Default | Meaning |
| --- | --- | --- |
| Base URL | empty | OpenAI-compatible endpoint — enter it yourself in Settings → AI. |
| API key | empty | Stored in browser only; sent to the endpoint or local proxy. |
| Chat model | empty | Model used for moment scoring and AI Clip Finder — enter it yourself. |
| NeMo-Speech URL | empty | Optional HTTP ASR server; empty uses the local CLI. |
| Caption model | `parakeet-tdt` | Dropdown from `models.json` with **Download & use**. |
| AI auto clip finder | off | Listen/score/clip live moments automatically. |
| Check interval | 20 s | How often each stream is analyzed. |
| Clip threshold | 7 | Minimum score (1–10) before saving a clip. |
| AI clip prompt | (built in) | Instructions used for highlight scoring. |

### Clipping / Rendering
| Setting | Default | Meaning |
| --- | --- | --- |
| Rolling buffer | on | Keeps the trailing window for clipping. |
| Clip length | 30 s | 15/30/60/120 seconds. |
| Hassle-free recording | off | Record every stream in real time. A tile also has its own Record button. |
| Auto-save recording every | 5 min | Presets 30 s to 30 min, or custom 30 s to 2 h; saves the segment to Records and restarts. |
| Recording quality | Full HD | Full HD: 4 Mbps and 1080p HLS; Smooth: 1.5 Mbps and low HLS rendition. |
| Simultaneous streams | 4 | 2–4 streams at once. |
| Auto-caption added clips | off | Transcribe uploaded videos and Clips media with the selected model. Recordings in Records stay uncaptioned. |
| Resolution / fps / format | 1080p / 60 / MP4 | Configures the local FFmpeg timeline export. NVENC is used when available. |

**Test connection** in Settings → AI sends a minimal chat completion and reports the result.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Black video tile | Close and re-paste the link; the resolver now rejects audio-only formats. Check `/api/resolve` returns a URL with video. Hard refresh (`Ctrl+F5`). |
| Lagging playback | Confirm cached segments (~5–20 ms on repeat) and 720p selection. Reduce simultaneous streams. |
| No sound in a clip | Check the warning toast. Some sources expose no audio track; live streams with combined HLS or prepared YouTube MP4s have sound. |
| `Failed to fetch` on a queue job | The upload never reached the API. Confirm the `npm run dev` terminal is alive and `/api/health` answers on the port you opened, then press **Retry**. After a repo update, restart `npm run dev` first — the API module loads once at startup. |
| `Port 5173 is in use, trying another one...` | Another dev server is still running. Open the port Vite printed instead, or stop the old one: `(Get-NetTCPConnection -LocalPort 5173 -State Listen).OwningProcess` then `Stop-Process -Id <pid> -Force`. |
| Queue job sits at "Uploading frames" | Frames are still being composited/uploaded; without NVENC, FFmpeg falls back to CPU and takes much longer. Keep the tab open and watch the `npm run dev` terminal. |
| Caption generation failed | Check the selected model is downloaded (Settings → AI → Caption model) and `nemo-speech` is on PATH. A NeMo HTTP server is optional. |
| AI request fails 503 credits | Switch the chat model to a free model available on your endpoint via Settings → AI. |
| `Failed to fetch dynamically imported module` | Restart `npm run dev`; the app was loaded while the server was down. Hard refresh. |
| `One of the specified object stores was not found` | Fixed in `src/lib/db.ts`; DB now recreates the `blobs` store. If needed, clear site IndexedDB once. |
| YouTube VOD preparation slow | `yt-dlp` downloads video+audio before playback starts; ~15 s for a 16-minute 720p video here. |

---

## Source layout

```
src/
  App.tsx, main.tsx, store.tsx        # React shell + global state (undo/redo, queue, toasts)
  components/                         # TopBar, Toasts, Onboarding, shared UI controls
  screens/
    Viewer.tsx                        # Multi-stream view, rolling capture, AI auto clip
    Clips.tsx                         # Clip library, Create AI clips modal, notes/favourites
    Editor.tsx                        # Editor shell and tab layout (incl. Text)
    Queue.tsx                         # Render queue screen
    Settings.tsx                      # All settings incl. AI and model download
  features/
    ai-clips/                         # Shared ClipFinderFields form + validation
    viewer/                           # StreamCard + useHlsStream/useAudioMonitor/useStreamRecorder/useAiAutoClip
  queue/
    useRenderQueue.ts                 # Queue persistence, actions, and render lifecycle
  editor/                             # Preview, Timeline, panels/, waveform.ts, facecam.ts, player.ts
  platform/
    api/                              # Typed fetch wrappers (client, ai, media, models, scenedetect, streamlink, streams)
    storage/                          # keys.ts, migrations.ts, clipRepository.ts
  lib/
    ai/                               # findClips, openai, scenes, feedback, captions, audioSample
    compositor.ts, playback.ts, render.ts, recorder.ts
    db.ts, media.ts, project.ts, settings.ts, subtitles.ts, templates.ts, types.ts, util.ts
  styles/                             # tokens.css, base.css, app.css
models.json                           # ASR model catalog for Settings → AI
models/                               # YuNet ONNX face detection model
scripts/facecam_detect.py             # Local OpenCV face detection helper
vite.config.ts                        # Mounts the local API as Vite middleware
public/img/logo.svg                   # Clipweave favicon / mark
server/                               # Modular Node API (index.cjs, router.cjs, routes/*, lib/*, services/*)
```

---

## Known limitations

- Protected/DRM streams and links requiring login cookies cannot be played or clipped in a browser tab.
- YouTube VODs are downloaded/merged locally for sound; this takes time and disk space (temp files in `%TEMP%\clipkit-media-*`).
- Live AI clip finding depends on audible speech; silent/highly visual-only moments need the manual clip button or a vision-capable model.
- Timeline frames are prepared in the browser and uploaded to the local API for FFmpeg encoding; keep the app open until the queue job finishes.

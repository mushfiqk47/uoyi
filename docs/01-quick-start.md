# 01 — Quick start

```bash
npm install
npm run dev
```

Open `http://localhost:3000/`. `npm run dev` starts Vite on port **3000** and mounts the local API
(`server/dev-api.cjs`) as middleware in a single process.

For production serving (`dist/` + API on port 3000) run `npm run build && npm run start`.
For native desktop packaging (when `electron` and `electron-builder` are installed), use `npm run desktop:pack` (see [Platform Compatibility & Privacy](12-compatibility-and-privacy.md)).

## 1. Welcome & System Check Wizard

On first launch, ClipWeave opens the **Welcome & System Check Wizard**:

1. **System Check** — inspects your OS, CPU threads, RAM, GPU encoder (NVENC / VideoToolbox / QSV / AMF / CPU), free workspace disk space, and classifies tools into:
   - **Required**: **FFmpeg + FFprobe**
   - **Recommended**: **yt-dlp**, **Local Speech-to-Text (`audio.cpp` + Parakeet)**
   - **Optional**: **Streamlink**, **PySceneDetect**, **OpenCV (`cv2`)**
   You can install missing tools with one click inside **App Data** without touching system `PATH`.
2. **Privacy & AI Mode** — choose **Local-Only Privacy Mode** (blocks all cloud AI calls and keeps everything on-device) or **Hybrid / Cloud AI Mode**.
3. **Workflow Overview** — Watch & Record → Clip & Discover → Edit 9:16 & Export.

## 2. Where Your Files Live

ClipWeave automatically creates a user workspace folder (`~/Documents/ClipWeave` by default, configurable in **Settings → Folders & Storage**):

- `Projects/` — saved timeline projects (`.json`)
- `Recordings/` — live stream captures
- `Clips/` — trimmed video clips
- `Exports/` — finished rendered MP4/WebM shorts
- `Media/` — imported source videos & audio

Tool binaries, models, temporary cache, rotating redacted logs, and encrypted AI keys live separately in your OS **App Data** folder (`%APPDATA%\ClipWeave`, `~/Library/Application Support/ClipWeave`, or `~/.local/share/ClipWeave`).

## 3. Configure AI & Privacy (optional)

Open **Settings → AI & Privacy**:

- Enable **Local-Only Privacy Mode** for strictly offline Ollama / on-device transcription.
- Or choose **AI Studio (Gemini)** / **OpenAI-compatible** and store API keys securely in the **Encrypted Server Secret Vault**.
- Press **Test connection** to verify your active AI endpoint.

## 4. Core Workflow

1. **Viewer**: paste a Twitch/Kick/YouTube or direct media link, or capture a browser tab, then press **Watch**.
2. Press **Clip** for the trailing rolling buffer, or use **Clips → Create AI clips**.
3. **Editor**: customize 9:16 framing/facecam split, word-by-word captions, text overlays, and click **Save** or **Render**.
4. **Queue**: finished renders are saved straight to `Exports/` (when enabled) and available for one-click download or folder reveal.

## Verify Health

Run **Settings → Setup & Hardware** or **Settings → Diagnostics & Updates** inside the app (API routes require the session token obtained automatically from `/api/auth/bootstrap`).


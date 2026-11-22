# 12 — Platform Compatibility, Workspace & AI Privacy

## Supported Platforms & Verification Status

| Platform / Runtime | Architecture | Status | Verification Notes |
| --- | --- | --- | --- |
| **Linux (Web + Node.js + Chromium)** | x64 / arm64 | **Verified** | Tested directly on Linux with Vite/Node server tests, Vitest suite, and headless Chromium automation. |
| **Windows 10 / 11 (Desktop / Node)** | x64 | **Supported via config** | Standard OS path resolution (`%APPDATA%\ClipWeave`, `Documents\ClipWeave`), NVENC hardware encoder args, `.exe` binary lookup, and Electron NSIS/Portable config implemented. **Not natively built or GUI-tested on Windows inside this Linux container.** |
| **macOS 13+ (Desktop / Node)** | arm64 / x64 | **Supported via config** | Standard OS path resolution (`~/Library/Application Support/ClipWeave`, `~/Documents/ClipWeave`), Apple Silicon/Intel Electron DMG config, and VideoToolbox H.264 encoder detection (`h264_videotoolbox`) implemented. **Not natively built or GUI-tested on macOS inside this Linux container.** |

---

## Hardware Requirements

- **Minimum**: 64-bit CPU (4+ threads), 8 GB RAM, 4 GB free disk space (for FFmpeg + sample media + temporary renders).
- **Recommended**: 8+ thread CPU, 16 GB+ RAM, hardware H.264 GPU encoder (NVIDIA NVENC, Apple VideoToolbox, Intel QSV, or AMD AMF), 20 GB+ free SSD space.

---

## Dependency Tiers

1. **Required**
   - **FFmpeg + FFprobe** — Timeline rendering, audio extraction, thumbnail generation, clip cutting, and fast MP4 finalization. (When absent, live preview and slower in-browser MediaRecorder capture fallback remain available.)
2. **Recommended**
   - **yt-dlp** — Link resolution and VOD download with synchronized audio.
   - **Local Speech-to-Text (`audio.cpp` + Parakeet TDT)** — Offline word-level caption generation with zero cloud audio uploads.
3. **Optional**
   - **Streamlink** — Lossless server-side `.ts` → `.mp4` live stream recording.
   - **PySceneDetect** — Visual shot-cut boundary snapping (falls back to FFmpeg scene detection if absent).
   - **OpenCV (`cv2`) + YuNet/SFace** — On-device facecam bounding-box detection.

No large models or binaries are downloaded without explicit user action inside the **First-Run Wizard** or **Settings → Setup & Hardware**.

---

## Application Data & User Workspace Folders

ClipWeave strictly separates internal application state/secrets from user-facing media:

- **App Data Directory** (`CLIPWEAVE_DATA_DIR` override supported):
  - Windows: `%APPDATA%\ClipWeave`
  - macOS: `~/Library/Application Support/ClipWeave`
  - Linux: `$XDG_DATA_HOME/ClipWeave` or `~/.local/share/ClipWeave`
  - Holds: `bin/`, `models/`, `transcript/`, `cache/`, `logs/clipweave.log`, `workspace.json`, `.vault.key` (`0600`), and encrypted `secrets.enc.json` (`0600`).
- **User Workspace Directory** (configurable in **Settings → Folders & Storage**):
  - Default: `~/Documents/ClipWeave`
  - Subfolders created automatically: `Projects/`, `Recordings/`, `Clips/`, `Exports/`, `Media/`.

---

## Security & AI Privacy Model

1. **Loopback & Same-Origin Authentication**:
   - All mutating APIs (`/api/*`) and media streams require either a per-session CSPRNG Bearer token (`CLIPWEAVE_API_TOKEN`, served on same-origin `/api/auth/bootstrap` or Electron IPC) or an HMAC-signed `?token=` for media tags.
   - Non-local hosts are rejected by CORS and security response headers (`X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`).
2. **Local-Only Privacy Mode**:
   - Can be selected in the **Welcome Wizard** or toggled anytime in **Settings → AI & Privacy**.
   - Blocks Gemini, OpenAI, 9Router, Colab, and non-localhost inference/caption endpoints on **both client and server**.
   - Only `http://127.0.0.1` / `http://localhost` / `[::1]` AI services (e.g., local Ollama) and on-device tools (`audio.cpp`, FFmpeg, OpenCV YuNet) are allowed to run.
3. **Encrypted Server Secret Vault**:
   - Optional AES-256-GCM encrypted key storage in App Data (`secrets.enc.json`), write-only from Settings UI (`Configured` / `Not set` badges only; secrets are redacted from diagnostics and logs).

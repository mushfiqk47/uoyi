# 01 — Quick start

```bash
npm install
npm run dev
```

Open the URL Vite prints (for example `http://localhost:3000/`). `npm run dev` is the **only**
process you need: the local API (`server/dev-api.cjs`) is mounted as Vite middleware, so one
terminal runs everything.

## 1. Run the Setup panel first

Open **Settings → Setup**. It checks this machine and installs everything Clipweave needs into
the app's own folders — nothing is added to PATH and no other terminal steps are required:

- **FFmpeg + FFprobe** (required) — static build per OS (gyan.dev on Windows, johnvansickle on
  Linux, evermeet on macOS)
- **yt-dlp** (required) — official single-file binary
- **audio.cpp runtime + Parakeet model** (required) — local transcription for captions and AI
  clip finding
- Streamlink, PySceneDetect, OpenCV (optional) — installed via pip when Python 3 is present

Press **Install required (N)** once; each item shows live progress. Everything lands in the
project's `bin\`, `transcript\`, and `models\` folders, so the whole install travels with the
project folder to another machine.

Only Node.js 22+ and npm must already be installed. Python 3 is needed just for the optional pip
tools. No model or binary is bundled with the repo.

## 2. Configure AI (optional but recommended)

**Settings → AI**: enter your OpenAI-compatible base URL, API key, and model, then press
**Test connection**. Without an endpoint, rendering, streaming, and manual clipping still work —
only AI clip finding needs one.

## 3. First steps

1. **Viewer**: paste a Twitch/Kick/YouTube or direct media link, then press **Watch**.
2. Press **Clip** for the last N seconds, or toggle **AI auto clip** to let AI save highlights.
3. **Clips**: open a clip in the Editor, or use **Create AI clips** with a YouTube link/file.
4. **Editor → Render** → **Queue** → download the finished H.264/AAC MP4.

## Verify

```bash
curl http://127.0.0.1:3000/api/health
# {"ok":true,"ffmpeg":true,"ytDlp":true,"audiocpp":true,"audiocppParakeet":true,...}
```

Or use **Settings → Setup → Re-check system** — it reports the same state per tool.

## Sharing the app

### Same WiFi (local network)
`npm run dev` binds to all interfaces. The startup output prints a **Network** URL such as
`http://192.168.0.107:3000/`. Open that on phones/laptops on the same WiFi. If it fails, allow
**Node.js** through the firewall on Private networks and make sure the WiFi does not have client
isolation / guest-network blocking.

### Public internet link
Run the dev server in one terminal, then in a second terminal:

```bash
npm run share
```

The first run downloads `cloudflared`; it prints an `https://<random>.trycloudflare.com` URL you
can send to anyone. No account is needed for a quick tunnel. Stop it with Ctrl+C.

> **Security:** the tunnel exposes this machine's local APIs (yt-dlp, ffmpeg, transcription) to
> whoever has the URL. Share only with people you trust. AI credentials are entered per browser,
> not stored by the server.

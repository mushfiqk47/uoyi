# 01 — Quick start

```powershell
cd "C:\Users\mushfiq\Desktop\Bootstrap Import Setup\web"
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173/`). `npm run dev` is the **only** server
you need: the local API lives in `../web-server.cjs` and is mounted as Vite middleware.

## Requirements on PATH
- Node 22+ and npm
- `yt-dlp` — resolves YouTube/Twitch/Kick links
- `ffmpeg` / `ffprobe` with NVENC — clip finalization, audio repair, model preprocessing
- `nemo-speech` (NeMo-Speech.cpp CLI) — local speech recognition

## First steps
1. **Settings → AI**: enter your OpenAI-compatible base URL, API key, and model, then press **Test connection**.
2. **Settings → AI → Caption model**: pick a model and press **Download & use** if it is not installed.
3. **Viewer**: paste a Twitch/Kick/YouTube or direct media link, then press **Watch**.
4. Press **Clip** for the last N seconds, or toggle **AI auto clip** to let AI save highlights.
5. **Clips**: open a clip in the Editor, or use **Create AI clips** with a YouTube link/file.
6. **Editor → Render** → **Queue** → download the finished H.264/AAC MP4.

## Verify
```powershell
(Invoke-WebRequest http://127.0.0.1:5173/api/health).Content
# {"ok":true,"ytDlp":true,"nemo":true}
```

## Sharing the app
### Same WiFi (local network)
`vite.config.ts` sets `server.host = true`, so Vite binds to all interfaces. The startup output prints
a **Network** URL such as `http://192.168.0.107:5173/`. Open that on phones/laptops on the same WiFi.
If it fails, allow **Node.js** through Windows Firewall on Private networks and make sure the WiFi
does not have client isolation / guest-network blocking.

### Public internet link
Run the dev server in one terminal, then in a second terminal:

```powershell
npm run share
```

The first run downloads `cloudflared`; it prints an `https://<random>.trycloudflare.com` URL you can
send to anyone. No account is needed for a quick tunnel. Stop it with Ctrl+C.

> **Security:** the tunnel exposes this machine's local APIs (yt-dlp, ffmpeg, GPU ASR) to whoever has
> the URL. Share only with people you trust, and never expose it without a protected tunnel if the
> machine holds sensitive data. AI credentials are entered per browser, not stored by the server.

For the built app on port 8080 (`node ..\web-server.cjs`), tunnel to `http://127.0.0.1:8080` instead.

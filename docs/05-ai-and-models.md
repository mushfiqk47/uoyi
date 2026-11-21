# 05 — AI & models

## Chat endpoints
Set these in **Settings → AI → Endpoint**. The three profiles keep separate configs:
- **Local Ollama** — `http://localhost:11434/v1`.
- **Cloud (Colab)** — the MiMo notebook's Cloudflare tunnel URL and key.
- **Gemini API** — Google's OpenAI-compatible endpoint
  (`https://generativelanguage.googleapis.com/v1beta/openai/`) with a key from
  [Google AI Studio](https://aistudio.google.com/apikey). The Base URL is pre-filled; pick a model
  such as `gemini-2.5-flash`. Requests go directly from the browser to Google.
- **OpenAI / Custom** — any provider that speaks the OpenAI chat-completions API: OpenAI
  (`https://api.openai.com/v1` is pre-filled), OpenRouter, Groq, Together, LM Studio, vLLM or your
  own gateway. Paste its base URL, key and model name.

For every profile:
- **API key** — saved only in this browser's `localStorage`.
- **Chat model** — the model used for moment scoring and the AI Clip Finder.

**Test connection** sends a minimal chat completion and reports the response. If your model requires
credits or is unavailable, switch to a free model on the same endpoint. Gemini uses the OpenAI-compatible
chat completions route; `response_format: json_object` is omitted because that layer doesn't support it,
and the app's JSON parser handles plain or fenced replies.

The API handler also accepts a fallback config at `%TEMP%\opencode\clipkit-ai-config.json`, but no
such file is shipped or created by this project.

## Local speech models
The catalog lives in `models.json`:

| id | model | notes |
| --- | --- | --- |
| `parakeet-tdt` | nvidia/parakeet-tdt-0.6b-v3 | Fast multilingual ASR with word timestamps; default. |
| `parakeet-ctc` | nvidia/parakeet-ctc-1.1b | Higher accuracy on long English audio. |
| `nemotron-en` | nvidia/nemotron-speech-streaming-en-0.6b | English-only, low latency. |
| `nemotron-3.5` | nvidia/nemotron-3.5-asr-streaming-0.6b | CLI default. |

In **Settings → AI → Caption model**, pick from the dropdown. Models already downloaded show a ✓.
Press **Download & use** to run `nemo-speech pull <id>`; progress is polled from the local server and
the model is selected automatically when ready.

The app uses the `nemo-speech transcribe` CLI with the selected model by default. An optional HTTP
server (`npm run nemo:gpu`, port 8081) can be used by setting **NeMo-Speech URL**; it is not required
for `npm run dev`.

## GPU usage
- Speech recognition: NeMo CLI/server runs on CUDA when available (verified with `/ready` → `device: cuda`).
- Clip/facecam finalization: ffmpeg uses `h264_nvenc` when available, CPU fallback otherwise.
- Timeline export: the browser composites and records the video; FFmpeg/NVENC is used for captured-clip finalization and clip cuts, not for the timeline export. The unused legacy `/api/render*` endpoints live in `server/routes/render-legacy.cjs`.

## AI features
- **AI auto clip finder** — live moment scoring from local transcripts.
- **Create AI clips** — YouTube link/file → transcript → best moments → saved clips (setup modal).
- **Auto-caption added clips** — transcription at capture time for uploaded videos and Clips media, stored on the clip. Continuous recordings are excluded.

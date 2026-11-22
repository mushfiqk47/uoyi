# 05 — AI & models

## Chat endpoints
Set these in **Settings → AI → Endpoint**. Each profile stores its own config:
- **AI Studio Gemini** (default) — routes through `/api/ai/chat` (`server/lib/gemini.cjs`) using
  `gemini-4-hydrogen` with server-side key management or an optional user-supplied API key. Large
  audio attachments (>12 MB) are uploaded via the Gemini Files API and cleaned up automatically.
- **Local Ollama** — `http://localhost:11434/v1` (direct proxy relay allowed for loopback Ollama).
- **Cloud (Colab)** — Colab + Cloudflare quick tunnel URL and optional key.
- **OpenAI / Custom** — OpenAI (`https://api.openai.com/v1`) or any OpenAI-compatible gateway.
- **9Router / Kilo** — starts with an empty base URL; paste your own gateway URL if used.

Settings → AI displays live capability badges from `/api/health` (**FFmpeg**, **Gemini**, **Scenes**,
**Streamlink**, **OpenCV**, **NeMo**) and tucks NeMo-Speech URL, Caption model, default AI prompt,
and local **Feedback calibration** controls inside the collapsible **Advanced AI & speech** drawer.

## Local speech models
The Caption-model dropdown lists **every ASR GGUF the pinned audio.cpp release can download**
(`server/lib/audiocpp.cjs` `PACKAGES`, ~30 entries — Parakeet, Nemotron, Qwen3-ASR, CrisperWhisper,
SenseVoice, Cohere, Voxtral, Canary, Granite Speech, OWSM, Moonshine, GigaAM, and more), plus the
`models.json` entries that only nemo-speech provides (`parakeet-ctc`, `nemotron-en`). Entries are
ordered recommended-first: the default `parakeet-tdt` on top, then word-timestamped models before
segment-timed and multi-GB audio-LLMs. Each entry shows its download size and which backend runs it.

Families without a published GGUF (`edda`, `audio8`) and multi-file packages (LFM Audio,
Nemotron 30B Transcribe, VibeVoice BitNet) are excluded because the app downloads single files.

In **Settings → AI → Advanced AI & speech → Caption model**, pick from the dropdown. Models already
downloaded show a ✓ with the backend that will run them. Press **Download & use** and the server
provisions everything on its own (`server/lib/audiocpp.cjs`). The AI Clip Finder on the Clips and
Recommend screens shows the same setup inline as a **Download & set up** button whenever no speech
model is ready:

1. Downloads the **latest prebuilt audio.cpp portable runtime** (~35 MB CPU build from the GitHub
   releases API, falling back to the tested pinned version when the API is unreachable) when
   `audiocpp_cli` is not resolvable (repo `transcript\bin` → `CLIPWEAVE_AUDIOCPP_EXE` → PATH), and
   extracts it with Windows' bundled `tar.exe` (PowerShell `Expand-Archive` fallback). Existing
   installs are never auto-upgraded mid-session.
2. Downloads the model **GGUF** from Hugging Face (usually the `audio-cpp/audio.cpp-gguf` repo;
   a few families use their own repos) with a live percent progress reported through
   `/api/models/status`.
3. Stores the runtime under the repo's **`transcript\bin\`** and the model GGUFs under the repo's
   existing **`models\<model-id>\`** folder, and invokes the CLI by absolute path — nothing touches
   `PATH`, a running server needs no restart, and the whole install travels with the project
   folder between machines.

Transcription runs `audiocpp_cli --task asr --family <family> --model <gguf> --backend cpu
--audio <16 kHz mono WAV> --words-out <json>` with the family and GGUF from the chosen catalog
entry. Word timestamps arrive as samples at the input rate and are converted to seconds; segment
lists are synthesized from word gaps for families that only emit words, and families without a
word writer still return the transcript from the CLI's stdout. Env overrides:
`CLIPWEAVE_AUDIOCPP_DIR` (storage root), `CLIPWEAVE_AUDIOCPP_EXE`, `CLIPWEAVE_AUDIOCPP_URL`
(e.g. the CUDA or Vulkan portable zip), `CLIPWEAVE_AUDIOCPP_BACKEND`.

## GPU & FFmpeg usage
- Speech recognition: audio.cpp runs the Parakeet/Nemotron GGUFs on CPU by default (real-time or
  faster for the 0.6B models); swap in the CUDA or Vulkan portable build via
  `CLIPWEAVE_AUDIOCPP_URL` + `CLIPWEAVE_AUDIOCPP_BACKEND` for GPU acceleration. The optional
  nemo-speech CLI/server runs on CUDA when available (`/ready` → `device: cuda`).
- Visual scene detection: uses PySceneDetect when installed, and falls back seamlessly to FFmpeg
  `scenedetect` (`sceneBackend: "ffmpeg"`) plus audio `silencedetect` / peak-energy analysis.
- Clip capture, cuts, and native timeline export: FFmpeg uses `h264_nvenc` when available, with
  `libx264` CPU fallback (`server/routes/render.cjs` + `server/lib/ass.cjs`).

## AI features
- **AI auto clip finder** — live moment scoring triggered on schedule (`3–15` min) or on audio hype
  spikes (`+10 dB` over rolling baseline via `useAudioMonitor`).
- **Create AI clips** — link/local file → parallel audio + scene/silence analysis → sliding
  overlapping transcript windows with temporal IoU deduplication (`dedupeOverlappingPicks`) →
  boundary snapping (`snapPicksToSignals`) → calibrated picks saved to Clips.
- **Creator calibration (`src/lib/ai/feedback.ts`)** — locally records favourite, edit, render, and
  dismiss actions to guide future AI scoring prompts; resettable anytime in Settings → AI.
- **Auto-caption added clips** — transcription at capture time for uploaded videos and Clips media,
  remapped to clip trim/speed ranges (`mapRawWordsToClipRanges`). Continuous recordings are excluded.

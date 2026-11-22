# 11 — Colab MiMo as ClipWeave's AI (toggle Local / Cloud)

`mimo_v26_heretic_ollama_colab.ipynb` runs the MiMo-V2.6 Heretic 9B model on a free Colab T4 and
exposes it as an OpenAI-compatible endpoint behind a Cloudflare quick tunnel with an API-key auth
proxy. Clipweave can use it for every AI feature (clip finding, moment scoring, titles, clustering)
or a local Ollama server — switch any time in Settings → AI → Endpoint.

## Quick start

1. Colab: **Runtime → Change runtime type → T4 GPU**, then **Run all**.
2. Watch cell 1.5 (Google Drive cache) — the first run downloads the model once (~6.5 GB); later
   sessions skip the pull. Disable it if you have no Drive space.
3. When it finishes, cell 7 prints the **Base URL** (`https://xxxx.trycloudflare.com/v1`), the
   **API key**, and the model name (`mimo-v2.6-heretic`).
4. ClipWeave → Settings → AI → Endpoint:
   - pick **Cloud (Colab)**,
   - paste Base URL, API key, model (`mimo-v2.6-heretic`),
   - press **Test connection** — you should get `Connected`.
5. Flip back to **Local Ollama** any time to use your machine's Ollama instead (default:
   `http://localhost:11434/v1`, model `mimo-v2.6-heretic`, no key). Both profiles are kept
   separately, so the toggle never loses either configuration.

## Notes and limits

- The tunnel URL and API key change **every time the notebook re-runs** (unless you pin `API_KEY` in
  Config) — after a restart, paste the new pair into Settings. That's the trade for zero accounts.
- Free Colab disconnects (~12 h, idle timeouts). Model weights persist on Drive; the tunnel and key do not.
- 77K context at q8_0 KV cache uses ~7.9 GB of the T4's 15 GB — fine for long transcripts.
- Thinking mode is configurable (`THINKING` in Config, or per request via `"think": true/false`);
  the auth proxy maps these to `reasoning_effort` for Ollama's OpenAI endpoint.
- Local Ollama must serve the same alias: `ollama pull maternion/mimo-v2.6-heretic:9b-instruct` then
  `ollama create mimo-v2.6-heretic -f <(echo 'FROM maternion/mimo-v2.6-heretic:9b-instruct\nPARAMETER num_ctx 78848')`
  — the exact commands are in the notebook.
- Old single `aiBaseUrl/aiApiKey/aiModel` values are migrated into the cloud profile automatically
  on first load after the update.

KV cache env, exact proxy behavior, and every cell are documented inline in the notebook.

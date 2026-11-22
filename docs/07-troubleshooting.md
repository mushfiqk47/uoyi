# 07 — Troubleshooting

| Symptom | Fix |
| --- | --- |
| Black video tile | Re-paste the link; the resolver rejects audio-only formats. Hard refresh. |
| Lagging playback | Confirm 720p selection and cached segments; reduce simultaneous streams. |
| No sound in a clip | Some sources expose no audio track. Use live combined HLS or prepared YouTube MP4s. |
| Caption generation failed | Check **Settings → Setup & Hardware** to confirm audio.cpp + Parakeet or an AI provider is ready. |
| AI connection failed | Check **Settings → AI & Privacy**. If **Local-Only Privacy Mode** is enabled, remote endpoints are intentionally blocked. |
| AI 503 credits | Switch the chat model to a free model or local Ollama in **Settings → AI & Privacy**. |
| `401 Unauthorized` on API | Refresh the tab so `/api/auth/bootstrap` issues a fresh session token (or restart `npm run dev`). |
| Missing media in Editor | Click the **Relink** button in the yellow missing-media banner to re-attach the source video/audio file. |
| Model download stuck | Check free space in **Settings → Folders & Storage** and inspect **Settings → Diagnostics & Updates**. |
| Facecam not found | Use a frame where the face is visible; press **Reset face lock** to pick a new identity. |
| `Failed to fetch dynamically imported module` | Restart `npm run dev` and hard refresh. |
| IndexedDB object store error | The DB self-heals non-destructively; download your exports and clear browser storage only if needed. |
| YouTube VOD slow to appear | `yt-dlp` downloads video+audio first (~15 s for a 16-minute 720p video here). |

For bug reports, open **Settings → Diagnostics & Updates → Download report** to save a redacted JSON bundle without API keys or tokens.


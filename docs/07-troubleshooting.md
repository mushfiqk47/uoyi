# 07 — Troubleshooting

| Symptom | Fix |
| --- | --- |
| Black video tile | Re-paste the link; the resolver rejects audio-only formats. Hard refresh. |
| Lagging playback | Confirm 720p selection and cached segments; reduce simultaneous streams. |
| No sound in a clip | Some sources expose no audio track. Use live combined HLS or prepared YouTube MP4s. |
| Caption generation failed | Ensure the selected model is downloaded and `nemo-speech` is on PATH. |
| AI connection failed | Set base URL/key/model in Settings → AI and press **Test connection**. |
| AI 503 credits | Switch to a free model available on your endpoint. |
| Model download stuck | Check `nemo-speech pull <id>` manually; verify disk space and network. |
| Facecam not found | Use a frame where the face is visible; press **Reset face lock** to pick a new identity. |
| `Failed to fetch dynamically imported module` | Restart `npm run dev` and hard refresh. |
| IndexedDB object store error | The DB self-heals; if needed clear site IndexedDB once. |
| YouTube VOD slow to appear | `yt-dlp` downloads video+audio first (~15 s for a 16-minute 720p video here). |

For design drift or visual defects, see [DESIGN.md](../DESIGN.md) and run the Impeccable detector.

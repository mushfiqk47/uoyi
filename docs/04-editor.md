# 04 — Editor

## Layout
Preview/phone on the **right**; inspector tabs and timeline stacked on the **left**. Tabs: **Frame,
Captions, Text, Overlay, Media, Templates**.

## Timeline lanes
- **Video** — picture clips, trimmed by dragging edges.
- **Text** — text overlays, movable and trimmable.
- **Captions** — word-level caption blocks.
- **Audio** — music and mirrored clip audio.

Video and audio are separate from creation: video clips are muted and their sound is copied into the
Audio lane, so picture and sound can be moved independently.

Toolbar: zoom out, **Fit**, and an accent **+ Zoom** button. Keyboard: Space play/pause, S split,
Delete remove, arrows step, Ctrl+Z / Ctrl+Shift+Z undo/redo.

## Frame
Layout modes: Fill, Fit, Facecam + game. Zoom/pan controls the main picture; the facecam box is
draggable. **Detect with AI** uses local YuNet + SFace to place the box and lock the streamer's face.

## Captions
- **Generate captions with AI** transcribes the clip with the selected model.
- Presets: Shorts pop, TikTok clean, Bold karaoke, Minimal.
- Paste a transcript, spread words from the playhead, or import `.srt` / `.vtt`.

**Settings → Clipping → Auto-caption added clips** transcribes uploaded videos and manual or AI
clips at capture time; those captions are already on the timeline when you open the clip.
Continuous recordings in Records are not auto-captioned.

## Render
**Render** adds a Queue job with a snapshot of the current project. `src/lib/render.ts` composites
the timeline onto a 9:16 canvas in real time and records that canvas, plus the mixed timeline audio,
with `MediaRecorder`. No server request is involved in a timeline export. The default output is
**1080p, 60 fps, MP4** when the browser supports it; resolution, frame rate, and format are set in
Settings. Queue jobs and their project snapshots are stored in IndexedDB and interrupted jobs can
be retried after reopening the app.

Clip capture uses a different path: `/api/clip/finalize` converts captured WebM clips to MP4.
The legacy `/api/render*` endpoints still exist in `server/routes/render-legacy.cjs` but are unused
by the client. Keep the tab open and in front while a render runs.

A 60 fps output file needs 60 fps source footage for genuinely smoother motion; a 30 fps source is
duplicated into 60 container frames.

The social overlay (likes, handle, progress bar) is **preview-only**. It appears on the phone
preview in the Editor but is never drawn into rendered files.

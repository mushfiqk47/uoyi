# 04 — Editor

## Layout
Preview/phone on the **right**; inspector tabs and timeline stacked on the **left**. Tabs: **Frame,
Captions, Text, Overlay, Media, Templates** (implemented as focused modules in `src/editor/panels/`).

## Timeline lanes
- **Video** — picture clips, trimmed by dragging edges.
- **Text** — text overlays, movable and trimmable.
- **Captions** — word-level caption blocks.
- **Audio** — music and mirrored clip audio, rendered with decoded amplitude waveforms (`src/editor/waveform.ts`).

Video and audio are separate from creation: video clips are muted and their sound is copied into the
Audio lane, so picture and sound can be moved independently. Splitting a video clip (`S` or
`splitVideoClipAt`) also splits its mirrored `auto` audio track at the matching point; deleting a
split video clip removes only its matching audio slice and shifts later auto slices cleanly.

Dragging trim handles or moving blocks magnetically snaps to the playhead and neighboring edges;
hold `Alt` or `Shift` while dragging to move freely without snapping. A floating timestamp badge
follows edits.

Toolbar: zoom out, **Fit**, and an accent **+ Zoom** button. Keyboard: Space play/pause, S split,
Delete remove, arrows step, Ctrl+Z / Ctrl+Shift+Z undo/redo.

## Preview & Frame
Layout modes: Fill, Fit, Facecam + game. Zoom/pan controls the main picture; the facecam box is
draggable. **Detect with AI** uses local YuNet + SFace to place the box and lock the streamer's face.
The preview transport bar includes a **Safe zones** toggle to overlay TikTok/Reels/Shorts top,
right action-rail, and bottom caption-safe boundaries.

## Captions
- **Generate captions with AI** transcribes the clip with the selected model and automatically remaps
  word timestamps across trimmed, split, or speed-adjusted video clips.
- Presets: Shorts pop, TikTok clean, Bold karaoke, Minimal.
- Paste a transcript, spread words from the playhead, or import `.srt` / `.vtt`.

**Settings → Clipping → Auto-caption added clips** transcribes uploaded videos and manual or AI
clips at capture time; those captions are already on the timeline when you open the clip.
Continuous recordings in Records are not auto-captioned.

## Render
**Render** adds a Queue job with a snapshot of the current project (`MAX_CONCURRENT_RENDERS = 1`,
jobs run sequentially). When `/api/health` reports server `ffmpeg`, `src/lib/render.ts` exports on
the server via `POST /api/render/native?async=1` using FFmpeg/NVENC and `server/lib/ass.cjs` for
word-highlighted captions and text overlays, then downloads the final MP4/WebM via HTTP Range.
When server FFmpeg is unavailable, it falls back automatically to browser Canvas + `MediaRecorder`.

The default output is **1080p, 60 fps (minimum), MP4** using fastest encoding presets (`ultrafast` / NVENC `p1`; Settings → Rendering supports 720p/1080p). An active native FFmpeg job cannot pause mid-encode, so pausing the Queue lets it
finish (`queue paused after this`) before halting subsequent jobs. Queue jobs and their project
snapshots are stored in IndexedDB and interrupted jobs can be retried after reopening the app.

Clip capture uses a separate path: `/api/clip/finalize` converts captured WebM clips to MP4.

A 60 fps output file needs 60 fps source footage for genuinely smoother motion; a 30 fps source is
duplicated into 60 container frames.

The social overlay (likes, handle, progress bar) is **preview-only**. It appears on the phone
preview in the Editor but is never drawn into rendered files.

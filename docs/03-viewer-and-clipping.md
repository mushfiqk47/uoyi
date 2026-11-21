# 03 — Viewer & clipping

> **Note (2026-11-18):** the interactive watch view described below was retired. Streams are now
> **headless**: paste a link, the app records it in the background, the AI saves moments at/above
> the threshold to Clips, and every recording is logged in the Record gallery (with cross-stream
> clustering). See [10 — Record gallery](10-recommend-mode.md) for the current behavior. This page
> kept for the HLS proxy, rolling-buffer and finalize details, which are unchanged.

## Adding a source
Paste a **Twitch**, **Kick**, **YouTube**, or direct `.m3u8` / `.mp4` / `.webm` / `.mpg` / `.mpeg` link and press **Watch**.

`POST /api/resolve` runs `yt-dlp -J`, chooses a format with a real **video** track, and returns a
proxied playable URL. YouTube VODs are prepared as a local merged MP4 (`/media?id=...`) so they have
sound. The demo stream cards have been removed; the empty state only asks for a link.

Up to **4 streams** can be open simultaneously (Settings → Clipping).

## Playback performance
`/stream?url=` rewrites HLS playlists through the local proxy and caches signed segments. Repeat
segment fetches are served from memory in ~5–20 ms. Sources are capped to player size to keep capture smooth.

**Recording at 1080p.** Each open tile runs two rolling `MediaRecorder`s plus one continuous
recorder when recording is on. The earlier build forced VP8, which is software-encoded on most
machines, so three 1080p VP8 encoders competed with the decoder and playback stuttered. Chrome's
own MediaRecorder notes say the browser picks a hardware-accelerated encoder when `mimeType` is
left unspecified. `pickMime()` now probes H.264 options first and otherwise returns an empty
string, and both recorders omit `mimeType` in that case so the browser can choose. The recorder's
actual `mimeType` is read back and used for the saved blob. HLS catch-up was also lowered from
`maxLiveSyncPlaybackRate: 1.5` to `1.1`, because 1.5x playback means 50% more frames to decode
and encode every second at 1080p.

## Rolling buffer
Each tile runs `RollingRecorder`: two overlapping MediaRecorders (VP8/Opus, 2 Mbps) that hold the
last 15/30/60/120 seconds. **Clip** saves the trailing window; **Clip all** saves every tile.

Every captured clip is finalized server-side into H.264/AAC MP4 with NVENC, which fixes intermittent
WebM duration and audio-timestamp problems. If the source has no audio track, the app warns you.

## Hassle-free recording

Press **Auto record** in the Viewer bar, or switch it on in Settings → Clipping, to record every
stream in real time from the moment it opens. Each stream card also has its own **Record** button.
A tile shows a `REC` badge with elapsed time while recording.

`LiveRecorder` in `src/lib/recorder.ts` runs one extra MediaRecorder per stream. It shares the
captured MediaStream with the rolling buffer, so the video is decoded once, and lets the browser
pick its hardware encoder (H.264 where available) with `contentHint = "motion"` to keep the live
decode smooth. Audio is captured at 128 kbps so voices and game audio stay clean. Chunks (one every
four seconds) are written to IndexedDB as they arrive rather than held in JavaScript memory.

Settings → Clipping → **Auto-save recording every** offers presets from 30 seconds to 60 minutes
and a **Custom…** entry for any interval from 30 seconds to 2 hours. It closes the current segment
and saves it to the Record gallery as a plain clip. The playable WebM
is written to IndexedDB and listed first, so the recording shows up immediately even if the local
API is busy. Remuxing to MP4 through `/api/clip/finalize` then happens in the background and
replaces the stored bytes when it succeeds. A fresh recorder starts as soon as the previous one is
stopped, before the finished segment is read back and stored, so a save never leaves a gap in the
recording. Stopping a recording flushes the final segment the same way, and the tile shows
`Saving` until it is in the gallery. **Save now** on a recording tile closes the current segment
and keeps recording, using the same path as the timer. Each segment boundary is logged in the
activity console, and an overdue segment is flushed when a backgrounded tab becomes visible again
because browsers throttle timers in hidden tabs. Changing the interval reschedules the running
segment instead of dropping it.

Recordings appear in the **Records** gallery only: that gallery lists clips marked `recording`, so
manual clips, AI picks and imported media never appear there. The Clips screen hides those same
recordings, so each gallery shows only its own kind of footage. The headless video plays at
near-zero volume rather than `muted`, because muting a media element has produced silent
`captureStream()` output in some Chrome releases. `captureTracks()` checks for live video and audio
tracks before recording starts and logs a warning when the source has no audio.

Each segment is a separate MediaRecorder run, so it has its own WebM header and plays on its own.
Timeslice chunks from different runs cannot be concatenated into one playable file; starting a new
recorder is what makes the segments valid. Chunk keys embed the segment start time, and app startup
sweeps chunks older than 24 hours, so a tab closed mid-segment does not leak storage. The age guard
keeps chunks belonging to another tab that is still recording.

**Recording quality.** Settings → Clipping → **Recording quality** defaults to **Full HD**: the
HLS player drops `capLevelToPlayerSize`, caps automatic selection at the highest rendition at or
below 1080p while recording, and the encoders use 4 Mbps (rolling) and 4 Mbps (continuous). The cap
is applied with `autoLevelCapping`, not `currentLevel`, so ABR can still drop a level on a weak
connection instead of stalling while it refills a flushed buffer. **Smooth** restores the
old behavior: `capLevelToPlayerSize` on a 2x2 decode surface picks a low rendition, and both
encoders drop to 1.5 Mbps. Direct `.mp4`/`.webm`/`.mpg` sources are not ABR-limited, so Full HD only
raises their bitrate.

The cap is lifted when recording stops (`hls.autoLevelCapping = -1`). Full HD costs
more decode and encode work, so use Smooth if several 1080p tiles stutter.

## AI auto clip
Toggle **Viewer → AI auto clip**:
1. Record a 5-second audio-only chunk from the live stream.
2. Transcribe it with the selected local NeMo model on the GPU.
3. Ask the configured OpenAI-compatible model to score the moment.
4. If the score reaches the threshold (default 7/10), capture the rolling buffer into Clips with an `AI n/10` note.

Settings: **Settings → AI** (interval, threshold, prompt) and **Settings → Clipping** (stream limit).

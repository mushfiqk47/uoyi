# 10 — Record gallery: headless streams + clip gallery

Date: 2026-11-18 · Requested directly by the owner; follows the live-playback work in
[09](09-live-streams.md).

## Intent

Remove the real-time stream watching experience. Pasting a Kick/Twitch/YouTube link should put
that broadcast into the background: the app records it (per Settings), the AI listens on the
configured interval, high-scoring moments are saved to Clips automatically, and every recording
is visible in the **Records** tab laid out like a gallery. Hassle-free recording captures the whole
stream in real time and auto-saves a clip on a fixed interval. When two streams spike at the same
time, the AI clusters them as the *same moment* (shared card, both stream titles), so a raid, a
shared press-conference moment or twin co-casts clip from both sides.

How this compares to shipping products (research notes):

- ClipMe / Clyptaro / ChatClipThat all converge on "paste link → monitor → ranked moments → clip"
  with 1–10 scores and auto-save above a chosen threshold — exactly this design; ours stays local.
- None of them cluster *across parallel streams*; that is the differentiator here.

## Design

1. **Viewer becomes headless.** The screen keeps the paste-link input, the rolling buffer, the AI
   interval and the clip button per stream — but no video chrome, no bubbles, no grid. Each stream
   is a *status card* (title, platform, LIVE, buffer meter, AI state, “Clip now”, close). Decoding
   video elements stay mounted (hidden) because the rolling buffer and audio sampling need them.
2. **Records tab.** Gallery grid (same card language as Clips). It shows **continuous stream
   recordings only** (clips marked `recording`), newest first. AI picks and manual clips are not
   mixed in; they live in Clips. Grouped moments keep their `aiGroupId` on the clip and are marked
   as a multi-stream moment on the Clips card. Auto-save behaviour is unchanged: above your
   threshold in Settings → AI, clips land in Clips. (An earlier draft kept a separate
   `recommendations` history table; it duplicated clip data and was removed.)
3. **Clustering.** One extra AI call per interval pass, only when ≥2 streams in the same pass are
   clip-worthy: "which of these describe the same real-world moment?" → JSON groups. Members of a
   group share `groupId` and `streams[]`. The gallery merges them into one wider card listing both
   streams; each half still links to its own clip.
4. **Shared preview.** The clip-preview modal (with word-highlight captions) is extracted to
   `components/ClipPreviewModal.tsx`; Clips and Records both use it.

## Behavioural notes

- Records are history; there is no separate history record. The gallery reads the clips directly
  (`aiTitle`, `aiGroupId` and `recording` live on the clip). Removing a card soft-removes the
  recording. The **Removed** filter lists those recordings with **Restore** and **Delete for
  good**, plus a bulk **Delete all** that erases their videos and thumbnails.
- Deleting a clip removes it from everywhere; there is no side table to clean up.
- Each gallery card has a **Find clips** action. It loads that recording's blob, uploads it to the
  local API through `/api/upload`, and runs the shared `findClipsInMedia` pipeline used by the Clips
  screen's AI Clip Finder (transcript, scoring, `/api/clip/cut`). Recording jobs are stricter:
  they save at most 4 clips scoring 8 or higher, and the form cannot choose a larger count or a
  lower score. One qualifying clip is a complete result; the finder only fails when none reach
  the floor. The new clips are saved to Clips; the original recording stays in Records.
- Recordings survive without streams (history keeps `streamTitle`).
- Sub-second sync is not required for clustering; a single interval pass *is* the window.
- All AI/GPU work keeps the existing settings: `aiClipInterval` (3–15 min), `aiClipThreshold`.

## Out of scope (deliberately)

- Side-by-side duet rendering of one clip from two streams (a future editor feature).
- Selective per-stream AI (interval is global, as before).
- Push notifications for new recordings.

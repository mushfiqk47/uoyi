export type MediaKind = "video" | "audio" | "image";

export interface Media {
  id: string;
  name: string;
  kind: MediaKind;
  duration: number;
  width: number;
  height: number;
  /** IndexedDB key of the file's bytes. */
  blobKey: string;
}

/** A piece of footage on the video track. Clips play one after another. */
export interface VClip {
  id: string;
  mediaId: string;
  in: number;
  out: number;
  speed: number;
  volume: number;
}

/** A piece of music or sound placed at a time on the audio track. */
export interface AClip {
  id: string;
  mediaId: string;
  start: number;
  in: number;
  out: number;
  volume: number;
  /** Set when the app mirrored this sound from a video clip rather than the user adding it. */
  auto?: boolean;
}

export interface TextItem {
  id: string;
  text: string;
  start: number;
  end: number;
  /** 0..1 across the frame. */
  x: number;
  y: number;
  /** px on a 1080-wide frame. */
  size: number;
  color: string;
  font: CaptionFont;
  stroke: boolean;
  background: boolean;
  backgroundColor?: string;
}

export interface CaptionWord {
  id: string;
  text: string;
  start: number;
  end: number;
}

export type CaptionFont = "bebas" | "tiktok" | "inter";

export interface CaptionStyle {
  font: CaptionFont;
  size: number;
  color: string;
  highlight: string;
  stroke: boolean;
  caps: boolean;
  /** 0..1 down the frame. */
  y: number;
  wordsPerLine: number;
  background: boolean;
}

export type LayoutMode = "fill" | "fit" | "split";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  mode: LayoutMode;
  zoom: number;
  /** -1..1 pan of the main picture. */
  panX: number;
  panY: number;
  /** Normalised area of the source holding the facecam. */
  facecam: Rect;
  /** Share of the frame's height the facecam takes in split mode. */
  facecamShare: number;
}

export type OverlayPlatform = "off" | "tiktok" | "shorts" | "reels";

export interface Overlay {
  platform: OverlayPlatform;
  name: string;
  caption: string;
  song: string;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  verified: boolean;
}

export type PhoneStyle = "iphone" | "android";

export interface Look {
  layout: Layout;
  captionStyle: CaptionStyle;
  overlay: Overlay;
  texts: TextItem[];
}

export interface Project extends Look {
  version: 1;
  id: string;
  name: string;
  clipId: string | null;
  media: Media[];
  video: VClip[];
  music: AClip[];
  captions: CaptionWord[];
  templateId: string | null;
  updatedAt: number;
}

export interface ViralScoreBreakdown {
  hook: number;
  pacing: number;
  emotion: number;
  shareability: number;
}

export interface ViralDetails {
  hook: string;
  whyViral: string;
  platforms: string[];
  caption: string;
  hashtags: string[];
  editingTips: string;
  breakdown?: ViralScoreBreakdown;
}

export interface Clip {
  id: string;
  mediaId: string;
  blobKey: string;
  streamTitle: string;
  capturedAt: number;
  seconds: number;
  /** Where the wanted moment starts inside the recording. */
  in: number;
  duration: number;
  width: number;
  height: number;
  thumb: string | null;
  /** IndexedDB key of the thumbnail; newer clips leave `thumb` null. */
  thumbKey?: string | null;
  note: string;
  /** Set when this clip came from a continuous hassle-free recording (not a manual/AI clip). */
  recording?: boolean;
  /** Set when the AI auto clip finder saved this clip. */
  aiScore?: number;
  /** AI's pick title, when one was generated (auto-clip or Clip Finder). */
  aiTitle?: string;
  /** Shared id when the AI clusters the same moment across streams. */
  aiGroupId?: string;
  /** Titles of the streams in the cluster (length ≥ 2 when grouped). */
  aiGroupStreams?: string[];
  /** Word-level captions generated when the clip was added. */
  captions?: CaptionWord[];
  /** Detailed viral breakdown, hooks, hashtags, and editing tips from AI analysis. */
  viral?: ViralDetails;
  favourite: boolean;
  edited: boolean;
  renderedAt: number | null;
  removedAt: number | null;
}

export interface Stream {
  id: string;
  /** Playable URL used by the video element (often proxied / resolved). */
  url: string;
  /** Original user-entered link/page URL. */
  sourceUrl?: string;
  title: string;
  platform?: "youtube" | "twitch" | "kick" | "url";
  live?: boolean;
  openedAt: number;
}

export type JobStatus = "queued" | "rendering" | "paused" | "done" | "failed" | "cancelled";

export interface QueueJob {
  id: string;
  title: string;
  fileName: string;
  project: Project;
  duration: number;
  status: JobStatus;
  progress: number;
  fps: number;
  remaining: number;
  queuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  outputKey: string | null;
  mime: string | null;
  size: number;
  failure: string | null;
  /** How a finished render was handed to the system: normal download or chosen folder. */
  autoSaved?: "download" | "folder";
}

export interface Template extends Look {
  id: string;
  name: string;
  favorite: boolean;
  updatedAt: number;
}

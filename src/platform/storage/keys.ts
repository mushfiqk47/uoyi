/** Every persisted key in one place. Values are stable and must not be renamed casually. */
export const STORAGE_KEYS = {
  settings: "clipkit.settings.v1",
  screen: "clipkit.screen",
  streams: "clipkit.streams.v1",
  clips: "clipkit.clips.v1",
  templates: "clipkit.templates.v1",
  project: "clipkit.project.v1",
  projects: "clipkit.projects.v1",
} as const;

/** One-shot flags. Keeping them together makes migration order and leftovers visible. */
export const MIGRATIONS = {
  thumbs: "clipkit.thumbs.v1",
  recordingCaptions: "clipkit.recordings.noAutoCaptions.v1",
  aiInterval: "clipkit.settings.aiIntervalMinutes.v1",
  aiProfile: "clipkit.settings.aiProfile.v1",
  credentials: "clipkit.settings.credentials.cleared.v1",
  fps: "clipkit.settings.fps60.v1",
  recordSeconds: "clipkit.settings.recordSaveSeconds.v1",
  streamsReresolved: "clipkit.streams.reresolved.v1",
  legacyQueue: "clipkit.queue.v1",
  premadeTemplates: "clipkit.templates.premade.v1",
  defaultLayoutSplit: "clipkit.settings.defaultLayoutSplit.v1",
} as const;

"use strict";

// Long-lived state for one server process. Render sessions stay inside the legacy render route.
module.exports = {
  mediaJobs: new Map(), // id -> { id, status, file, err, title, url }
  clipFiles: new Map(), // id -> { id, file, duration, mime }
  modelJobs: new Map(), // id -> { status, log }
};

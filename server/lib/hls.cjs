"use strict";

function isPlaylist(contentType, href) {
  return /mpegurl/i.test(contentType) || /\.m3u8(\?|$)/i.test(href);
}

/** Rewrites a playlist so every segment, key, and init segment resolves through /stream. */
function rewritePlaylist(text, target) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        // Rewrite URI="..." inside keys/maps so decryption and init segments still resolve.
        return line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="/stream?url=${encodeURIComponent(new URL(uri, target).href)}"`);
      }
      return `/stream?url=${encodeURIComponent(new URL(trimmed, target).href)}`;
    })
    .join("\n");
}

module.exports = { isPlaylist, rewritePlaylist };

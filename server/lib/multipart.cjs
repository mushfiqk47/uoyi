"use strict";

/** Streams a multipart body, handing each file part its own writable stream. */
async function readMultipart(req, boundary, { onFile, onField }) {
  const dash = Buffer.from(`--${boundary}`);
  const delim = Buffer.from(`\r\n--${boundary}`);
  const tail = delim.length + 8;
  let buf = Buffer.alloc(0);
  let state = "preamble";
  let sink = null;
  let fieldName = "";
  let fieldChunks = [];

  const writeAll = (w, data) =>
    new Promise((resolve, reject) => w.write(data, (e) => (e ? reject(e) : resolve())));
  const endSink = (w) => new Promise((resolve, reject) => w.end((e) => (e ? reject(e) : resolve())));

  const pushBody = async (data) => {
    if (!data.length) return;
    if (sink) await writeAll(sink, data);
    else fieldChunks.push(data);
  };

  for await (const chunk of req) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (state === "preamble") {
        const at = buf.indexOf(dash);
        if (at < 0) {
          if (buf.length > 4096) buf = buf.subarray(buf.length - 4096);
          break;
        }
        buf = buf.subarray(at + dash.length);
        state = "boundary";
      }
      if (state === "boundary") {
        if (buf.length < 2) break;
        if (buf[0] === 0x2d && buf[1] === 0x2d) {
          state = "done";
          buf = Buffer.alloc(0);
          break;
        }
        if (buf[0] === 0x0d && buf[1] === 0x0a) buf = buf.subarray(2);
        state = "headers";
      }
      if (state === "headers") {
        const end = buf.indexOf("\r\n\r\n");
        if (end < 0) {
          if (buf.length > 65536) throw new Error("Multipart header is too large");
          break;
        }
        const raw = buf.subarray(0, end).toString("utf8");
        buf = buf.subarray(end + 4);
        const disposition = /content-disposition:([^\r\n]*)/i.exec(raw)?.[1] ?? "";
        fieldName = /name="([^"]*)"/i.exec(disposition)?.[1] ?? "";
        const filename = /filename="([^"]*)"/i.exec(disposition)?.[1];
        fieldChunks = [];
        sink = filename === undefined ? null : onFile({ name: fieldName, filename });
        state = "body";
      }
      if (state === "body") {
        const at = buf.indexOf(delim);
        if (at >= 0) {
          await pushBody(buf.subarray(0, at));
          buf = buf.subarray(at + delim.length);
          if (sink) {
            await endSink(sink);
            sink = null;
          } else {
            onField(fieldName, Buffer.concat(fieldChunks).toString("utf8"));
          }
          fieldChunks = [];
          state = "boundary";
          continue;
        }
        if (buf.length > tail) {
          await pushBody(buf.subarray(0, buf.length - tail));
          buf = buf.subarray(buf.length - tail);
        }
        break;
      }
      break;
    }
    if (state === "done") break;
  }

  // A body cut short still leaves a usable file; close it so ffmpeg can read it.
  if (sink) await endSink(sink);
}

function boundaryOf(req) {
  const type = req.headers["content-type"] || "";
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type);
  const boundary = m?.[1] || m?.[2]?.trim();
  if (!/multipart\/form-data/i.test(type) || !boundary) return null;
  return boundary;
}

module.exports = { readMultipart, boundaryOf };

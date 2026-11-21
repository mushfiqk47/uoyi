"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Readable, Writable } = require("node:stream");
const { readMultipart, boundaryOf } = require("./multipart.cjs");

test("boundaryOf reads quoted and unquoted boundaries", () => {
  assert.equal(boundaryOf({ headers: { "content-type": "multipart/form-data; boundary=abc" } }), "abc");
  assert.equal(boundaryOf({ headers: { "content-type": 'multipart/form-data; boundary="a b"' } }), "a b");
  assert.equal(boundaryOf({ headers: { "content-type": "application/json" } }), null);
  assert.equal(boundaryOf({ headers: {} }), null);
});

test("readMultipart delivers fields and file bytes in order", async () => {
  const boundary = "BOUND";
  const fileBytes = Buffer.from([0x00, 0x01, 0x02, 0xff]);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="fps"\r\n\r\n60\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="frames"; filename="f000001.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
    fileBytes,
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\nhello\r\n`),
    Buffer.from(`--${boundary}--\r\n`),
  ]);

  const fields = {};
  const files = [];
  await readMultipart(Readable.from([body]), boundary, {
    onFile({ name, filename }) {
      const chunks = [];
      return new Writable({
        write(chunk, _enc, cb) {
          chunks.push(chunk);
          cb();
        },
        final(cb) {
          files.push({ name, filename, bytes: Buffer.concat(chunks) });
          cb();
        },
      });
    },
    onField(name, value) {
      fields[name] = value;
    },
  });

  assert.deepEqual(fields, { fps: "60", note: "hello" });
  assert.equal(files.length, 1);
  assert.equal(files[0].name, "frames");
  assert.equal(files[0].filename, "f000001.jpg");
  assert.deepEqual(files[0].bytes, fileBytes);
});

#!/usr/bin/env node
// Minimal MKV header probe — walks the first 4 MB of a file and dumps every
// TrackEntry it finds. Self-contained EBML walker; no project imports so it
// runs as plain `.mjs` under Node without a TS loader.
//
// Usage:  node scripts/probe-mkv.mjs "<path/to/file.mkv>"

import { openSync, readSync, closeSync, statSync } from "node:fs";

const HEADER_BYTES = 4 * 1024 * 1024;

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  Info: 0x1549a966,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  Name: 0x536e,
  Language: 0x22b59c,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  DefaultDuration: 0x23e383,
  FlagDefault: 0x88,
  FlagForced: 0x55aa,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  Audio: 0xe1,
  SamplingFrequency: 0xb5,
  Channels: 0x9f,
  BitDepth: 0x6264,
  TimecodeScale: 0x2ad7b1,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  Duration: 0x4489,
};

const LACING_NAMES = { 0: "none", 1: "Xiph", 2: "fixed", 3: "EBML" };

const TRACK_TYPE = { 1: "video", 2: "audio", 0x10: "logo", 0x11: "subtitle" };

function vintLen(b) {
  if (b === 0) throw new Error("invalid VINT");
  let len = 1, m = 0x80;
  while ((b & m) === 0) { len++; m >>= 1; if (len > 8) throw new Error("VINT > 8"); }
  return len;
}

function readVint(buf, off) {
  const first = buf[off];
  const len = vintLen(first);
  const mask = 0x80 >> (len - 1);
  let v = first & (mask - 1);
  for (let i = 1; i < len; i++) v = v * 0x100 + buf[off + i];
  return { value: v, length: len };
}

// SimpleBlock track-number VINT — same encoding as readVint above.
function readVintBlock(buf, off) {
  return readVint(buf, off);
}

function readId(buf, off) {
  const first = buf[off];
  const len = vintLen(first);
  let v = first;
  for (let i = 1; i < len; i++) v = v * 0x100 + buf[off + i];
  return { value: v, length: len };
}

function readSize(buf, off) {
  const r = readVint(buf, off);
  const maxVal = Math.pow(2, r.length * 7) - 1;
  if (r.value >= maxVal) return { value: -1, length: r.length };
  return r;
}

function readEl(buf, off) {
  if (off >= buf.length || buf[off] === 0) return null;
  const id = readId(buf, off);
  const sizeOff = off + id.length;
  if (sizeOff >= buf.length) return null;
  const size = readSize(buf, sizeOff);
  const dataOff = sizeOff + size.length;
  const dataLen = size.value === -1 ? Math.max(0, buf.length - dataOff) : size.value;
  const clampedLen = Math.min(dataLen, buf.length - dataOff);
  return {
    id: id.value,
    dataOffset: dataOff,
    dataLength: clampedLen,
    elementLength: id.length + size.length + clampedLen,
    fullDataLength: size.value,
  };
}

function* iterate(buf, start, end) {
  let off = start;
  while (off < end && off < buf.length) {
    if (buf[off] === 0) { off++; continue; }
    const el = readEl(buf, off);
    if (!el) break;
    yield el;
    off += el.elementLength;
  }
}

function readUint(buf, off, len) {
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 0x100 + buf[off + i];
  return v;
}

function readFloat(buf, off, len) {
  const dv = new DataView(buf.buffer, buf.byteOffset + off, len);
  if (len === 4) return dv.getFloat32(0, false);
  if (len === 8) return dv.getFloat64(0, false);
  return 0;
}

function readString(buf, off, len) {
  let end = off + len;
  while (end > off && buf[end - 1] === 0) end--;
  return Buffer.from(buf.buffer, buf.byteOffset + off, end - off).toString("utf-8");
}

function parseTrackEntry(buf, entry) {
  const t = {
    trackNumber: 0,
    trackType: 0,
    codecId: "",
    codecPrivateLen: 0,
    name: "",
    language: "und",
    defaultDurationNs: 0,
    flagDefault: 1,
    flagForced: 0,
    width: 0,
    height: 0,
    sampleRate: 0,
    channels: 0,
    bitDepth: 0,
  };
  const end = Math.min(buf.length, entry.dataOffset + entry.dataLength);
  for (const f of iterate(buf, entry.dataOffset, end)) {
    switch (f.id) {
      case ID.TrackNumber: t.trackNumber = readUint(buf, f.dataOffset, f.dataLength); break;
      case ID.TrackType:   t.trackType = readUint(buf, f.dataOffset, f.dataLength); break;
      case ID.CodecID:     t.codecId = readString(buf, f.dataOffset, f.dataLength); break;
      case ID.CodecPrivate: t.codecPrivateLen = f.dataLength; break;
      case ID.Name:        t.name = readString(buf, f.dataOffset, f.dataLength); break;
      case ID.Language:    t.language = readString(buf, f.dataOffset, f.dataLength); break;
      case ID.DefaultDuration: t.defaultDurationNs = readUint(buf, f.dataOffset, f.dataLength); break;
      case ID.FlagDefault: t.flagDefault = readUint(buf, f.dataOffset, f.dataLength); break;
      case ID.FlagForced:  t.flagForced = readUint(buf, f.dataOffset, f.dataLength); break;
      case ID.Video: {
        const ve = Math.min(buf.length, f.dataOffset + f.dataLength);
        for (const v of iterate(buf, f.dataOffset, ve)) {
          if (v.id === ID.PixelWidth) t.width = readUint(buf, v.dataOffset, v.dataLength);
          if (v.id === ID.PixelHeight) t.height = readUint(buf, v.dataOffset, v.dataLength);
        }
        break;
      }
      case ID.Audio: {
        const ae = Math.min(buf.length, f.dataOffset + f.dataLength);
        for (const a of iterate(buf, f.dataOffset, ae)) {
          if (a.id === ID.SamplingFrequency) t.sampleRate = readFloat(buf, a.dataOffset, a.dataLength);
          if (a.id === ID.Channels)          t.channels   = readUint(buf, a.dataOffset, a.dataLength);
          if (a.id === ID.BitDepth)          t.bitDepth   = readUint(buf, a.dataOffset, a.dataLength);
        }
        break;
      }
    }
  }
  return t;
}

function probe(path) {
  const fileSize = statSync(path).size;
  const buf = Buffer.alloc(Math.min(HEADER_BYTES, fileSize));
  const fd = openSync(path, "r");
  try { readSync(fd, buf, 0, buf.length, 0); } finally { closeSync(fd); }
  const view = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

  const ebml = readEl(view, 0);
  if (!ebml || ebml.id !== ID.EBML) throw new Error("Not an MKV/EBML file");

  let off = ebml.elementLength;
  let segment = null;
  while (off < view.length) {
    const el = readEl(view, off);
    if (!el) throw new Error("Segment not found");
    if (el.id === ID.Segment) { segment = el; break; }
    off += el.elementLength;
  }
  if (!segment) throw new Error("No Segment");

  const segEnd = Math.min(view.length, segment.dataOffset + segment.dataLength);
  let timecodeScaleNs = 1_000_000;
  let durationRaw = 0;
  const tracks = [];

  for (const el of iterate(view, segment.dataOffset, segEnd)) {
    if (el.id === ID.Info) {
      const ie = Math.min(view.length, el.dataOffset + el.dataLength);
      for (const c of iterate(view, el.dataOffset, ie)) {
        if (c.id === ID.TimecodeScale) timecodeScaleNs = readUint(view, c.dataOffset, c.dataLength);
        if (c.id === ID.Duration) durationRaw = readFloat(view, c.dataOffset, c.dataLength);
      }
    }
    if (el.id === ID.Tracks) {
      const te = Math.min(view.length, el.dataOffset + el.dataLength);
      for (const entry of iterate(view, el.dataOffset, te)) {
        if (entry.id === ID.TrackEntry) tracks.push(parseTrackEntry(view, entry));
      }
    }
    if (el.id === ID.Cluster) break;
  }

  const durationMs = (durationRaw * timecodeScaleNs) / 1_000_000;
  const durSec = durationMs / 1000;
  const hh = Math.floor(durSec / 3600);
  const mm = Math.floor((durSec % 3600) / 60);
  const ss = Math.floor(durSec % 60);

  console.log("");
  console.log("File:        " + path);
  console.log("Size:        " + (fileSize / 1024 / 1024).toFixed(1) + " MB");
  console.log("Duration:    " + `${hh}h ${mm}m ${ss}s` + ` (${durSec.toFixed(1)} s)`);
  console.log("Timecode:    " + (timecodeScaleNs / 1_000_000) + " ms / tick");
  console.log("Tracks:      " + tracks.length);
  console.log("");

  for (const t of tracks) {
    const type = TRACK_TYPE[t.trackType] || `unknown(${t.trackType})`;
    console.log(`  Track #${t.trackNumber} [${type}]`);
    console.log(`    codec:    ${t.codecId}` + (t.codecPrivateLen ? `  (CodecPrivate ${t.codecPrivateLen} B)` : "  (no CodecPrivate)"));
    console.log(`    name:     ${t.name || "<none>"}`);
    console.log(`    language: ${t.language}`);
    console.log(`    flags:    default=${t.flagDefault} forced=${t.flagForced}`);
    if (t.trackType === 1) {
      console.log(`    video:    ${t.width}x${t.height}` + (t.defaultDurationNs ? `  @ ${(1e9 / t.defaultDurationNs).toFixed(3)} fps` : ""));
    }
    if (t.trackType === 2) {
      console.log(`    audio:    ${t.sampleRate.toFixed(0)} Hz  ${t.channels}ch` + (t.bitDepth ? `  ${t.bitDepth}-bit` : ""));
    }
    if (t.defaultDurationNs > 0) {
      console.log(`    defaultDur: ${(t.defaultDurationNs / 1_000_000).toFixed(3)} ms` +
        (t.trackType === 2
          ? `  (= ${Math.round((t.defaultDurationNs / 1e9) * t.sampleRate)} samples @ ${t.sampleRate.toFixed(0)} Hz)`
          : ""));
    }
    console.log("");
  }

  // Inspect the first audio SimpleBlock of each audio track — flags byte
  // reveals whether the muxer used lacing, and the first 16 bytes of the
  // frame body show whether sample.data begins with a FLAC/AAC sync word
  // (good) or lacing-header bytes (bad: parseSimpleBlock would feed garbage
  // to the decoder).
  const audioTracksList = tracks.filter((t) => t.trackType === 2);
  const audioTrackNumbers = new Set(audioTracksList.map((t) => t.trackNumber));
  const firstBlockSeen = new Map();
  for (const el of iterate(view, segment.dataOffset, segEnd)) {
    if (el.id !== ID.Cluster) continue;
    const cEnd = Math.min(view.length, el.dataOffset + el.dataLength);
    for (const child of iterate(view, el.dataOffset, cEnd)) {
      if (child.id !== ID.SimpleBlock) continue;
      const trackVint = readVintBlock(view, child.dataOffset);
      const trackNum = trackVint.value;
      if (!audioTrackNumbers.has(trackNum) || firstBlockSeen.has(trackNum)) continue;
      const flagsOff = child.dataOffset + trackVint.length + 2; // skip track + 2-byte timecode
      const flagsByte = view[flagsOff];
      const lacing = (flagsByte >> 1) & 0x03;
      const dataStart = flagsOff + 1;
      const bytes = Array.from(view.subarray(dataStart, dataStart + 16))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ");
      firstBlockSeen.set(trackNum, { flagsByte, lacing, bytes });
    }
    if (firstBlockSeen.size === audioTrackNumbers.size) break;
  }
  console.log("Audio first-block diagnostics:");
  for (const [tn, info] of firstBlockSeen) {
    console.log(
      `  Track #${tn}: flags=0x${info.flagsByte.toString(16).padStart(2, "0")} ` +
      `lacing=${info.lacing} (${LACING_NAMES[info.lacing]})  ` +
      `firstBytes=[${info.bytes}]`,
    );
  }
  if (firstBlockSeen.size === 0) {
    console.log("  (no audio SimpleBlocks in header buffer; would need a deeper read)");
  }
  console.log("");

  // Nyrima-specific verdict
  const audio = tracks.filter((t) => t.trackType === 2);
  const video = tracks.find((t) => t.trackType === 1);
  console.log("Nyrima audio-switch matrix:");
  const REMUXABLE = new Set(["A_AAC", "A_FLAC", "A_OPUS", "A_AC3"]);
  for (const t of audio) {
    const codecBase = t.codecId.startsWith("A_AAC") ? "A_AAC" : t.codecId;
    const remuxable = REMUXABLE.has(codecBase);
    const isHevc = video?.codecId === "V_MPEGH/ISO/HEVC";
    const chromeRefuses = isHevc && codecBase === "A_AC3";
    const label = t.name || t.language;
    console.log(
      `  - Track #${t.trackNumber} (${label}, ${t.codecId})  ` +
      `remuxable=${remuxable ? "yes" : "NO "}  ` +
      `chrome-mse-hevc-combo=${chromeRefuses ? "REFUSED" : "ok"}`,
    );
  }
  console.log("");
}

const arg = process.argv[2];
if (!arg) {
  console.error("usage: node scripts/probe-mkv.mjs <path-to.mkv>");
  process.exit(2);
}
probe(arg);

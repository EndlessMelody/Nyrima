import { describe, expect, it } from "vitest";
import { extractEmbeddedFlacMetadata, findSiblingCover, parseAudioFormatInfo } from "./music-source";
import type { DriveFile } from "@shared/types";

function file(name: string, extra: Partial<DriveFile> = {}): DriveFile {
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name,
    mimeType: "image/jpeg",
    ...extra,
  };
}

describe("music source helpers", () => {
  it("finds a user-provided cover.jpg in the track folder", () => {
    const cover = file("cover.JPG", { id: "cover-id", thumbnailLink: "thumb-url" });

    expect(findSiblingCover([file("01 - song.flac"), cover])?.id).toBe("cover-id");
  });

  it("prefers exact cover art over looser artwork names", () => {
    const loose = file("front-cover.jpg", { id: "loose", thumbnailLink: "loose-url" });
    const exact = file("cover.jpg", { id: "exact", thumbnailLink: "exact-url" });

    expect(findSiblingCover([loose, exact])?.id).toBe("exact");
  });

  it("returns null when no displayable cover file is present", () => {
    expect(
      findSiblingCover([
        file("cover.txt", { mimeType: "text/plain" }),
        file("folder.jpg", { thumbnailLink: "folder-thumb" }),
        file("cover.jpg"),
      ]),
    ).toBeNull();
  });

  it("extracts embedded FLAC lyrics from Vorbis comments", async () => {
    const bytes = makeFlac([
      metadataBlock(0, new Uint8Array(34)),
      metadataBlock(4, vorbisComment(["LYRICS=[00:01.50]wake up\\n[00:03.00]sing"])),
    ]);

    const embedded = extractEmbeddedFlacMetadata(bytes);

    expect(embedded.lyricsText).toBe("[00:01.50]wake up\\n[00:03.00]sing");
  });

  it("prefers full unsynced FLAC lyrics over synced karaoke lyrics", async () => {
    const bytes = makeFlac([
      metadataBlock(0, new Uint8Array(34)),
      metadataBlock(4, vorbisComment([
        "SYNCEDLYRICS=[00:01.00]<00:01.20>short",
        "UNSYNCEDLYRICS=full lyric text",
      ])),
    ]);

    const embedded = extractEmbeddedFlacMetadata(bytes);

    expect(embedded.lyricsText).toBe("full lyric text");
  });

  it("extracts embedded FLAC picture data", async () => {
    const imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xdb]);
    const bytes = makeFlac([
      metadataBlock(0, new Uint8Array(34)),
      metadataBlock(6, pictureBlock("image/jpeg", imageBytes)),
    ]);

    const embedded = extractEmbeddedFlacMetadata(bytes);

    expect(embedded.picture?.mimeType).toBe("image/jpeg");
    expect(embedded.picture?.blob.size).toBe(imageBytes.length);
  });

  it("ignores non-FLAC bytes for embedded metadata extraction", () => {
    expect(extractEmbeddedFlacMetadata(new Uint8Array([0, 1, 2]))).toEqual({});
  });

  it("parses sample rate / bit depth / channels from FLAC STREAMINFO", () => {
    const bytes = makeFlac([metadataBlock(0, streamInfoBlock(96000, 2, 24))]);

    expect(parseAudioFormatInfo(bytes)).toEqual({
      sampleRate: 96000,
      channels: 2,
      bitsPerSample: 24,
    });
  });

  it("returns null when FLAC STREAMINFO has a zero sample rate", () => {
    const bytes = makeFlac([metadataBlock(0, new Uint8Array(34))]);

    expect(parseAudioFormatInfo(bytes)).toBeNull();
  });

  it("parses sample rate / bit depth / channels from a WAV fmt chunk", () => {
    const bytes = wavFile(44100, 2, 16);

    expect(parseAudioFormatInfo(bytes)).toEqual({
      sampleRate: 44100,
      channels: 2,
      bitsPerSample: 16,
    });
  });

  it("returns null for bytes that are neither FLAC nor WAV", () => {
    expect(parseAudioFormatInfo(new Uint8Array([0, 1, 2, 3]))).toBeNull();
  });
});

function makeFlac(blocks: Uint8Array[]): Uint8Array {
  const header = new TextEncoder().encode("fLaC");
  const total = header.length + blocks.reduce((sum, block) => sum + block.length, 0);
  const out = new Uint8Array(total);
  out.set(header, 0);
  let offset = header.length;
  blocks.forEach((block, index) => {
    const copy = new Uint8Array(block);
    if (index === blocks.length - 1) copy[0] |= 0x80;
    out.set(copy, offset);
    offset += copy.length;
  });
  return out;
}

function metadataBlock(type: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + data.length);
  out[0] = type & 0x7f;
  out[1] = (data.length >> 16) & 0xff;
  out[2] = (data.length >> 8) & 0xff;
  out[3] = data.length & 0xff;
  out.set(data, 4);
  return out;
}

function vorbisComment(comments: string[]): Uint8Array {
  const encoder = new TextEncoder();
  const vendor = encoder.encode("Nyrima");
  const encodedComments = comments.map((comment) => encoder.encode(comment));
  const length =
    4 +
    vendor.length +
    4 +
    encodedComments.reduce((sum, comment) => sum + 4 + comment.length, 0);
  const out = new Uint8Array(length);
  const view = new DataView(out.buffer);
  let offset = 0;
  view.setUint32(offset, vendor.length, true);
  offset += 4;
  out.set(vendor, offset);
  offset += vendor.length;
  view.setUint32(offset, encodedComments.length, true);
  offset += 4;
  for (const comment of encodedComments) {
    view.setUint32(offset, comment.length, true);
    offset += 4;
    out.set(comment, offset);
    offset += comment.length;
  }
  return out;
}

/** Builds a 34-byte FLAC STREAMINFO block encoding the given format fields. */
function streamInfoBlock(sampleRate: number, channels: number, bitsPerSample: number): Uint8Array {
  const block = new Uint8Array(34);
  const sampleRateLow = sampleRate & 0x0f;
  const channelsMinusOne = (channels - 1) & 0x07;
  const bitsMinusOne = (bitsPerSample - 1) & 0x1f;
  block[10] = (sampleRate >> 12) & 0xff;
  block[11] = (sampleRate >> 4) & 0xff;
  block[12] = (sampleRateLow << 4) | (channelsMinusOne << 1) | (bitsMinusOne >> 4);
  block[13] = (bitsMinusOne & 0x0f) << 4;
  return block;
}

/** Builds a minimal 44-byte WAV header (RIFF/WAVE/fmt /empty data). */
function wavFile(sampleRate: number, channels: number, bitsPerSample: number): Uint8Array {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const out = new Uint8Array(44);
  const view = new DataView(out.buffer);
  const ascii = new TextEncoder();
  out.set(ascii.encode("RIFF"), 0);
  view.setUint32(4, 36, true);
  out.set(ascii.encode("WAVE"), 8);
  out.set(ascii.encode("fmt "), 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  out.set(ascii.encode("data"), 36);
  view.setUint32(40, 0, true);
  return out;
}

function pictureBlock(mimeType: string, data: Uint8Array): Uint8Array {
  const encoder = new TextEncoder();
  const mime = encoder.encode(mimeType);
  const description = new Uint8Array();
  const out = new Uint8Array(32 + mime.length + description.length + data.length);
  const view = new DataView(out.buffer);
  let offset = 0;
  view.setUint32(offset, 3, false);
  offset += 4;
  view.setUint32(offset, mime.length, false);
  offset += 4;
  out.set(mime, offset);
  offset += mime.length;
  view.setUint32(offset, description.length, false);
  offset += 4;
  offset += description.length;
  view.setUint32(offset, 300, false);
  offset += 4;
  view.setUint32(offset, 300, false);
  offset += 4;
  view.setUint32(offset, 24, false);
  offset += 4;
  view.setUint32(offset, 0, false);
  offset += 4;
  view.setUint32(offset, data.length, false);
  offset += 4;
  out.set(data, offset);
  return out;
}

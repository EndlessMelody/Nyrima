import { afterEach, describe, expect, it, vi } from "vitest";
import { authedFetch } from "../auth";
import { MkvMseController } from "./mse-controller";
import type { MkvMediaInfo } from "./types";

vi.mock("../auth", () => ({
  authedFetch: vi.fn(),
}));

const INFO: MkvMediaInfo = {
  timecodeScaleNs: 1_000_000,
  durationMs: 10_000,
  video: {
    trackNumber: 1,
    codec: "hevc",
    codecPrivate: new Uint8Array(0),
    width: 1920,
    height: 1080,
    defaultDurationNs: 41_708_333,
  },
  audio: {
    trackNumber: 2,
    codec: "opus",
    codecPrivate: new Uint8Array(0),
    sampleRate: 48000,
    channels: 2,
    defaultDurationNs: 20_000_000,
    language: "jpn",
    name: "Japanese",
  },
  audioTracks: [],
  firstClusterOffset: 0,
};

interface TestableController {
  info: MkvMediaInfo | null;
  nextChunkFileOffset: number;
  leftoverBuf: Uint8Array | null;
  partialCluster: unknown;
  videoElement: { currentTime: number } | null;
  videoSourceBuffer: { buffered: TimeRanges } | null;
  audioSourceBuffer: { buffered: TimeRanges } | null;
  getPlayableBufferEnd(): number;
  processChunk(data: Uint8Array): Promise<void>;
}

function element(id: number, payload: Uint8Array): Uint8Array {
  return new Uint8Array([id, 0x80 | payload.length, ...payload]);
}

function unknownSizeCluster(payload: Uint8Array): Uint8Array {
  return new Uint8Array([
    0x1f, 0x43, 0xb6, 0x75,
    0xff,
    ...payload,
  ]);
}

function simpleBlock(trackNumber: number, frame: number[]): Uint8Array {
  return element(
    0xa3,
    new Uint8Array([
      0x80 | trackNumber,
      0x00, 0x00,
      0x80,
      ...frame,
    ]),
  );
}

function ranges(values: Array<[number, number]>): TimeRanges {
  return {
    length: values.length,
    start: (index: number) => values[index][0],
    end: (index: number) => values[index][1],
  } as TimeRanges;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MkvMseController partial cluster streaming", () => {
  it("does not treat audio-only lead as playable A/V buffer", () => {
    const controller = new MkvMseController() as unknown as TestableController;
    controller.videoElement = { currentTime: 16.3 };
    controller.videoSourceBuffer = {
      buffered: ranges([
        [13.4, 15.9],
        [16.6, 19.7],
      ]),
    };
    controller.audioSourceBuffer = {
      buffered: ranges([[16.2, 842.1]]),
    };

    expect(controller.getPlayableBufferEnd()).toBe(0);
  });

  it("drops misaligned payload bytes when a full buffer does not parse as EBML", async () => {
    const controller = new MkvMseController() as unknown as TestableController;
    controller.info = INFO;
    controller.nextChunkFileOffset = 33_028_700;
    const data = new Uint8Array([
      0x2c, 0x39, 0x9a, 0x00,
      0xee, 0xe2, 0x3f, 0x4d,
      0xa6, 0x02, 0x2a, 0xb3,
      0xe5, 0x27, 0xd0, 0xab,
    ]);

    await controller.processChunk(data);

    expect(controller.partialCluster).toBeNull();
    expect(controller.leftoverBuf).toEqual(data.slice(data.length - 3));
    expect(controller.nextChunkFileOffset).toBe(
      33_028_700 + data.length - 3,
    );
  });

  it("resyncs from misaligned payload bytes to the next Cluster", async () => {
    const controller = new MkvMseController() as unknown as TestableController;
    controller.info = INFO;
    controller.nextChunkFileOffset = 50_000;
    const junk = new Uint8Array([
      0x2c, 0x39, 0x9a, 0x00,
      0xee, 0xe2, 0x3f, 0x4d,
      0xa6, 0x02, 0x2a, 0xb3,
      0xe5, 0x27, 0xd0, 0xab,
    ]);
    const emptyCluster = new Uint8Array([
      0x1f, 0x43, 0xb6, 0x75,
      0x80,
    ]);
    const data = new Uint8Array([...junk, ...emptyCluster]);

    await controller.processChunk(data);

    expect(controller.partialCluster).toBeNull();
    expect(controller.leftoverBuf).toBeNull();
    expect(controller.nextChunkFileOffset).toBe(50_000 + data.length);
  });

  it("preserves an unfinished child when an unknown-size Cluster crosses a chunk boundary", async () => {
    const controller = new MkvMseController() as unknown as TestableController;
    controller.info = INFO;
    controller.nextChunkFileOffset = 1_000;

    const timecode = element(0xe7, new Uint8Array([0x05]));
    const completeOtherTrackBlock = simpleBlock(9, [0x11, 0x22]);
    const unfinishedBlock = simpleBlock(9, [0x33, 0x44]).subarray(0, 7);
    const payload = new Uint8Array([
      ...timecode,
      ...completeOtherTrackBlock,
      ...unfinishedBlock,
    ]);

    await controller.processChunk(unknownSizeCluster(payload));

    expect(controller.partialCluster).not.toBeNull();
    expect(controller.leftoverBuf).toEqual(unfinishedBlock);
    expect(controller.nextChunkFileOffset).toBe(
      1_000 + 5 + timecode.length + completeOtherTrackBlock.length,
    );
  });

  it("keeps the cluster index sorted when the media stream restarts backward", () => {
    const controller = new MkvMseController() as unknown as {
      clusterIndex: Array<{
        fileOffset: number;
        ptsMs: number;
        hasVideoKeyframe: boolean;
      }>;
      recordClusterIndex(entry: {
        fileOffset: number;
        ptsMs: number;
        hasVideoKeyframe: boolean;
      }): void;
    };

    controller.recordClusterIndex({
      fileOffset: 9_000,
      ptsMs: 9_000,
      hasVideoKeyframe: false,
    });
    controller.recordClusterIndex({
      fileOffset: 3_000,
      ptsMs: 3_000,
      hasVideoKeyframe: true,
    });
    controller.recordClusterIndex({
      fileOffset: 9_000,
      ptsMs: 9_000,
      hasVideoKeyframe: true,
    });

    expect(controller.clusterIndex).toEqual([
      { fileOffset: 3_000, ptsMs: 3_000, hasVideoKeyframe: true },
      { fileOffset: 9_000, ptsMs: 9_000, hasVideoKeyframe: true },
    ]);
  });
});

describe("MkvMseController external-audio media seek recovery", () => {
  it("does not restart normal streaming when recovery leaves the target unbuffered", async () => {
    const controller = new MkvMseController() as unknown as {
      info: MkvMediaInfo | null;
      fileId: string;
      fileSize: number;
      fetchOffset: number;
      audioCatchUpSerial: number;
      clusterIndex: Array<{
        fileOffset: number;
        ptsMs: number;
        hasVideoKeyframe: boolean;
      }>;
      prepareVideoSeekAppend: ReturnType<typeof vi.fn>;
      processChunk: ReturnType<typeof vi.fn>;
      waitForVideoBufferedAt: ReturnType<typeof vi.fn>;
      requestStreamRestart: ReturnType<typeof vi.fn>;
      startMediaSeekCatchUp(playheadMs: number, serial: number): Promise<void>;
    };
    controller.info = INFO;
    controller.fileId = "1AbCdEfGhIjKlMnOpQrStUvWxYz";
    controller.fileSize = 80_000;
    controller.fetchOffset = 70_000;
    controller.audioCatchUpSerial = 4;
    controller.clusterIndex = [
      { fileOffset: 10_000, ptsMs: 1_000, hasVideoKeyframe: true },
      { fileOffset: 30_000, ptsMs: 4_000, hasVideoKeyframe: true },
    ];
    controller.prepareVideoSeekAppend = vi.fn(async () => undefined);
    controller.processChunk = vi.fn(async () => undefined);
    controller.waitForVideoBufferedAt = vi.fn(async () => false);
    controller.requestStreamRestart = vi.fn();
    vi.mocked(authedFetch).mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3])),
    );

    await controller.startMediaSeekCatchUp(5_000, 4);

    expect(controller.requestStreamRestart).not.toHaveBeenCalled();
  });
});

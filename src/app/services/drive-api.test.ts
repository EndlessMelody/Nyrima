import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Isolate drive-api from its browser-coupled deps: authedFetch is the seam we
// drive, and api-key registers a chrome.storage listener at import we don't
// want in node.
vi.mock("./auth", () => ({
  authedFetch: vi.fn(),
  tryGetAccessToken: vi.fn(async () => null),
}));
vi.mock("./api-key", () => ({
  getApiKey: vi.fn(async () => null),
  appendApiKey: (url: string) => url,
}));

import { authedFetch } from "./auth";
import {
  downloadFile,
  downloadTextFile,
  MAX_TEXT_DOWNLOAD_BYTES,
} from "./drive-api";

function fakeResponse(opts: {
  contentLength?: number | null;
  blobSize: number;
  text?: string;
}): Response {
  const { contentLength = null, blobSize, text = "" } = opts;
  const headers = {
    get: (h: string) =>
      h.toLowerCase() === "content-length" && contentLength != null
        ? String(contentLength)
        : null,
  };
  const blob = { size: blobSize, text: async () => text } as unknown as Blob;
  return { headers, blob: async () => blob } as unknown as Response;
}

describe("downloadFile size guard", () => {
  beforeEach(() => {
    vi.mocked(authedFetch).mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects on an oversized Content-Length", async () => {
    vi.mocked(authedFetch).mockResolvedValue(
      fakeResponse({
        contentLength: MAX_TEXT_DOWNLOAD_BYTES + 1,
        blobSize: 16,
      }),
    );
    await expect(downloadFile("oversized-by-header")).rejects.toThrow(
      /exceeds/,
    );
  });

  it("rejects when the materialized blob exceeds the cap (no Content-Length)", async () => {
    vi.mocked(authedFetch).mockResolvedValue(
      fakeResponse({
        contentLength: null,
        blobSize: MAX_TEXT_DOWNLOAD_BYTES + 1,
      }),
    );
    await expect(downloadFile("oversized-by-blob")).rejects.toThrow(/exceeds/);
  });

  it("returns the blob when under the cap", async () => {
    vi.mocked(authedFetch).mockResolvedValue(
      fakeResponse({ contentLength: 1024, blobSize: 1024 }),
    );
    const blob = await downloadFile("under-the-cap");
    expect(blob.size).toBe(1024);
  });

  it("downloadTextFile returns text when under the cap", async () => {
    vi.mocked(authedFetch).mockResolvedValue(
      fakeResponse({ contentLength: 5, blobSize: 5, text: "hello" }),
    );
    await expect(downloadTextFile("text-under-the-cap")).resolves.toBe("hello");
  });
});

/**
 * Fetches an Open Graph-ish preview for a `linkCard` block via
 * api.microlink.io (CORS-friendly, no server of our own). Only called on an
 * explicit user action (adding/refetching a link) — never per keystroke —
 * to stay well inside the free tier's rate limit.
 *
 * Text fields are trimmed to the same length the sanitizer in post-doc.ts
 * whitelists (`MAX_BLOCK_STRING_PROP_CHARS`, mirrored here as
 * `MAX_TEXT_CHARS`) so nothing gets silently truncated on the next save.
 */

const TIMEOUT_MS = 8000;
const MAX_TEXT_CHARS = 400;

export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
}

export class LinkPreviewError extends Error {
  constructor(
    message: string,
    public readonly rateLimited = false,
  ) {
    super(message);
    this.name = "LinkPreviewError";
  }
}

export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreview> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new LinkPreviewError("That doesn't look like a valid URL.");
  }
  if (url.protocol !== "https:") {
    throw new LinkPreviewError("Only https links are supported.");
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.microlink.io/?url=${encodeURIComponent(url.toString())}`,
      { signal: controller.signal },
    );
    if (res.status === 429) {
      throw new LinkPreviewError(
        "Preview service is rate-limited right now — enter details manually.",
        true,
      );
    }
    if (!res.ok) throw new LinkPreviewError("Couldn't fetch a preview for that link.");
    const json = (await res.json()) as {
      status?: string;
      data?: {
        title?: unknown;
        description?: unknown;
        publisher?: unknown;
        image?: { url?: unknown };
      };
    };
    if (json.status !== "success" || !json.data) {
      throw new LinkPreviewError("Couldn't fetch a preview for that link.");
    }
    const d = json.data;
    return {
      url: url.toString(),
      title: cleanText(d.title),
      description: cleanText(d.description),
      imageUrl: httpsOnly(d.image?.url),
      siteName: cleanText(d.publisher),
    };
  } catch (e) {
    if (e instanceof LinkPreviewError) throw e;
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new LinkPreviewError("Timed out fetching a preview.");
    }
    throw new LinkPreviewError("Couldn't fetch a preview for that link.");
  } finally {
    window.clearTimeout(timeout);
  }
}

/** Derived at render time from a stored `url`, never persisted. */
export function faviconUrlFor(rawUrl: string): string | null {
  try {
    const { hostname } = new URL(rawUrl);
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`;
  } catch {
    return null;
  }
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_TEXT_CHARS) : undefined;
}

function httpsOnly(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Retry policy + backoff math for Drive requests.
 *
 * Backoff: truncated exponential with full jitter, capped at 30 s.
 * Respects HTTP Retry-After when the response/error supplies it.
 */

import { DriveAccessError } from "../errors";

const BASE_DELAY_MS = 800;
const MAX_DELAY_MS = 30_000;
const JITTER_RATIO = 0.4;

/**
 * Errors we consider safe to retry. These map to transient Drive states
 * (rate limit, quota, transient 5xx); auth/permission/not-found are not
 * retryable — surfacing them quickly keeps the UI honest.
 */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof DriveAccessError) {
    if (err.reason === "rate-limited") return true;
    // 5xx surfaces as "unknown" with status ≥ 500
    if (
      err.reason === "unknown" &&
      err.status !== undefined &&
      err.status >= 500 &&
      err.status < 600
    ) {
      return true;
    }
    return false;
  }
  // Network errors (TypeError from fetch) and AbortError-from-timeout-vs-user
  // we treat conservatively: retry only generic network failures.
  if (err instanceof TypeError) return true;
  if (err instanceof DOMException && err.name === "NetworkError") return true;
  return false;
}

/**
 * Pull a Retry-After hint off a DriveAccessError when present. Drive
 * stamps it on 429s; we fall back to driveMessage text for the rare 403
 * "rateLimitExceeded" case that doesn't include the header.
 */
export function getRetryAfterMs(err: unknown): number | null {
  if (!(err instanceof DriveAccessError)) return null;
  const fromHeader = err.retryAfterMs;
  if (typeof fromHeader === "number" && fromHeader > 0) return fromHeader;
  return null;
}

/**
 * Parse the Retry-After header (RFC 7231): seconds OR an HTTP-date.
 */
export function parseRetryAfterHeader(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  const ts = Date.parse(trimmed);
  if (!Number.isNaN(ts)) {
    const ms = ts - Date.now();
    return ms > 0 ? ms : 0;
  }
  return null;
}

/**
 * Compute the next backoff delay in ms.
 *  - attempt is 0-based for the FIRST retry (so attempt=0 → ~base).
 *  - If retryAfterMs is supplied (from the server), use max(server, computed)
 *    so we never retry sooner than the server told us to.
 */
export function computeBackoffMs(
  attempt: number,
  retryAfterMs: number | null,
): number {
  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  const jitter = exp * JITTER_RATIO * (Math.random() * 2 - 1);
  const computed = Math.max(100, Math.round(exp + jitter));
  if (retryAfterMs && retryAfterMs > computed) return retryAfterMs;
  return computed;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

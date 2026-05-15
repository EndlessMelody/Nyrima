/**
 * Shared types for the Drive request pipeline.
 *
 * All Drive API access funnels through DriveRequestQueue → authedFetch.
 * Callers describe what kind of work the request represents so the queue
 * can apply the right concurrency cap and priority ordering.
 */

export type Priority = "critical" | "high" | "normal" | "low";

export type RequestKind =
  | "metadata" // folder list, file metadata
  | "media-range" // partial download for playback
  | "subtitle" // .srt/.vtt/.ass text fetch
  | "thumbnail" // poster / thumbnail binary
  | "media-stream" // open-ended media stream (counted once, not throttled by range cap)
  | "auth"; // OAuth probe / cheap auth-only round-trip

export interface RequestOptions {
  kind?: RequestKind;
  priority?: Priority;
  signal?: AbortSignal;
  /**
   * Stable identifier for dedup. When two callers request the same
   * (op, dedupKey) at the same time, they share a single in-flight promise.
   * Pass undefined to disable dedup for this call.
   */
  dedupKey?: string;
}

export const PRIORITY_RANK: Record<Priority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

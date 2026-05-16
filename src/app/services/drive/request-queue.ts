/**
 * DriveRequestQueue — central scheduler for every Drive API call.
 *
 * Why:
 *   Before this existed, components called drive-api functions directly, and
 *   a single lobby load could fire 5–10 parallel requests on top of a player
 *   opening another folder. Drive's per-user-per-100s quota is easy to blow
 *   under that pattern. The queue enforces a small concurrency cap per kind
 *   and serializes overflow behind a priority order.
 *
 * Features:
 *   - Per-kind concurrency cap (metadata: 3, media-range: 2, media-stream: 2,
 *     subtitle: 2, thumbnail: 2, auth: 4).
 *   - Priority levels (critical → high → normal → low) — FIFO within a level.
 *   - Truncated exponential backoff with full jitter on retryable errors
 *     (429 / 403 rate-limited / 5xx / network).
 *   - Honors Retry-After when present.
 *   - Global cooldown signal published to useRateLimitStore so the UI can
 *     show a banner and background prefetchers can pause.
 *   - AbortSignal-aware: aborted tasks resolve immediately and never count
 *     against concurrency.
 *
 * Out of scope for the queue itself:
 *   - In-flight dedup (lives in dedup.ts, applied at the drive-api layer so
 *     keys are op-specific).
 *   - Auth strategy (lives in auth.ts; the queue only knows about `run`).
 */

import {
  PRIORITY_RANK,
  type Priority,
  type RequestKind,
} from "./types";
import {
  computeBackoffMs,
  getRetryAfterMs,
  isRetryableError,
  sleep,
} from "./backoff";
import { useRateLimitStore } from "./rate-limit-store";

interface RunTask<T> {
  kind: RequestKind;
  priority: Priority;
  signal?: AbortSignal;
  /** The actual work. Receives the abort signal so callers can chain it
   *  into fetch(). */
  run: (signal: AbortSignal | undefined) => Promise<T>;
  /** Maximum retry attempts; defaults to 4 (so up to 5 total tries). */
  maxRetries?: number;
}

interface InternalTask<T = unknown> extends RunTask<T> {
  enqueuedAt: number;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
  attempt: number;
}

interface KindLimits {
  concurrency: number;
}

const DEFAULT_LIMITS: Record<RequestKind, KindLimits> = {
  metadata: { concurrency: 2 },
  "media-range": { concurrency: 1 },
  "media-stream": { concurrency: 1 },
  subtitle: { concurrency: 1 },
  thumbnail: { concurrency: 1 },
  auth: { concurrency: 4 },
};

export interface QueueStats {
  active: Record<RequestKind, number>;
  queued: Record<RequestKind, number>;
  totalActive: number;
  totalQueued: number;
  cooling: boolean;
  coolingMsRemaining: number;
}

export class DriveRequestQueue {
  private limits: Record<RequestKind, KindLimits>;
  private waiting: Map<RequestKind, InternalTask[]> = new Map();
  private active: Map<RequestKind, number> = new Map();
  /** Set when a rate-limit is in effect; dispatch is paused until this expires. */
  private pauseUntil = 0;
  /** Set when devMode RPM cap or admin code stalls dispatch. */
  private extraPauseUntil = 0;
  /** Optional gate function — when present and returns >0, dispatch waits. */
  private dispatchGate: (() => number) | null = null;

  constructor(limits: Partial<Record<RequestKind, KindLimits>> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    for (const k of Object.keys(this.limits) as RequestKind[]) {
      this.waiting.set(k, []);
      this.active.set(k, 0);
    }
  }

  /**
   * Install a function that returns how many ms to wait before the next
   * dispatch. Useful for dev RPM caps. Return 0 (or null gate) to allow
   * immediate dispatch.
   */
  setDispatchGate(gate: (() => number) | null): void {
    this.dispatchGate = gate;
  }

  setKindConcurrency(kind: RequestKind, concurrency: number): void {
    this.limits[kind] = { concurrency: Math.max(1, concurrency) };
    this.pump();
  }

  run<T>(task: RunTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (task.signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const internal: InternalTask<T> = {
        ...task,
        enqueuedAt: Date.now(),
        attempt: 0,
        resolve,
        reject,
      };
      // Cancel-while-waiting: pull the task out before dispatch.
      const erased = internal as unknown as InternalTask;
      task.signal?.addEventListener(
        "abort",
        () => this.removeFromWaiting(erased),
        { once: true },
      );
      this.enqueue(erased);
      this.pump();
    });
  }

  getStats(): QueueStats {
    const active = {} as Record<RequestKind, number>;
    const queued = {} as Record<RequestKind, number>;
    let totalActive = 0;
    let totalQueued = 0;
    for (const k of Object.keys(this.limits) as RequestKind[]) {
      active[k] = this.active.get(k) ?? 0;
      queued[k] = this.waiting.get(k)?.length ?? 0;
      totalActive += active[k];
      totalQueued += queued[k];
    }
    const now = Date.now();
    return {
      active,
      queued,
      totalActive,
      totalQueued,
      cooling: this.pauseUntil > now,
      coolingMsRemaining: Math.max(0, this.pauseUntil - now),
    };
  }

  // -------------------------------------------------------------------------

  private enqueue(task: InternalTask): void {
    const bucket = this.waiting.get(task.kind);
    if (!bucket) {
      // Unknown kind — fall back to "metadata" semantics.
      this.waiting.set(task.kind, [task]);
      return;
    }
    // Insertion-sort by (priority, enqueuedAt). Buckets stay short.
    const rank = PRIORITY_RANK[task.priority];
    let i = bucket.length;
    while (i > 0 && PRIORITY_RANK[bucket[i - 1].priority] > rank) i--;
    bucket.splice(i, 0, task);
  }

  private removeFromWaiting(task: InternalTask): void {
    const bucket = this.waiting.get(task.kind);
    if (!bucket) return;
    const idx = bucket.indexOf(task);
    if (idx >= 0) {
      bucket.splice(idx, 1);
      task.reject(new DOMException("Aborted", "AbortError"));
    }
  }

  /**
   * Try to dispatch as many waiting tasks as concurrency caps allow. Called
   * after enqueue, after a task settles, and after a cooldown lifts.
   */
  private pump(): void {
    const now = Date.now();
    const pauseLeft = Math.max(this.pauseUntil, this.extraPauseUntil) - now;
    if (pauseLeft > 0) {
      // Schedule a single retry after the pause. Re-pump will discover more.
      setTimeout(() => this.pump(), pauseLeft + 25);
      return;
    }
    if (this.dispatchGate) {
      const wait = this.dispatchGate();
      if (wait > 0) {
        setTimeout(() => this.pump(), wait + 5);
        return;
      }
    }

    let dispatchedSomething = false;
    for (const kind of Object.keys(this.limits) as RequestKind[]) {
      const cap = this.limits[kind].concurrency;
      const bucket = this.waiting.get(kind);
      if (!bucket || bucket.length === 0) continue;
      while ((this.active.get(kind) ?? 0) < cap && bucket.length > 0) {
        const task = bucket.shift()!;
        if (task.signal?.aborted) {
          task.reject(new DOMException("Aborted", "AbortError"));
          continue;
        }
        this.active.set(kind, (this.active.get(kind) ?? 0) + 1);
        dispatchedSomething = true;
        void this.execute(task);
      }
    }

    // If we couldn't dispatch but tasks remain, re-pump shortly. This keeps
    // the gate-driven path responsive without busy-looping.
    if (!dispatchedSomething && this.totalQueued() > 0 && this.dispatchGate) {
      setTimeout(() => this.pump(), 50);
    }
  }

  private async execute(task: InternalTask): Promise<void> {
    // Default budgets:
    //   - rate-limit errors: 1 retry max. More retries amplify the storm
    //     since each attempt counts against the same quota that's already
    //     refusing us.
    //   - other retryable errors (5xx, network): 4 retries.
    const defaultMax = task.maxRetries ?? 4;
    try {
      const result = await task.run(task.signal);
      task.resolve(result);
      useRateLimitStore.getState().recordSuccess();
    } catch (err) {
      if (task.signal?.aborted) {
        task.reject(err);
        return;
      }
      const retryable = isRetryableError(err);
      const isRateLimited =
        err instanceof Error && err.name === "DriveAccessError"
          ? (err as { reason?: string }).reason === "rate-limited"
          : false;
      const maxRetries = isRateLimited ? 1 : defaultMax;

      if (retryable && task.attempt < maxRetries) {
        const retryAfter = getRetryAfterMs(err);
        const delay = computeBackoffMs(task.attempt, retryAfter);
        task.attempt += 1;
        if (isRateLimited) {
          // Compound cooldown on consecutive hits: each fresh rate-limit
          // doubles the floor. The store's hitCount tracks streaks; we use
          // it to back off harder when Drive keeps refusing. Capped at 5 min.
          const hits = useRateLimitStore.getState().hitCount + 1;
          const floor = Math.min(5 * 60_000, 15_000 * 2 ** Math.min(hits - 1, 4));
          const cooldown = Math.max(delay, retryAfter ?? 0, floor);
          this.pauseUntil = Math.max(this.pauseUntil, Date.now() + cooldown);
          useRateLimitStore.getState().beginCooldown(cooldown);
        }
        try {
          await sleep(delay, task.signal);
        } catch {
          task.reject(new DOMException("Aborted", "AbortError"));
          this.releaseSlot(task.kind);
          return;
        }
        // Re-execute on the SAME slot — keeps fairness simple.
        return this.execute(task);
      }
      // Out of retries (or non-retryable). For rate-limit we still bump
      // the cooldown so other in-flight tasks back off even though THIS
      // task is giving up.
      if (isRateLimited) {
        const hits = useRateLimitStore.getState().hitCount + 1;
        const floor = Math.min(5 * 60_000, 30_000 * 2 ** Math.min(hits - 1, 3));
        this.pauseUntil = Math.max(this.pauseUntil, Date.now() + floor);
        useRateLimitStore.getState().beginCooldown(floor);
      }
      task.reject(err);
    } finally {
      this.releaseSlot(task.kind);
    }
  }

  private releaseSlot(kind: RequestKind): void {
    this.active.set(kind, Math.max(0, (this.active.get(kind) ?? 0) - 1));
    this.pump();
  }

  private totalQueued(): number {
    let total = 0;
    for (const bucket of this.waiting.values()) total += bucket.length;
    return total;
  }
}

/**
 * Singleton — every Drive call across the app should go through this.
 * A separate instance can be constructed for tests.
 */
export const driveQueue = new DriveRequestQueue();

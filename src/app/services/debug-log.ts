/**
 * Dev-only console logger.
 *
 * The playback + subtitle pipelines emit a lot of `console.info` chatter
 * that's invaluable while debugging a failed MKV open but pure noise in
 * production (and forces string templating on the hot path). `debugLog`
 * is wired to `console.info` in dev builds and to a no-op in prod, so
 * callers can keep the same call shape without manual gating.
 *
 * `console.warn` and `console.error` are intentionally NOT routed through
 * this helper — surfaced errors and warnings remain useful for end-user
 * bug reports even in shipped builds.
 */

const enabled = import.meta.env.DEV;

export const debugLog: (...args: unknown[]) => void = enabled
  ? // Bind so Chrome's devtools still reports the original call site.
    console.info.bind(console)
  : () => {};

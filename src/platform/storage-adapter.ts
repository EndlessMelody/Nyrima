/**
 * Web storage adapter — a faithful subset of the `chrome.storage` surface,
 * backed by the browser's `localStorage` (the `local` area) and `sessionStorage`
 * (the `session` area).
 *
 * Why this exists
 * ---------------
 * Nyrima's stores and services were written against `chrome.storage.local`
 * (and `.session`) across ~40 modules. Rather than rewrite all of them for the
 * web runtime, the platform shim (`chrome-shim.ts`) installs `window.chrome`
 * with this adapter so every existing `chrome.storage.*` call keeps working in
 * a normal browser.
 *
 * Account isolation
 * -----------------
 * All keys are namespaced under the *active account id* so two signed-in users
 * on the same device never see each other's libraries, history, or settings —
 * one of the core requirements of the web product. The auth layer calls
 * `setActiveAccount()` on sign-in / sign-out. Until someone signs in, data
 * lands in the shared `guest` partition.
 *
 * The auth registry itself (the list of accounts + the current session) is
 * stored OUTSIDE this adapter, under un-namespaced keys, so it survives across
 * account switches — see `src/auth/account-store.ts`.
 */

type StorageRecord = Record<string, unknown>;

/** Shape of a single key's change, mirroring chrome.storage.StorageChange. */
export interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

export type AreaName = "local" | "session" | "managed" | "sync";

type ChangeListener = (
  changes: Record<string, StorageChange>,
  areaName: AreaName,
) => void;

const KEY_PREFIX = "ny";
const GUEST_ACCOUNT = "guest";

let activeAccountId = GUEST_ACCOUNT;
const changeListeners = new Set<ChangeListener>();

/**
 * Point the adapter at a specific account. Every subsequent read/write is
 * partitioned under this id. Called by the auth layer on sign-in/out.
 */
export function setActiveAccount(accountId: string | null | undefined): void {
  const next = accountId && accountId.trim() ? accountId.trim() : GUEST_ACCOUNT;
  activeAccountId = next;
}

export function getActiveAccount(): string {
  return activeAccountId;
}

function backingFor(area: AreaName): Storage | null {
  if (typeof window === "undefined") return null;
  // `sync`/`managed` don't exist on the web; fold them onto local so callers
  // that reference chrome.storage.sync (none today) still get a working store.
  if (area === "session") return window.sessionStorage;
  return window.localStorage;
}

function physicalPrefix(area: AreaName): string {
  return `${KEY_PREFIX}::${area}::${activeAccountId}::`;
}

function physicalKey(area: AreaName, logicalKey: string): string {
  return physicalPrefix(area) + logicalKey;
}

function readRaw(area: AreaName, logicalKey: string): unknown {
  const store = backingFor(area);
  if (!store) return undefined;
  const raw = store.getItem(physicalKey(area, logicalKey));
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function listLogicalKeys(area: AreaName): string[] {
  const store = backingFor(area);
  if (!store) return [];
  const prefix = physicalPrefix(area);
  const out: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k && k.startsWith(prefix)) out.push(k.slice(prefix.length));
  }
  return out;
}

function emit(area: AreaName, changes: Record<string, StorageChange>): void {
  if (Object.keys(changes).length === 0) return;
  for (const listener of changeListeners) {
    try {
      listener(changes, area);
    } catch {
      /* a misbehaving listener shouldn't break a write */
    }
  }
}

/**
 * `chrome.storage.<area>.get` accepts a string, an array of strings, an object
 * of `{ key: defaultValue }`, or null/undefined (return everything).
 */
function get(
  area: AreaName,
  keys?: string | string[] | StorageRecord | null,
): Promise<StorageRecord> {
  const result: StorageRecord = {};
  if (keys == null) {
    for (const k of listLogicalKeys(area)) result[k] = readRaw(area, k);
    return Promise.resolve(result);
  }
  if (typeof keys === "string") {
    const v = readRaw(area, keys);
    if (v !== undefined) result[keys] = v;
    return Promise.resolve(result);
  }
  if (Array.isArray(keys)) {
    for (const k of keys) {
      const v = readRaw(area, k);
      if (v !== undefined) result[k] = v;
    }
    return Promise.resolve(result);
  }
  // Object form: keys are property names, values are defaults.
  for (const [k, def] of Object.entries(keys)) {
    const v = readRaw(area, k);
    result[k] = v === undefined ? def : v;
  }
  return Promise.resolve(result);
}

function set(area: AreaName, items: StorageRecord): Promise<void> {
  const store = backingFor(area);
  if (!store) return Promise.resolve();
  const changes: Record<string, StorageChange> = {};
  for (const [k, value] of Object.entries(items)) {
    const oldValue = readRaw(area, k);
    try {
      store.setItem(physicalKey(area, k), JSON.stringify(value));
    } catch {
      /* quota or serialization failure — skip this key */
      continue;
    }
    changes[k] = { oldValue, newValue: value };
  }
  emit(area, changes);
  return Promise.resolve();
}

function remove(area: AreaName, keys: string | string[]): Promise<void> {
  const store = backingFor(area);
  if (!store) return Promise.resolve();
  const list = Array.isArray(keys) ? keys : [keys];
  const changes: Record<string, StorageChange> = {};
  for (const k of list) {
    const oldValue = readRaw(area, k);
    if (oldValue === undefined) continue;
    store.removeItem(physicalKey(area, k));
    changes[k] = { oldValue, newValue: undefined };
  }
  emit(area, changes);
  return Promise.resolve();
}

function clear(area: AreaName): Promise<void> {
  const store = backingFor(area);
  if (!store) return Promise.resolve();
  const changes: Record<string, StorageChange> = {};
  for (const k of listLogicalKeys(area)) {
    changes[k] = { oldValue: readRaw(area, k), newValue: undefined };
    store.removeItem(physicalKey(area, k));
  }
  emit(area, changes);
  return Promise.resolve();
}

function makeArea(area: AreaName) {
  return {
    get: (keys?: string | string[] | StorageRecord | null) => get(area, keys),
    set: (items: StorageRecord) => set(area, items),
    remove: (keys: string | string[]) => remove(area, keys),
    clear: () => clear(area),
  };
}

export const storageAdapter = {
  local: makeArea("local"),
  session: makeArea("session"),
  // `sync` is aliased to local so any stray chrome.storage.sync call still
  // persists rather than throwing. Nyrima doesn't use it today.
  sync: makeArea("local"),
  onChanged: {
    addListener: (listener: ChangeListener) => {
      changeListeners.add(listener);
    },
    removeListener: (listener: ChangeListener) => {
      changeListeners.delete(listener);
    },
    hasListener: (listener: ChangeListener) => changeListeners.has(listener),
  },
};

// Cross-tab propagation: when another tab writes to localStorage, translate the
// native `storage` event into a chrome.storage.onChanged callback for the
// `local` area so listeners (playback sync, api-key watcher, …) stay honest.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (!e.key) return; // a full clear() — ignore, no per-key detail
    const prefix = physicalPrefix("local");
    if (!e.key.startsWith(prefix)) return;
    const logicalKey = e.key.slice(prefix.length);
    const parse = (raw: string | null) => {
      if (raw == null) return undefined;
      try {
        return JSON.parse(raw);
      } catch {
        return undefined;
      }
    };
    emit("local", {
      [logicalKey]: {
        oldValue: parse(e.oldValue),
        newValue: parse(e.newValue),
      },
    });
  });
}

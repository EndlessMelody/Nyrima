export interface BootLine {
  id: string;
  text: string;
}

/** Mono status lines for the start-menu boot cascade, in display order. */
export const BOOT_LINES: BootLine[] = [
  { id: "os", text: "NYRIMA OS // v0.1.0" },
  { id: "drive", text: "MOUNTING DRIVE LIBRARY..." },
  { id: "subs", text: "SUBTITLE ENGINE... OK" },
  { id: "link", text: "LINK ESTABLISHED" },
];

/** Delay between each line's reveal animation. */
export const BOOT_LINE_STAGGER_MS = 260;

/** Total runtime before the boot auto-finishes. */
export const BOOT_TOTAL_MS = 1400;

export const BOOT_SHOWN_STORAGE_KEY = "nyrima.entry.bootShown";

type BootStorage = Pick<Storage, "getItem" | "setItem">;

function getStorage(storage?: BootStorage): BootStorage | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.sessionStorage;
}

/** Whether the boot cascade has already played this session. */
export function hasBootPlayed(storage?: BootStorage): boolean {
  try {
    return getStorage(storage)?.getItem(BOOT_SHOWN_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** Marks the boot cascade as played so it doesn't replay this session. */
export function markBootPlayed(storage?: BootStorage): void {
  try {
    getStorage(storage)?.setItem(BOOT_SHOWN_STORAGE_KEY, "true");
  } catch {
    // sessionStorage can be unavailable in private contexts; the boot just replays.
  }
}

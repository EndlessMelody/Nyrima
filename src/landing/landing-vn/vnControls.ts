export const VN_SOUND_STORAGE_KEY = "nyrima.vn.soundEnabled";
export const VN_SETTINGS_STORAGE_KEY = "nyrima.vn.settings";

type SoundPreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export interface DialogueLogEntry {
  id: string;
  speaker: string;
  text: string;
  /** The VN node this line belongs to, if any — lets the log offer a "Jump"
   *  action back to it. Absent for synthetic interjection lines (poke/idle). */
  nodeKey?: string;
}

export type VNTypingSpeed = "slow" | "normal" | "fast" | "instant";
export type VNAutoDelay = "short" | "normal" | "long";
export type VNFontFamily = "default" | "rounded" | "pixel" | "serif";
export type VNTextColor = "soft-white" | "warm-cream" | "pastel-pink" | "pastel-blue";

export interface VNSettings {
  typingSpeed: VNTypingSpeed;
  autoDelay: VNAutoDelay;
  effectsEnabled: boolean;
  fontFamily: VNFontFamily;
  textColor: VNTextColor;
}

export const DEFAULT_VN_SETTINGS: VNSettings = {
  typingSpeed: "normal",
  autoDelay: "normal",
  effectsEnabled: true,
  fontFamily: "default",
  textColor: "soft-white",
};

const VALID_TYPING_SPEEDS = new Set<VNTypingSpeed>(["slow", "normal", "fast", "instant"]);
const VALID_AUTO_DELAYS = new Set<VNAutoDelay>(["short", "normal", "long"]);
const VALID_FONT_FAMILIES = new Set<VNFontFamily>(["default", "rounded", "pixel", "serif"]);
const VALID_TEXT_COLORS = new Set<VNTextColor>([
  "soft-white",
  "warm-cream",
  "pastel-pink",
  "pastel-blue",
]);

function getStorage(storage?: SoundPreferenceStorage): SoundPreferenceStorage | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function readStoredSoundPreference(storage?: SoundPreferenceStorage): boolean {
  try {
    return getStorage(storage)?.getItem(VN_SOUND_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeStoredSoundPreference(
  enabled: boolean,
  storage?: SoundPreferenceStorage,
) {
  try {
    getStorage(storage)?.setItem(VN_SOUND_STORAGE_KEY, String(enabled));
  } catch {
    // localStorage can be unavailable in private contexts; the UI state still works.
  }
}

function parseStoredSettings(value: string | null): Partial<VNSettings> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Partial<VNSettings>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function normalizeVNSettings(value: Partial<VNSettings>): VNSettings {
  return {
    typingSpeed:
      value.typingSpeed && VALID_TYPING_SPEEDS.has(value.typingSpeed)
        ? value.typingSpeed
        : DEFAULT_VN_SETTINGS.typingSpeed,
    autoDelay:
      value.autoDelay && VALID_AUTO_DELAYS.has(value.autoDelay)
        ? value.autoDelay
        : DEFAULT_VN_SETTINGS.autoDelay,
    effectsEnabled:
      typeof value.effectsEnabled === "boolean"
        ? value.effectsEnabled
        : DEFAULT_VN_SETTINGS.effectsEnabled,
    fontFamily:
      value.fontFamily && VALID_FONT_FAMILIES.has(value.fontFamily)
        ? value.fontFamily
        : DEFAULT_VN_SETTINGS.fontFamily,
    textColor:
      value.textColor && VALID_TEXT_COLORS.has(value.textColor)
        ? value.textColor
        : DEFAULT_VN_SETTINGS.textColor,
  };
}

export function readStoredVNSettings(storage?: SoundPreferenceStorage): VNSettings {
  try {
    return normalizeVNSettings(
      parseStoredSettings(getStorage(storage)?.getItem(VN_SETTINGS_STORAGE_KEY) ?? null),
    );
  } catch {
    return DEFAULT_VN_SETTINGS;
  }
}

export function writeStoredVNSettings(
  settings: VNSettings,
  storage?: SoundPreferenceStorage,
) {
  try {
    getStorage(storage)?.setItem(
      VN_SETTINGS_STORAGE_KEY,
      JSON.stringify(normalizeVNSettings(settings)),
    );
  } catch {
    // localStorage can be unavailable in private contexts; the UI state still works.
  }
}

export function appendDialogueLogEntry(
  entries: DialogueLogEntry[],
  next: DialogueLogEntry,
): DialogueLogEntry[] {
  if (!next.text.trim()) return entries;
  if (entries.some((entry) => entry.id === next.id)) return entries;
  return [...entries, next];
}

import { describe, expect, it } from "vitest";
import {
  appendDialogueLogEntry,
  DEFAULT_VN_SETTINGS,
  readStoredSoundPreference,
  readStoredVNSettings,
  VN_SETTINGS_STORAGE_KEY,
  VN_SOUND_STORAGE_KEY,
  writeStoredSoundPreference,
  writeStoredVNSettings,
  type DialogueLogEntry,
} from "./vnControls";

function storageWith(initial: Record<string, string | null> = {}) {
  const data = new Map(
    Object.entries(initial).filter(([, value]) => value != null) as [string, string][],
  );
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  };
}

describe("VN control helpers", () => {
  it("reads sound preference from storage with a false fallback", () => {
    expect(readStoredSoundPreference(storageWith())).toBe(false);
    expect(readStoredSoundPreference(storageWith({ [VN_SOUND_STORAGE_KEY]: "true" }))).toBe(true);
    expect(readStoredSoundPreference(storageWith({ [VN_SOUND_STORAGE_KEY]: "false" }))).toBe(false);
    expect(readStoredSoundPreference(storageWith({ [VN_SOUND_STORAGE_KEY]: "maybe" }))).toBe(false);
  });

  it("writes sound preference as a stable string value", () => {
    const storage = storageWith();

    writeStoredSoundPreference(true, storage);
    expect(storage.getItem(VN_SOUND_STORAGE_KEY)).toBe("true");

    writeStoredSoundPreference(false, storage);
    expect(storage.getItem(VN_SOUND_STORAGE_KEY)).toBe("false");
  });

  it("adds each dialogue line to the log once", () => {
    const existing: DialogueLogEntry[] = [
      { id: "intro:0", speaker: "Ny-chan", text: "Welcome." },
    ];

    expect(
      appendDialogueLogEntry(existing, {
        id: "intro:0",
        speaker: "Ny-chan",
        text: "Welcome.",
      }),
    ).toBe(existing);

    expect(
      appendDialogueLogEntry(existing, {
        id: "intro:1",
        speaker: "Ny-chan",
        text: "Pick a chapter.",
      }),
    ).toEqual([
      { id: "intro:0", speaker: "Ny-chan", text: "Welcome." },
      { id: "intro:1", speaker: "Ny-chan", text: "Pick a chapter." },
    ]);
  });

  it("reads VN settings with safe defaults and valid stored overrides", () => {
    expect(readStoredVNSettings(storageWith())).toEqual(DEFAULT_VN_SETTINGS);
    expect(
      readStoredVNSettings(
        storageWith({
          [VN_SETTINGS_STORAGE_KEY]: JSON.stringify({
            typingSpeed: "fast",
            autoDelay: "long",
            effectsEnabled: false,
            fontFamily: "pixel",
            textColor: "pastel-blue",
          }),
        }),
      ),
    ).toEqual({
      typingSpeed: "fast",
      autoDelay: "long",
      effectsEnabled: false,
      fontFamily: "pixel",
      textColor: "pastel-blue",
    });
  });

  it("normalizes malformed VN settings instead of trusting storage", () => {
    expect(
      readStoredVNSettings(
        storageWith({
          [VN_SETTINGS_STORAGE_KEY]: JSON.stringify({
            typingSpeed: "turbo",
            autoDelay: "forever",
            effectsEnabled: "sometimes",
            fontFamily: "unknown",
            textColor: "invisible",
          }),
        }),
      ),
    ).toEqual(DEFAULT_VN_SETTINGS);
  });

  it("writes normalized VN settings as JSON", () => {
    const storage = storageWith();

    writeStoredVNSettings(
      {
        typingSpeed: "instant",
        autoDelay: "short",
        effectsEnabled: false,
        fontFamily: "serif",
        textColor: "warm-cream",
      },
      storage,
    );

    expect(JSON.parse(storage.getItem(VN_SETTINGS_STORAGE_KEY) ?? "")).toEqual({
      typingSpeed: "instant",
      autoDelay: "short",
      effectsEnabled: false,
      fontFamily: "serif",
      textColor: "warm-cream",
    });
  });
});

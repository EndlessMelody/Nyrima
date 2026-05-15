/**
 * Custom subtitle font registration.
 *
 * The user can upload a .woff2/.ttf via SettingsPopover; we keep the bytes
 * inline as a data: URL (chrome.storage.local) and register the family on
 * boot via the FontFace API so the SubtitleOverlay's CSS font stack can
 * reference it as `Nyrima Custom Sub`.
 *
 * Idempotent: repeat calls with the same data: URL are no-ops.
 */

export const CUSTOM_FONT_FAMILY = "Nyrima Custom Sub";

let registeredUrl: string | null = null;

export function ensureCustomFontRegistered(dataUrl: string): void {
  if (registeredUrl === dataUrl) return;
  if (typeof FontFace === "undefined" || !document.fonts) return;
  // Drop any previously-registered version so a re-upload replaces cleanly.
  for (const f of Array.from(document.fonts)) {
    if (f.family === CUSTOM_FONT_FAMILY) document.fonts.delete(f);
  }
  const face = new FontFace(CUSTOM_FONT_FAMILY, `url(${dataUrl})`, {
    weight: "400 900",
    display: "swap",
  });
  void face.load().then((loaded) => {
    document.fonts.add(loaded);
    registeredUrl = dataUrl;
  });
}

/** Map a SubtitleFontPreset to a CSS font-family value.
 *
 *  `anime-brush` is the fansub-flavored stack — Comic Neue (bundled, FOSS
 *  Comic Sans clone) first so cross-OS users see the same brushed lettering
 *  Windows users used to get from the system Comic Sans MS. `comic-dialogue`
 *  prefers the literal Comic Sans face where the OS ships it, falling
 *  through to Comic Neue. `clean-sans` reuses the body Geist Sans stack and
 *  `system` defers to the platform UI font. */
export function fontStackFor(
  preset: "anime-brush" | "comic-dialogue" | "clean-sans" | "system" | "custom",
): string {
  switch (preset) {
    case "anime-brush":
      return '"Comic Neue", "Comic Sans MS", "Chalkboard SE", "Marker Felt", system-ui, sans-serif';
    case "comic-dialogue":
      return '"Comic Sans MS", "Chalkboard SE", "Marker Felt", "Comic Neue", system-ui, sans-serif';
    case "clean-sans":
      return "var(--dc-font-body)";
    case "system":
      return '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
    case "custom":
      return `"${CUSTOM_FONT_FAMILY}", "Comic Neue", system-ui, sans-serif`;
  }
}

/** Short marketing label used in the picker pills + preview row. */
export function fontLabelFor(
  preset: "anime-brush" | "comic-dialogue" | "clean-sans" | "system" | "custom",
): string {
  switch (preset) {
    case "anime-brush":
      return "Anime Brush";
    case "comic-dialogue":
      return "Comic Dialogue";
    case "clean-sans":
      return "Clean Sans";
    case "system":
      return "System UI";
    case "custom":
      return "Custom Upload";
  }
}

/** Read a File (woff2/ttf) into a base64 data: URL for storage. */
export function readFontFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("FileReader returned non-string result"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

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
 *  Every preset now leads with a locally-bundled face (declared in
 *  fonts.scss) so the picker looks the same on every OS:
 *
 *    - `chinacat-teddybear` — brush voice, Chinacat → Comic Neue → Comic Sans
 *    - `cascadia`           — dialogue / mono voice, Cascadia Mono → Cascadia Code
 *    - `asap`               — clean modern sans, Asap variable
 *    - `system`             — platform UI default
 *    - `custom`             — user-uploaded face, falls through to Chinacat */
export function fontStackFor(
  preset: "chinacat-teddybear" | "cascadia" | "asap" | "system" | "custom",
): string {
  switch (preset) {
    case "chinacat-teddybear":
      // "Itim" carries Vietnamese-range glyphs via its unicode-range-scoped
      // @font-face (imported in main.tsx). Placing it before system-ui means
      // accented Vietnamese characters (`ế ữ ợ ầ ạ ẩ`) stay in a brush face
      // instead of falling through to the OS default sans.
      return '"Chinacat Teddybear", "Comic Neue", "Comic Sans MS", "Chalkboard SE", "Marker Felt", "Itim", system-ui, sans-serif';
    case "cascadia":
      return '"Cascadia Mono", "Cascadia Code", "Consolas", "SFMono-Regular", ui-monospace, monospace';
    case "asap":
      return '"Asap", "Inter", system-ui, sans-serif';
    case "system":
      return '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
    case "custom":
      return `"${CUSTOM_FONT_FAMILY}", "Chinacat Teddybear", "Itim", system-ui, sans-serif`;
  }
}

/** Short marketing label used in the picker pills + preview row. */
export function fontLabelFor(
  preset: "chinacat-teddybear" | "cascadia" | "asap" | "system" | "custom",
): string {
  switch (preset) {
    case "chinacat-teddybear":
      return "Chinacat Teddybear";
    case "cascadia":
      return "Cascadia";
    case "asap":
      return "Asap";
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

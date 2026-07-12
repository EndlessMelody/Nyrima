/**
 * Keyboard shortcut catalog for the reader.
 *
 * Kept data-driven so the help panel and the key handler read from one list —
 * the page maps each `ReaderAction` to a function. Making the table the single
 * source of truth is what lets shortcuts stay discoverable (the help modal is
 * generated from it) and re-mappable later without hunting through handlers.
 */

export type ReaderAction =
  | "next-page"
  | "prev-page"
  | "next-chapter"
  | "prev-chapter"
  | "font-increase"
  | "font-decrease"
  | "toggle-theme"
  | "toggle-toc"
  | "toggle-bookmark"
  | "search"
  | "help"
  | "toggle-tts"
  | "escape";

export interface ShortcutDef {
  action: ReaderAction;
  /** Human-readable key hint for the help panel. */
  keys: string;
  label: string;
  group: "Navigate" | "Typography" | "Tools";
}

export const READER_SHORTCUTS: ShortcutDef[] = [
  { action: "next-page", keys: "Space  ·  →", label: "Next page", group: "Navigate" },
  { action: "prev-page", keys: "Shift+Space  ·  ←", label: "Previous page", group: "Navigate" },
  { action: "next-chapter", keys: "]  ·  .", label: "Next chapter", group: "Navigate" },
  { action: "prev-chapter", keys: "[  ·  ,", label: "Previous chapter", group: "Navigate" },
  { action: "font-increase", keys: "+  ·  =", label: "Increase font size", group: "Typography" },
  { action: "font-decrease", keys: "−  ·  _", label: "Decrease font size", group: "Typography" },
  { action: "toggle-theme", keys: "T", label: "Cycle theme", group: "Typography" },
  { action: "toggle-toc", keys: "C", label: "Table of contents", group: "Tools" },
  { action: "toggle-bookmark", keys: "B", label: "Toggle bookmark here", group: "Tools" },
  { action: "search", keys: "/  ·  Ctrl+F", label: "Search the book", group: "Tools" },
  { action: "toggle-tts", keys: "S", label: "Read aloud", group: "Tools" },
  { action: "help", keys: "?", label: "Shortcuts", group: "Tools" },
  { action: "escape", keys: "Esc", label: "Close panel / exit", group: "Tools" },
];

/**
 * Map a keydown event to a reader action. Returns null when the key isn't a
 * shortcut. The caller is responsible for ignoring events that originate in
 * editable fields (except where noted — Ctrl/Cmd+F and Escape always count).
 */
export function resolveReaderAction(e: KeyboardEvent): ReaderAction | null {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key;

  // Search: support the native Find chord regardless of focus.
  if (mod && (key === "f" || key === "F")) return "search";
  if (mod) return null; // leave other browser/OS chords alone

  switch (key) {
    case " ":
      return e.shiftKey ? "prev-page" : "next-page";
    case "ArrowRight":
      return "next-page";
    case "ArrowLeft":
      return "prev-page";
    case "PageDown":
      return "next-page";
    case "PageUp":
      return "prev-page";
    case "]":
    case ".":
      return "next-chapter";
    case "[":
    case ",":
      return "prev-chapter";
    case "+":
    case "=":
      return "font-increase";
    case "-":
    case "_":
      return "font-decrease";
    case "t":
    case "T":
      return "toggle-theme";
    case "c":
    case "C":
      return "toggle-toc";
    case "b":
    case "B":
      return "toggle-bookmark";
    case "s":
    case "S":
      return "toggle-tts";
    case "/":
      return "search";
    case "?":
      return "help";
    case "Escape":
      return "escape";
    default:
      return null;
  }
}

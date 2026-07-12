/**
 * "Open file" outside of a connected local library — for one-off playback
 * without indexing a whole folder. Prefers the File System Access picker;
 * falls back to a hidden `<input type="file">` on Firefox/Safari.
 */

import { toLocalFileId } from "@shared/local-id";
import { QUICK_OPEN_REL_PATH, localLibrary } from "./local-source";

export type QuickOpenAccept = FilePickerAcceptType;

export interface QuickOpenResult {
  file: File;
  localId: string;
}

export function supportsFilePicker(): boolean {
  return typeof window !== "undefined" && typeof window.showOpenFilePicker === "function";
}

/**
 * Open a single local file. The returned id is derived from
 * name/size/mtime so repeat opens of the same file resolve to the same
 * `PlaybackPosition` entry within a session.
 */
export async function pickLocalFile(types: QuickOpenAccept[]): Promise<QuickOpenResult | null> {
  const file = supportsFilePicker()
    ? await pickViaFileSystemAccess(types)
    : await pickViaInput(types);
  if (!file) return null;
  return registerQuickOpenFile(file);
}

function registerQuickOpenFile(file: File): QuickOpenResult {
  const localId = toLocalFileId(`${QUICK_OPEN_REL_PATH}/${file.name}-${file.size}-${file.lastModified}`);
  localLibrary.registerSessionFile(localId, file);
  return { file, localId };
}

async function pickViaFileSystemAccess(types: QuickOpenAccept[]): Promise<File | null> {
  try {
    const [handle] = await window.showOpenFilePicker({ types, multiple: false });
    return handle ? handle.getFile() : null;
  } catch {
    return null;
  }
}

function pickViaInput(types: QuickOpenAccept[]): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = types.flatMap((t) => Object.values(t.accept ?? {}).flat()).join(",");
    input.style.display = "none";
    input.addEventListener("change", () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    });
    input.addEventListener("cancel", () => {
      resolve(null);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

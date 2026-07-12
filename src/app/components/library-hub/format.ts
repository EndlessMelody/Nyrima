/** Small formatting helpers local to the Library hub — all real-data driven. */

/** "just now" / "4m ago" / "3h ago" / "Yesterday" / a date for older items. */
export function formatRelativeTime(epoch: number): string {
  if (!Number.isFinite(epoch) || epoch <= 0) return "";
  const diff = Date.now() - epoch;
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < min) return "just now";
  if (diff < hr) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hr)}h ago`;
  if (diff < 2 * day) return "Yesterday";
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(epoch).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Uppercase container label from a real filename / MIME, e.g. "MKV", "FLAC". */
export function fileFormatLabel(
  name: string | undefined,
  mime?: string,
): string | undefined {
  const ext = name?.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toUpperCase();
  const known = new Set([
    "MKV",
    "MP4",
    "WEBM",
    "AVI",
    "MOV",
    "M4V",
    "TS",
    "FLAC",
    "MP3",
    "M4A",
    "OPUS",
    "WAV",
    "AAC",
    "OGG",
    "EPUB",
    "PDF",
    "CBZ",
    "CBR",
    "ZIP",
  ]);
  if (ext && known.has(ext)) return ext;
  if (mime?.includes("matroska")) return "MKV";
  if (mime?.startsWith("video/")) return mime.split("/")[1]?.toUpperCase();
  if (mime?.startsWith("audio/")) return mime.split("/")[1]?.toUpperCase();
  return undefined;
}

/** Strip a trailing file extension for a cleaner display title. */
export function cleanTitle(name: string): string {
  return name.replace(/\.[a-z0-9]{2,5}$/i, "").trim() || name;
}

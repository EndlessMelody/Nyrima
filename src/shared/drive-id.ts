/**
 * Google Drive file/folder ids are URL-safe base64-ish tokens. Keep this
 * side-effect-free: it is shared by app pages, the background worker, and
 * content scripts.
 */

export const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{10,}$/;

export function isDriveId(value: unknown): value is string {
  return typeof value === "string" && DRIVE_ID_PATTERN.test(value);
}

export function assertDriveId(value: string, label = "Drive ID"): string {
  if (!isDriveId(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

export function decodeDriveIdParam(
  value: string | undefined,
): string | null {
  if (!value) return null;
  try {
    const decoded = decodeURIComponent(value);
    return isDriveId(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function escapeDriveQueryLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

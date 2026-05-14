/**
 * Domain-specific error classes so UI can react to specific failure modes
 * (private folder, missing key, etc.) with tailored messages rather than
 * dumping the raw Drive API error text.
 */

export type DriveAccessReason =
  | "no-api-key" // user hasn't configured an API key yet
  | "private-folder" // folder isn't shared "Anyone with the link"
  | "not-found" // the id doesn't exist or is in trash
  | "rate-limited" // 429 from Drive
  | "auth-required" // 401 — token expired or missing
  | "unknown";

export class DriveAccessError extends Error {
  reason: DriveAccessReason;
  status?: number;
  driveMessage?: string;

  constructor(
    reason: DriveAccessReason,
    message: string,
    status?: number,
    driveMessage?: string,
  ) {
    super(message);
    this.name = "DriveAccessError";
    this.reason = reason;
    this.status = status;
    this.driveMessage = driveMessage;
  }
}

/**
 * Classify a Drive API failure response into a DriveAccessError.
 * Reads + consumes the response body, so callers must not consume it first.
 */
export async function classifyDriveError(
  res: Response,
): Promise<DriveAccessError> {
  let driveMessage = "";
  try {
    const body = await res.json();
    driveMessage = body?.error?.message ?? "";
  } catch {
    try {
      driveMessage = await res.text();
    } catch {
      driveMessage = "";
    }
  }

  const m = driveMessage.toLowerCase();

  // API key invalid
  if (
    m.includes("api key not valid") ||
    m.includes("api_key_invalid") ||
    m.includes("bad request")
  ) {
    return new DriveAccessError(
      "no-api-key",
      "The configured Drive API key is invalid. Open Setup access and try a fresh key.",
      res.status,
      driveMessage,
    );
  }

  // 404 = file/folder not found or not accessible
  if (res.status === 404 || m.includes("not found") || m.includes("notfound")) {
    return new DriveAccessError(
      "not-found",
      "This file or folder wasn't found. It may have been moved, deleted, or not shared publicly.",
      res.status,
      driveMessage,
    );
  }

  if (res.status === 403) {
    if (m.includes("rate") || m.includes("quota") || m.includes("limit")) {
      return new DriveAccessError(
        "rate-limited",
        "Hit Drive's rate limit. Wait a minute and try again.",
        res.status,
        driveMessage,
      );
    }
    return new DriveAccessError(
      "private-folder",
      "Nyrima can't access this file. Either share it as Anyone with the link, or sign in.",
      res.status,
      driveMessage,
    );
  }

  if (res.status === 401) {
    return new DriveAccessError(
      "auth-required",
      "Drive rejected the request. Open the Setup guide and paste a valid API key, or sign in.",
      res.status,
      driveMessage,
    );
  }

  if (res.status === 429) {
    return new DriveAccessError(
      "rate-limited",
      "Drive is rate-limiting us. Wait a minute, then retry.",
      res.status,
      driveMessage,
    );
  }

  return new DriveAccessError(
    "unknown",
    `Drive API ${res.status} ${res.statusText}${driveMessage ? `: ${driveMessage}` : ""}`,
    res.status,
    driveMessage,
  );
}

/**
 * Shared "Local Library" entry for the `LibraryInsights.sources` list,
 * derived from `useLocalLibraryStore`'s status. `needs-permission` is a
 * normal, recoverable state (re-grant on the Local Folder page), not an
 * error — only a failed scan reports `"error"`.
 */

import type { LocalLibraryStatus } from "../../services/local-library/local-library-store";
import type { SourceStatusModel } from "./types";

export function describeLocalSource(
  status: LocalLibraryStatus,
  rootName: string,
  connectedDetail?: string,
): SourceStatusModel {
  switch (status) {
    case "ready":
      return {
        id: "local",
        name: "Local Library",
        state: "connected",
        detail: connectedDetail ?? (rootName || "Connected"),
      };
    case "needs-permission":
      return { id: "local", name: "Local Library", state: "disconnected", detail: "Needs permission — re-grant access" };
    case "indexing":
      return { id: "local", name: "Local Library", state: "disconnected", detail: "Indexing..." };
    case "error":
      return { id: "local", name: "Local Library", state: "error", detail: "Could not read local folder" };
    case "unsupported":
      return { id: "local", name: "Local Library", state: "disconnected", detail: "Not supported in this browser" };
    default:
      return { id: "local", name: "Local Library", state: "disconnected", detail: "Not connected" };
  }
}

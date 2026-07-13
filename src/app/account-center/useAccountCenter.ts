/**
 * useAccountCenter — open/close/section state for the Account Center overlay.
 *
 * The URL query param `?settings=<sectionId>` is the single source of truth:
 * it survives Protected re-mounts, makes sections deep-linkable, and lets the
 * browser Back button close the overlay. Query-only navigation deliberately
 * skips the route view-transition (see useViewTransitionLocation in App.tsx),
 * so opening never remounts or cross-fades the underlying page.
 */

import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

export const SETTINGS_PARAM = "settings";
export const DEFAULT_SECTION_ID = "my-account";

export interface AccountCenterControls {
  /** The raw `?settings=` value, or null when the overlay is closed. */
  activeSection: string | null;
  isOpen: boolean;
  /** Opens the overlay at a section (default "my-account"). Pushes a history
   *  entry so Back closes the overlay. Other query params are preserved. */
  open: (sectionId?: string) => void;
  /** Switches section while open, replacing history (no Back spam). */
  setSection: (sectionId: string) => void;
  /** Closes the overlay, replacing history and preserving other params. */
  close: () => void;
}

export function useAccountCenter(): AccountCenterControls {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeSection = searchParams.get(SETTINGS_PARAM);

  const open = useCallback(
    (sectionId: string = DEFAULT_SECTION_ID) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set(SETTINGS_PARAM, sectionId);
          return next;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  const setSection = useCallback(
    (sectionId: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set(SETTINGS_PARAM, sectionId);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const close = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(SETTINGS_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  return { activeSection, isOpen: activeSection !== null, open, setSection, close };
}

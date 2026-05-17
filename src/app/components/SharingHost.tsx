/**
 * SharingHost — mount point for the Phase 4 sharing dialogs.
 *
 * Lives at the App root (alongside Routes) so it survives navigation. It:
 *   - Hydrates the ShareProfile from chrome.storage on mount.
 *   - Listens for the `nyrima:topbar` CustomEvent dispatched by the
 *     AppShell topbar's Phase4Button when `scope === "share"`.
 *   - Coordinates the two dialogs:
 *       1. HandlePickerDialog — opens first if no ShareProfile exists.
 *       2. ShareComposerDialog — opens once a profile is in place.
 *   - After the picker saves a profile, automatically continues to the
 *     composer so the user only goes through onboarding once.
 *
 * Decoupling the host from the topbar keeps AppShell free of sharing-store
 * dependencies — Phase 4.2 (Inbox / Friends) can hang off the same event
 * channel without growing AppShell's import graph.
 */

import { useCallback, useEffect, useState } from "react";
import { useSharingStore } from "../stores/sharing-store";
import { HandlePickerDialog } from "./HandlePickerDialog";
import { ShareComposerDialog } from "./ShareComposerDialog";

interface TopbarEventDetail {
  scope: "search" | "friends" | "inbox" | "share";
}

export function SharingHost() {
  const profile = useSharingStore((s) => s.profile);
  const profileLoaded = useSharingStore((s) => s.profileLoaded);
  const loadProfile = useSharingStore((s) => s.loadProfile);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);

  // Hydrate the profile once on mount so the share button knows whether to
  // skip the picker.
  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const openShareFlow = useCallback(() => {
    if (!profile) {
      setPickerOpen(true);
    } else {
      setComposerOpen(true);
    }
  }, [profile]);

  useEffect(() => {
    function onTopbar(e: Event) {
      const detail = (e as CustomEvent<TopbarEventDetail>).detail;
      if (!detail) return;
      if (detail.scope === "share") openShareFlow();
      // Other scopes (search/friends/inbox) belong to Phase 4.2 — let
      // the dedicated hosts for those surfaces register their own listeners.
    }
    window.addEventListener("nyrima:topbar", onTopbar as EventListener);
    return () =>
      window.removeEventListener("nyrima:topbar", onTopbar as EventListener);
  }, [openShareFlow]);

  // If the user opens the share flow before the profile has hydrated, the
  // picker would flash open even when a profile exists. Gate the visible
  // dialogs on profileLoaded so the first frame after the click reads the
  // correct state. (Hydration is one chrome.storage read — sub-millisecond
  // in practice.)
  if (!profileLoaded) return null;

  return (
    <>
      <HandlePickerDialog
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSaved={() => {
          setPickerOpen(false);
          // Continue straight into the composer — the user clicked Share,
          // not "edit my profile". The picker dialog itself calls onClose
          // after onSaved, so we just bump the composer open.
          setComposerOpen(true);
        }}
      />
      <ShareComposerDialog
        isOpen={composerOpen}
        onClose={() => setComposerOpen(false)}
      />
    </>
  );
}

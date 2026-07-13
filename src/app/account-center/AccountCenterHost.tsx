/**
 * AccountCenterHost — the always-mounted entry point for the Account Center
 * overlay (SharingHost pattern; mounted once inside Protected).
 *
 * Open state is the `?settings=` URL param. The host lazy-loads the overlay
 * body on first open and runs a tiny phase machine so the exit animation can
 * play after the param is already gone: while "closing" it keeps rendering
 * with the last-known section for one animation beat.
 */

import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useSettingsStore } from "@app/stores/settings-store";
import { useAccountCenter } from "./useAccountCenter";
import { getSection } from "./registry";

const AccountCenterBody = lazy(() => import("./AccountCenter"));

const CLOSE_ANIMATION_MS = 150;

export function AccountCenterHost() {
  const { activeSection, isOpen, setSection, close } = useAccountCenter();
  const reducedMotion = useSettingsStore((s) => s.settings.reducedMotion);
  const [rendered, setRendered] = useState(isOpen);
  const [closing, setClosing] = useState(false);
  const lastSectionRef = useRef<string>("my-account");
  const closeTimerRef = useRef<number>(0);

  if (activeSection !== null) {
    lastSectionRef.current = getSection(activeSection).id;
  }

  useEffect(() => {
    if (isOpen) {
      window.clearTimeout(closeTimerRef.current);
      setRendered(true);
      setClosing(false);
      return;
    }
    if (!rendered) return;
    const skipAnimation =
      reducedMotion ||
      (typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (skipAnimation) {
      setRendered(false);
      return;
    }
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setRendered(false);
      setClosing(false);
    }, CLOSE_ANIMATION_MS);
    return () => window.clearTimeout(closeTimerRef.current);
  }, [isOpen, rendered, reducedMotion]);

  if (!rendered) return null;

  return (
    <Suspense fallback={null}>
      <AccountCenterBody
        sectionId={
          activeSection !== null
            ? getSection(activeSection).id
            : lastSectionRef.current
        }
        closing={closing}
        onSelectSection={setSection}
        onClose={close}
      />
    </Suspense>
  );
}

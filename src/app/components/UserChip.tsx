/**
 * UserChip — avatar + name chip in the AppShell header.
 *
 * Shows the Google profile avatar and truncated name when OAuth is active,
 * or a generic monogram "G" for API-key-only (guest) mode.
 * Clicking toggles the UserCenter dropdown.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getUserProfile } from "../services/user-profile";
import { UserCenter } from "./UserCenter";
import type { UserProfile } from "@shared/types";
import "./UserChip.scss";

export function UserChip() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [open, setOpen] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void getUserProfile().then((p) => {
      if (!cancelled) setProfile(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (
        chipRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  const initial = profile?.name?.[0]?.toUpperCase() ?? "G";
  const displayName = profile?.name ?? "Guest";

  return (
    <div className="dc-user-chip-wrap">
      <button
        ref={chipRef}
        type="button"
        className={`dc-user-chip${open ? " is-open" : ""}`}
        onClick={toggle}
        aria-label="Open user menu"
        aria-expanded={open}
      >
        {profile?.picture ? (
          <img
            className="dc-user-chip__avatar"
            src={profile.picture}
            alt=""
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="dc-user-chip__monogram">{initial}</span>
        )}
        <span className="dc-user-chip__name">{displayName}</span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div ref={panelRef}>
          <UserCenter
            profile={profile}
            onClose={() => setOpen(false)}
            onProfileChange={setProfile}
          />
        </div>
      )}
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`dc-user-chip__chevron${open ? " is-open" : ""}`}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 6l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * HandlePickerDialog — first-use share-profile picker.
 *
 * Triggered the first time the user clicks the topbar Share button (or
 * opens the Sharing panel) while no ShareProfile exists in storage.
 * Saves the handle + name + avatar into chrome.storage; subsequent shares
 * stamp this profile as the `author` of every ShareEntry and ShareComment.
 *
 * Defaults:
 *   - handle  : derived from the Google profile name (lower-cased,
 *               whitespace stripped) if a profile is connected, else empty.
 *   - name    : Google profile displayName.
 *   - avatar  : Google profile picture URL (toggle to opt out).
 *
 * Validation lives in `share-profile.ts` so the same rules apply if a
 * profile is restored from a Drive backup later.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Column,
  Row,
  Text,
  Button,
  Input,
  Dialog,
  Spinner,
} from "@once-ui-system/core/components";
import { useSharingStore } from "../stores/sharing-store";
import { validateShareHandle } from "../services/sharing";
import { getUserProfile } from "../services/user-profile";
import type { UserProfile } from "@shared/types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Fired after a successful save. Caller typically continues to the
   *  share composer with the freshly-saved profile. */
  onSaved?: () => void;
}

export function HandlePickerDialog({ isOpen, onClose, onSaved }: Props) {
  const profile = useSharingStore((s) => s.profile);
  const saveProfile = useSharingStore((s) => s.saveProfile);

  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [useGoogleAvatar, setUseGoogleAvatar] = useState(true);
  const [googleProfile, setGoogleProfile] = useState<UserProfile | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate defaults on open. When editing an existing profile, prefill from
  // it; on first-use, prefill from the Google profile when available.
  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setSubmitting(false);
    if (profile) {
      setHandle(profile.handle);
      setName(profile.name ?? "");
      setAvatarUrl(profile.avatarUrl ?? "");
      setUseGoogleAvatar(false);
      return;
    }
    // First-use path — try the Google profile for sensible defaults.
    let cancelled = false;
    void (async () => {
      const g = await getUserProfile().catch(() => null);
      if (cancelled) return;
      setGoogleProfile(g);
      if (g) {
        setHandle(slugifyName(g.name ?? g.email));
        setName(g.name ?? "");
        setAvatarUrl(g.picture ?? "");
        setUseGoogleAvatar(Boolean(g.picture));
      } else {
        setHandle("");
        setName("");
        setAvatarUrl("");
        setUseGoogleAvatar(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, profile]);

  const liveError = useMemo(() => validateShareHandle(handle), [handle]);

  async function onSubmit() {
    if (liveError) {
      setError(liveError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await saveProfile({
        handle: handle.trim(),
        name: name.trim() || undefined,
        avatarUrl:
          (useGoogleAvatar && googleProfile?.picture) || avatarUrl
            ? useGoogleAvatar
              ? googleProfile?.picture
              : avatarUrl.trim() || undefined
            : undefined,
      });
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save profile.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={profile ? "Edit your share profile" : "Pick a share handle"}
      description={
        profile
          ? "Update how you're attributed on shares + comments."
          : "Friends will see this handle whenever you share something."
      }
      style={{ backgroundColor: "var(--page-background)" }}
      footer={
        <Row gap="8">
          <Button variant="tertiary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={onSubmit}
            disabled={submitting || Boolean(liveError)}
          >
            {submitting ? <Spinner size="xs" /> : profile ? "Save" : "Continue"}
          </Button>
        </Row>
      }
    >
      <Column gap="12" paddingY="8">
        <Input
          id="share-handle"
          label="Handle"
          value={handle}
          onChange={(e) => setHandle(e.target.value.toLowerCase())}
          placeholder="e.g. khoa"
          autoFocus={!profile}
          disabled={submitting}
          onKeyDown={(e) => {
            if (e.key === "Enter") void onSubmit();
          }}
        />
        {liveError && handle.length > 0 && (
          <Text variant="body-default-xs" onBackground="neutral-weak">
            {liveError}
          </Text>
        )}
        <Input
          id="share-name"
          label="Display name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Đăng Khoa"
          disabled={submitting}
        />

        {googleProfile?.picture && (
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontFamily: "var(--dc-font-mono)",
              fontSize: "0.75rem",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--neutral-on-background-medium)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={useGoogleAvatar}
              onChange={(e) => setUseGoogleAvatar(e.target.checked)}
              disabled={submitting}
            />
            <span>Use Google profile avatar</span>
            <img
              src={googleProfile.picture}
              alt=""
              referrerPolicy="no-referrer"
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                opacity: useGoogleAvatar ? 1 : 0.4,
              }}
            />
          </label>
        )}

        {!useGoogleAvatar && (
          <Input
            id="share-avatar"
            label="Avatar URL (optional)"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://..."
            disabled={submitting}
          />
        )}

        {error && (
          <Text variant="body-default-xs" onBackground="danger-medium">
            {error}
          </Text>
        )}

        <Text variant="body-default-xs" onBackground="neutral-weak">
          Lower-case letters, digits, dash, underscore. 3–32 characters.
        </Text>
      </Column>
    </Dialog>
  );
}

/** Normalise a free-form name into a candidate handle slug. */
function slugifyName(input: string | undefined): string {
  if (!input) return "";
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9_-]+/g, "")
    .slice(0, 32);
}

/**
 * Profile — per-user personalization: nickname, avatar, and profile banner
 * with a live Discord-style preview card. Everything persists locally through
 * AppSettings (per-account storage namespace / Supabase user_settings blob).
 *
 * For signed-in users the nickname is also pushed to the social `profiles`
 * table (display_name) so friends see it. The banner stays local-only by
 * design. The avatar additionally uploads to Supabase Storage (best-effort,
 * same try/catch pattern as the nickname sync) so it's visible to other
 * users on the public-ish profile dashboard — the local data URL remains
 * the source of truth for the app's own chrome (offline-safe, zero network
 * cost), the uploaded copy is just for other people's view of you.
 */

import { useRef, useState, type ChangeEvent } from "react";
import { Upload, Trash2 } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { useSettingsStore } from "@app/stores/settings-store";
import type { SectionProps } from "../registry";

const AVATAR_SIZE = 256;
const BANNER_WIDTH = 1200;
const BANNER_HEIGHT = 480;
const JPEG_QUALITY = 0.85;

export function ProfileSection({ highlightSettingId: _ }: SectionProps) {
  const { status, account } = useAuth();
  const settings = useSettingsStore((s) => s.settings);
  const patch = useSettingsStore((s) => s.patch);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const bannerInputRef = useRef<HTMLInputElement | null>(null);
  const [nickname, setNickname] = useState(settings.profileNickname ?? "");
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveName =
    nickname.trim() || account?.displayName || "Guest";
  const initial = effectiveName[0]?.toUpperCase() ?? "N";
  const nicknameDirty = nickname.trim() !== (settings.profileNickname ?? "");

  async function saveNickname() {
    const trimmed = nickname.trim();
    setSaving(true);
    setError(null);
    try {
      await patch({ profileNickname: trimmed || undefined });
      // Mirror the nickname to the social profile so friends see it. Guests
      // and local-mock sessions skip this — the profiles table needs a real
      // Supabase session.
      if (trimmed && status === "authenticated") {
        try {
          const { ensureSocialProfile } = await import(
            "@app/services/social/social-api"
          );
          await ensureSocialProfile({ displayName: trimmed });
        } catch {
          // Social sync is best-effort; the local nickname is already saved.
        }
      }
      setSavedTick(true);
      window.setTimeout(() => setSavedTick(false), 1600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the nickname.");
    } finally {
      setSaving(false);
    }
  }

  function handleImagePick(
    e: ChangeEvent<HTMLInputElement>,
    kind: "avatar" | "banner",
  ) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      void (async () => {
        try {
          const dataUrl =
            kind === "avatar"
              ? await coverCrop(String(reader.result), AVATAR_SIZE, AVATAR_SIZE)
              : await coverCrop(String(reader.result), BANNER_WIDTH, BANNER_HEIGHT);
          await patch(
            kind === "avatar"
              ? { profileAvatarDataUrl: dataUrl }
              : { profileBannerDataUrl: dataUrl },
          );
          setError(null);
          if (kind === "avatar" && status === "authenticated") {
            try {
              const blob = await (await fetch(dataUrl)).blob();
              const { uploadAvatar } = await import("@app/services/social/social-api");
              await uploadAvatar(blob);
            } catch {
              // Social sync is best-effort; the local avatar is already saved.
            }
          }
        } catch {
          setError("We could not process that image.");
        }
      })();
    };
    reader.onerror = () => setError("We could not read that image.");
    reader.readAsDataURL(file);
  }

  return (
    <div className="ny-ac__section-body">
      {/* Live preview card */}
      <div className="ny-ac__profile-card ny-ac__profile-card--preview">
        <div
          className="ny-ac__profile-banner"
          style={
            settings.profileBannerDataUrl
              ? { backgroundImage: `url(${settings.profileBannerDataUrl})` }
              : undefined
          }
        />
        <div className="ny-ac__profile-head">
          {settings.profileAvatarDataUrl ? (
            <img
              className="ny-ac__profile-avatar"
              src={settings.profileAvatarDataUrl}
              alt=""
            />
          ) : (
            <span className="ny-ac__profile-avatar ny-ac__profile-avatar--mono">
              {initial}
            </span>
          )}
          <div className="ny-ac__profile-id">
            <span className="ny-ac__profile-name">{effectiveName}</span>
            <span className="ny-ac__profile-sub">
              {account?.email ?? "Local profile"}
            </span>
          </div>
          <span className="ny-ac__preview-tag">Preview</span>
        </div>
      </div>

      {/* Nickname */}
      <div className="ny-ac__card" data-setting-id="profile-nickname">
        <div className="ny-ac__row ny-ac__row--stack">
          <div>
            <div className="ny-ac__row-label">Nickname</div>
            <div className="ny-ac__row-sub">
              Shown across Nyrima instead of your account name.
              {status === "authenticated" && " Friends see it too."}
            </div>
          </div>
          <div className="ny-ac__inline-form">
            <input
              type="text"
              className="ny-ac__input"
              value={nickname}
              maxLength={48}
              placeholder={account?.displayName ?? "Pick a nickname"}
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && nicknameDirty) void saveNickname();
              }}
            />
            <button
              type="button"
              className="ny-btn ny-btn--primary"
              disabled={saving || !nicknameDirty}
              onClick={() => void saveNickname()}
            >
              {saving ? "Saving…" : savedTick ? "Saved ✓" : "Save"}
            </button>
          </div>
        </div>
      </div>

      {/* Avatar */}
      <div className="ny-ac__card" data-setting-id="profile-avatar">
        <div className="ny-ac__row">
          <div>
            <div className="ny-ac__row-label">Avatar</div>
            <div className="ny-ac__row-sub">
              Square image, stored on this device (max {AVATAR_SIZE}px).
            </div>
          </div>
          <div className="ny-ac__actions-row">
            <button
              type="button"
              className="ny-btn ny-btn--ghost"
              onClick={() => avatarInputRef.current?.click()}
            >
              <Upload aria-hidden="true" />
              {settings.profileAvatarDataUrl ? "Replace" : "Upload"}
            </button>
            <button
              type="button"
              className="ny-btn ny-btn--ghost"
              disabled={!settings.profileAvatarDataUrl}
              onClick={() => {
                void patch({ profileAvatarDataUrl: undefined });
                if (status === "authenticated") {
                  void import("@app/services/social/social-api")
                    .then(({ clearMyAvatarUrl }) => clearMyAvatarUrl())
                    .catch(() => undefined);
                }
              }}
            >
              <Trash2 aria-hidden="true" />
              Remove
            </button>
          </div>
        </div>
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/*"
          className="ny-ac__file-input"
          onChange={(e) => handleImagePick(e, "avatar")}
        />
      </div>

      {/* Banner */}
      <div className="ny-ac__card" data-setting-id="profile-banner">
        <div className="ny-ac__row">
          <div>
            <div className="ny-ac__row-label">Profile banner</div>
            <div className="ny-ac__row-sub">
              Wide image behind your profile card ({BANNER_WIDTH}×{BANNER_HEIGHT}).
            </div>
          </div>
          <div className="ny-ac__actions-row">
            <button
              type="button"
              className="ny-btn ny-btn--ghost"
              onClick={() => bannerInputRef.current?.click()}
            >
              <Upload aria-hidden="true" />
              {settings.profileBannerDataUrl ? "Replace" : "Upload"}
            </button>
            <button
              type="button"
              className="ny-btn ny-btn--ghost"
              disabled={!settings.profileBannerDataUrl}
              onClick={() => void patch({ profileBannerDataUrl: undefined })}
            >
              <Trash2 aria-hidden="true" />
              Remove
            </button>
          </div>
        </div>
        <input
          ref={bannerInputRef}
          type="file"
          accept="image/*"
          className="ny-ac__file-input"
          onChange={(e) => handleImagePick(e, "banner")}
        />
      </div>

      {error && (
        <p className="ny-ac__error" role="status">
          {error}
        </p>
      )}
    </div>
  );
}

/** Center-crops the source to cover the target box and returns a capped
 *  jpeg data URL — keeps the appSettings blob small. */
async function coverCrop(
  src: string,
  width: number,
  height: number,
): Promise<string> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("load"));
    img.src = src;
  });
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  ctx.drawImage(
    image,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

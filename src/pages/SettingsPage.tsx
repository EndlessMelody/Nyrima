/**
 * SettingsPage — full-page settings for the web app.
 *
 * Surfaces the same controls available in the header UserCenter popover, but
 * as a dedicated route: account, appearance, Drive connection, API
 * credentials, and subtitle typography. Reuses existing self-contained panels
 * (`ApiConfigPanel`, `SubtitleConfigPanel`) and the Drive wizard
 * (`ConnectDriveScreen`) rather than re-implementing them.
 */

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import cn from "classnames";
import {
  Check,
  Image as ImageIcon,
  Move,
  Trash2,
  Upload,
  ZoomIn,
} from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { useTheme } from "@app/providers/AppProviders";
import { useNyrimaRootStore } from "@app/stores/nyrima-root-store";
import { useSettingsStore } from "@app/stores/settings-store";
import { hasApiKey } from "@app/services/api-key";
import { ConnectDriveScreen } from "@app/components/ConnectDriveScreen";
import { ApiConfigPanel } from "@app/components/ApiConfigPanel";
import { SubtitleConfigPanel } from "@app/components/SubtitleConfigPanel";
import "./SettingsPage.scss";

const LOBBY_BANNER_CROP_WIDTH = 1560;
const LOBBY_BANNER_CROP_HEIGHT = 300;
const LOBBY_BANNER_ASPECT_LABEL = "5.2:1";

export function SettingsPage() {
  const navigate = useNavigate();
  const { status, account, signOut, exitGuestMode } = useAuth();
  const isGuest = status === "guest";
  const { mode, setMode } = useTheme();
  const patch = useSettingsStore((s) => s.patch);

  const root = useNyrimaRootStore((s) => s.root);
  const loadRoot = useNyrimaRootStore((s) => s.load);
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    void loadRoot();
    void hasApiKey().then(setKeyConfigured);
  }, [loadRoot]);

  async function handleAccountSignOut() {
    await signOut();
    navigate("/", { replace: true });
  }

  return (
      <div className="ny-settings">
      <header className="ny-settings__head">
        <span className="dc-tracker">Settings</span>
        <h1 className="ny-settings__title">Settings</h1>
        <p className="ny-settings__sub">
          Manage your account, appearance, Drive connection, and playback.
        </p>
      </header>

      {/* Account */}
      <section className="ny-settings__section">
        <h2 className="ny-settings__section-title">Account</h2>
        {isGuest ? (
          <div className="ny-settings__row">
            <div>
              <div className="ny-settings__row-label">Guest mode</div>
              <div className="ny-settings__row-value">
                No Nyrima account{" "}
                <span className="ny-settings__muted">
                  (social &amp; cloud sync are off)
                </span>
              </div>
            </div>
            <div className="ny-settings__row-actions">
              <button
                type="button"
                className="ny-btn ny-btn--primary"
                onClick={() => navigate("/login")}
              >
                Sign in
              </button>
              <button
                type="button"
                className="ny-btn ny-btn--ghost"
                onClick={() => {
                  exitGuestMode();
                  navigate("/login", { replace: true });
                }}
              >
                Exit guest mode
              </button>
            </div>
          </div>
        ) : (
          <div className="ny-settings__row">
            <div>
              <div className="ny-settings__row-label">Signed in as</div>
              <div className="ny-settings__row-value">
                {account?.displayName ?? "—"}{" "}
                <span className="ny-settings__muted">({account?.email})</span>
              </div>
            </div>
            <div className="ny-settings__row-actions">
              <button
                type="button"
                className="ny-btn ny-btn--ghost"
                onClick={() => navigate("/account")}
              >
                View account
              </button>
              <button
                type="button"
                className="ny-btn ny-btn--ghost"
                onClick={() => void handleAccountSignOut()}
              >
                Sign out
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Appearance */}
      <section className="ny-settings__section">
        <h2 className="ny-settings__section-title">Appearance</h2>
        <div className="ny-settings__pills">
          {(["dark", "light", "system"] as const).map((m) => (
            <button
              type="button"
              key={m}
              className={cn("ny-settings__pill", { "is-active": mode === m })}
              onClick={() => {
                setMode(m);
                void patch({ theme: m });
              }}
            >
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        <LobbyBannerSettings />
      </section>

      {/* Drive connection */}
      <section className="ny-settings__section">
        <h2 className="ny-settings__section-title">Drive connection</h2>
        <div className="ny-settings__panel">
          <ConnectDriveScreen
            keyConfigured={!!keyConfigured}
            rootPaired={!!root}
            rootName={root?.name ?? null}
            onKeySaved={() => setKeyConfigured(true)}
          />
        </div>
      </section>

      {/* API credentials */}
      <section className="ny-settings__section">
        <h2 className="ny-settings__section-title">API credentials</h2>
        <div className="ny-settings__panel">
          <ApiConfigPanel />
        </div>
      </section>

      {/* Subtitles */}
      <section className="ny-settings__section">
        <h2 className="ny-settings__section-title">Subtitle typography</h2>
        <div className="ny-settings__panel">
          <SubtitleConfigPanel />
        </div>
      </section>
      </div>
  );
}

interface CropOffset {
  x: number;
  y: number;
}

interface ImageSize {
  width: number;
  height: number;
}

function LobbyBannerSettings() {
  const settings = useSettingsStore((s) => s.settings);
  const patch = useSettingsStore((s) => s.patch);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origin: CropOffset;
  } | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [sourceSize, setSourceSize] = useState<ImageSize | null>(null);
  const [offset, setOffset] = useState<CropOffset>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const currentBanner = settings.lobbyBannerImageDataUrl ?? "/poster.png";
  const hasCustomBanner = !!settings.lobbyBannerImageDataUrl;
  const hasDraft = !!sourceUrl;

  function clampOffset(next: CropOffset, nextZoom = zoom): CropOffset {
    const frame = frameRef.current;
    const size = sourceSize;
    if (!frame || !size) return next;
    const { width: frameWidth, height: frameHeight } = frame.getBoundingClientRect();
    const baseScale = Math.max(frameWidth / size.width, frameHeight / size.height);
    const renderedWidth = size.width * baseScale * nextZoom;
    const renderedHeight = size.height * baseScale * nextZoom;
    const maxX = Math.max(0, (renderedWidth - frameWidth) / 2);
    const maxY = Math.max(0, (renderedHeight - frameHeight) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setSourceUrl(String(reader.result));
      setFileName(file.name);
      setSourceSize(null);
      setOffset({ x: 0, y: 0 });
      setZoom(1);
      setError(null);
    };
    reader.onerror = () => setError("We could not read that image.");
    reader.readAsDataURL(file);
  }

  function handleImageLoad() {
    const image = imageRef.current;
    if (!image) return;
    setSourceSize({
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
    setOffset({ x: 0, y: 0 });
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!sourceUrl) return;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origin: offset,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const next = {
      x: drag.origin.x + e.clientX - drag.startX,
      y: drag.origin.y + e.clientY - drag.startY,
    };
    setOffset(clampOffset(next));
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (drag?.pointerId === e.pointerId) {
      dragRef.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  function handleZoomChange(value: number) {
    const nextZoom = Math.max(1, Math.min(3, value));
    setZoom(nextZoom);
    setOffset((current) => clampOffset(current, nextZoom));
  }

  async function applyCrop() {
    const source = sourceUrl;
    const frame = frameRef.current;
    const size = sourceSize;
    if (!source || !frame || !size) return;
    setSaving(true);
    setError(null);
    try {
      const image = await loadImage(source);
      const rect = frame.getBoundingClientRect();
      const scaleX = LOBBY_BANNER_CROP_WIDTH / rect.width;
      const scaleY = LOBBY_BANNER_CROP_HEIGHT / rect.height;
      const baseScale = Math.max(rect.width / size.width, rect.height / size.height);
      const renderedWidth = size.width * baseScale * zoom;
      const renderedHeight = size.height * baseScale * zoom;
      const canvas = document.createElement("canvas");
      canvas.width = LOBBY_BANNER_CROP_WIDTH;
      canvas.height = LOBBY_BANNER_CROP_HEIGHT;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas is not available.");
      ctx.fillStyle = "#060814";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(
        image,
        ((rect.width - renderedWidth) / 2 + offset.x) * scaleX,
        ((rect.height - renderedHeight) / 2 + offset.y) * scaleY,
        renderedWidth * scaleX,
        renderedHeight * scaleY,
      );
      await patch({
        lobbyBannerImageDataUrl: canvas.toDataURL("image/jpeg", 0.9),
        lobbyBannerUpdatedAt: Date.now(),
      });
      setSourceUrl(null);
      setFileName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not crop that image.");
    } finally {
      setSaving(false);
    }
  }

  async function resetBanner() {
    await patch({
      lobbyBannerImageDataUrl: null,
      lobbyBannerUpdatedAt: null,
    });
    setSourceUrl(null);
    setFileName("");
    setError(null);
  }

  return (
    <section className="ny-banner-setting" aria-label="Lobby Banner">
      <div className="ny-banner-setting__header">
        <div>
          <div className="ny-settings__row-label">Lobby Banner</div>
          <div className="ny-settings__row-value">
            {hasCustomBanner ? "Custom image active" : "Using default image"}
          </div>
        </div>
        <div className="ny-banner-setting__actions">
          <button
            type="button"
            className="ny-btn ny-btn--ghost"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload aria-hidden="true" />
            {hasCustomBanner ? "Replace" : "Upload"}
          </button>
          <button
            type="button"
            className="ny-btn ny-btn--ghost"
            disabled={!hasCustomBanner && !hasDraft}
            onClick={() => void resetBanner()}
          >
            <Trash2 aria-hidden="true" />
            Reset
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        className="ny-banner-setting__file"
        type="file"
        accept="image/*"
        onChange={handleFileChange}
      />

      {hasDraft ? (
        <div className="ny-banner-crop">
          <div
            ref={frameRef}
            className="ny-banner-crop__frame"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            role="img"
            aria-label="Crop preview"
          >
            <img
              ref={imageRef}
              src={sourceUrl}
              alt=""
              draggable={false}
              onLoad={handleImageLoad}
              style={{
                transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
              }}
            />
            <span className="ny-banner-crop__hint">
              <Move aria-hidden="true" />
              Drag to frame
            </span>
          </div>
          <div className="ny-banner-crop__controls">
            <span className="ny-banner-crop__file" title={fileName}>
              <ImageIcon aria-hidden="true" />
              {fileName || "Selected image"}
            </span>
            <label className="ny-banner-crop__zoom">
              <ZoomIn aria-hidden="true" />
              <input
                type="range"
                min="1"
                max="3"
                step="0.05"
                value={zoom}
                onChange={(e) => handleZoomChange(Number(e.target.value))}
              />
            </label>
            <span className="ny-banner-crop__ratio">{LOBBY_BANNER_ASPECT_LABEL}</span>
            <button
              type="button"
              className="ny-btn ny-btn--primary"
              disabled={saving || !sourceSize}
              onClick={() => void applyCrop()}
            >
              <Check aria-hidden="true" />
              {saving ? "Saving..." : "Apply banner"}
            </button>
          </div>
        </div>
      ) : (
        <div className="ny-banner-setting__preview">
          <img src={currentBanner} alt="" />
          <div>
            <span>Preview</span>
            <strong>{hasCustomBanner ? "Your cropped lobby banner" : "Default lobby banner"}</strong>
          </div>
        </div>
      )}

      {error && (
        <p className="ny-banner-setting__error" role="status">
          {error}
        </p>
      )}
    </section>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("We could not load that image."));
    image.src = src;
  });
}

/**
 * LobbyBannerSettings — upload + drag-to-frame crop tool for the custom lobby
 * banner (5.2:1). Extracted verbatim from the retired SettingsPage so the
 * Account Center's Appearance section can embed it.
 */

import { useRef, useState, type ChangeEvent } from "react";
import {
  Check,
  Image as ImageIcon,
  Move,
  Trash2,
  Upload,
  ZoomIn,
} from "lucide-react";
import { useSettingsStore } from "@app/stores/settings-store";
import "./LobbyBannerSettings.scss";

const LOBBY_BANNER_CROP_WIDTH = 1560;
const LOBBY_BANNER_CROP_HEIGHT = 300;
const LOBBY_BANNER_ASPECT_LABEL = "5.2:1";

interface CropOffset {
  x: number;
  y: number;
}

interface ImageSize {
  width: number;
  height: number;
}

export function LobbyBannerSettings() {
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
          <div className="ny-ac__row-label">Lobby Banner</div>
          <div className="ny-ac__row-sub">
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

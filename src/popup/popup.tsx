/**
 * Toolbar popup — the "quick button" UI.
 *
 * 360 px wide launcher dressed in the Obsidian-Atelier system that the rest
 * of the app uses: hairline borders, mono tracker labels, kana captions,
 * champagne-gold + sakura accents. Sidesteps Once UI chrome the same way
 * AppShell does, because the popup needs precise hairline/typography
 * control that Once UI's defaults fight.
 *
 * Surfaces:
 *   - Status chip in the header (DRIVE · LINKED / DRIVE · SETUP)
 *   - "Open Library" primary CTA (opens the app page)
 *   - Pinned + Recent folder sections, with pin toggle per item
 *   - Welcome empty-state with a setup-access CTA when nothing exists yet
 *   - Mono footer with build stamp + Manage access link
 */

import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "@once-ui-system/core/css/styles.css";
import "@once-ui-system/core/css/tokens.css";
import "@fontsource/klee-one/400.css";
import "@fontsource/klee-one/600.css";
import "@fontsource/m-plus-rounded-1c/400.css";
import "@fontsource/m-plus-rounded-1c/500.css";
import "@fontsource/zen-kaku-gothic-new/400.css";
import "../app/styles/fonts.scss";
import "../app/styles/anime-theme.scss";
import "./popup.scss";
import type { RecentFolder } from "@shared/types";
import { APP_PAGE } from "@shared/constants";
import {
  getRecentFolders,
  togglePinRecentFolder,
} from "../app/services/storage";
import { getApiKey } from "../app/services/api-key";

function openApp(hash = ""): void {
  const url = chrome.runtime.getURL(APP_PAGE) + (hash ? `#${hash}` : "");
  chrome.tabs.create({ url });
  window.close();
}

function openAppWithQuery(query: string, hash = "/"): void {
  // Hash routing lives after the # already, so we tack the query *before* the
  // hash so the landing page can read it via location.search.
  const url = chrome.runtime.getURL(APP_PAGE) + `?${query}#${hash}`;
  chrome.tabs.create({ url });
  window.close();
}

function formatRelative(epochMs: number): string {
  const diff = Date.now() - epochMs;
  if (diff < 0 || !Number.isFinite(diff)) return "now";
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

function PopMark() {
  // Mirrors .dc-shell__mark from AppShell.scss — hairline-tile square with a
  // gold dot inside, sized down to 22 px for the popup header.
  return <span className="dc-pop-mark" aria-hidden />;
}

function StatusChip({
  configured,
  onClick,
}: {
  configured: boolean | null;
  onClick: () => void;
}) {
  // null = loading; render a quiet placeholder so the header doesn't jump.
  if (configured === null) {
    return <span className="dc-pop-status is-loading" aria-hidden />;
  }
  const ok = configured;
  return (
    <button
      type="button"
      className={`dc-pop-status ${ok ? "is-ok" : "is-warn"}`}
      onClick={onClick}
      title={
        ok
          ? "Drive access is configured"
          : "Drive access not configured — click to set up"
      }
    >
      <span className="dc-pop-status__dot" aria-hidden />
      <span className="dc-pop-status__label">
        {ok ? "DRIVE · LINKED" : "DRIVE · SETUP"}
      </span>
    </button>
  );
}

function SakuraGlyph({ size = 24 }: { size?: number }) {
  // 5-petal hairline sakura glyph used as the thumbnail placeholder and
  // empty-state mark. Stroke uses currentColor so the parent decides hue.
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinejoin="round"
    >
      {Array.from({ length: 5 }).map((_, i) => {
        const angle = (i / 5) * 360;
        return (
          <ellipse
            key={i}
            cx="12"
            cy="6"
            rx="3"
            ry="5"
            transform={`rotate(${angle} 12 12)`}
          />
        );
      })}
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function FolderItem({
  folder,
  onOpen,
  onTogglePin,
}: {
  folder: RecentFolder;
  onOpen: () => void;
  onTogglePin: () => void;
}) {
  const meta: string[] = [];
  if (typeof folder.itemCount === "number" && folder.itemCount > 0) {
    meta.push(`${folder.itemCount} ${folder.itemCount === 1 ? "video" : "videos"}`);
  }
  if (folder.lastOpenedAt) meta.push(formatRelative(folder.lastOpenedAt));

  return (
    <div className="dc-pop-item">
      <button
        type="button"
        className="dc-pop-item__main"
        onClick={onOpen}
        title={folder.name}
      >
        <span className="dc-pop-thumb" aria-hidden>
          <SakuraGlyph size={22} />
        </span>
        <span className="dc-pop-item__body">
          <span className="dc-pop-item__name">{folder.name}</span>
          {meta.length > 0 && (
            <span className="dc-pop-meta">
              {meta.map((m, i) => (
                <React.Fragment key={m}>
                  {i > 0 && <span className="dc-pop-meta__sep">·</span>}
                  <span className="dc-pop-meta__pill">{m}</span>
                </React.Fragment>
              ))}
            </span>
          )}
        </span>
        <span className="dc-pop-item__arrow" aria-hidden>
          ↗
        </span>
      </button>
      <button
        type="button"
        className={`dc-pop-pin ${folder.pinned ? "is-on" : ""}`}
        onClick={onTogglePin}
        title={folder.pinned ? "Unpin" : "Pin to top"}
        aria-label={folder.pinned ? "Unpin folder" : "Pin folder"}
        aria-pressed={folder.pinned ?? false}
      >
        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden>
          <path
            d="M12 2l2.6 6.4 6.9.6-5.2 4.6 1.6 6.7L12 16.9l-5.9 3.4 1.6-6.7L2.5 9l6.9-.6z"
            fill={folder.pinned ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="1"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}

function Popup() {
  const [folders, setFolders] = useState<RecentFolder[]>([]);
  const [apiKeyConfigured, setApiKeyConfigured] = useState<boolean | null>(
    null,
  );

  useEffect(() => {
    void getRecentFolders().then(setFolders);
    void getApiKey().then((k) => setApiKeyConfigured(Boolean(k)));
  }, []);

  async function handleTogglePin(folderId: string) {
    const next = await togglePinRecentFolder(folderId);
    setFolders(next);
  }

  const pinned = folders.filter((f) => f.pinned).slice(0, 3);
  const recent = folders.filter((f) => !f.pinned).slice(0, 5);
  const empty = folders.length === 0;
  const recentSectionNumber = pinned.length > 0 ? "02" : "01";

  return (
    <div className="dc-pop">
      <header className="dc-pop-header">
        <div className="dc-pop-brand">
          <PopMark />
          <span className="dc-pop-wordmark">
            <span className="dc-pop-name">
              Nyri<span className="dc-pop-name__accent">ma</span>
            </span>
            <span className="dc-pop-sub">NY · ドライブ・シネマ</span>
          </span>
        </div>
        <StatusChip
          configured={apiKeyConfigured}
          onClick={() => {
            if (apiKeyConfigured) {
              openApp("/");
            } else {
              openAppWithQuery("setup=1");
            }
          }}
        />
      </header>

      <button
        type="button"
        className="dc-pop-cta"
        onClick={() => openApp("/")}
      >
        <span className="dc-pop-cta__glyph" aria-hidden>
          ▶
        </span>
        <span className="dc-pop-cta__label">Open Library</span>
        <span className="dc-pop-cta__sub">ライブラリへ</span>
      </button>

      {empty ? (
        <div className="dc-pop-empty">
          <span className="dc-pop-empty__glyph" aria-hidden>
            <SakuraGlyph size={36} />
          </span>
          <span className="dc-pop-empty__kana">ようこそ · WELCOME</span>
          <p className="dc-pop-empty__body">
            Open a Drive folder with Nyrima to see it here. Right-click any
            folder on drive.google.com to start.
          </p>
          {apiKeyConfigured === false && (
            <button
              type="button"
              className="dc-pop-empty__cta"
              onClick={() => openAppWithQuery("setup=1")}
            >
              Setup access
            </button>
          )}
        </div>
      ) : (
        <>
          {pinned.length > 0 && (
            <section className="dc-pop-section">
              <span className="dc-tracker">
                <span className="dc-tracker__num">01</span>
                <span className="dc-tracker__sep">—</span>
                ピン留め · PINNED
              </span>
              <div className="dc-pop-list">
                {pinned.map((f) => (
                  <FolderItem
                    key={f.id}
                    folder={f}
                    onOpen={() =>
                      openApp(`/library/${encodeURIComponent(f.id)}`)
                    }
                    onTogglePin={() => handleTogglePin(f.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {recent.length > 0 && (
            <section className="dc-pop-section">
              <span className="dc-tracker">
                <span className="dc-tracker__num">{recentSectionNumber}</span>
                <span className="dc-tracker__sep">—</span>
                最近 · RECENT
              </span>
              <div className="dc-pop-list">
                {recent.map((f) => (
                  <FolderItem
                    key={f.id}
                    folder={f}
                    onOpen={() =>
                      openApp(`/library/${encodeURIComponent(f.id)}`)
                    }
                    onTogglePin={() => handleTogglePin(f.id)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <footer className="dc-pop-footer">
        <span className="dc-pop-footer__left">BUILD 0.0.1</span>
        {apiKeyConfigured ? (
          <button
            type="button"
            className="dc-pop-footer__link"
            onClick={() => openAppWithQuery("setup=1")}
          >
            Manage access ↗
          </button>
        ) : (
          <span className="dc-pop-footer__right">NYRIMA</span>
        )}
      </footer>
    </div>
  );
}

const root = document.getElementById("popup-root");
if (!root) throw new Error("Missing #popup-root");
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>,
);

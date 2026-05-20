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
 *   - Resume + Lobby quick actions, or a single "Open Library" CTA
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
import type { PlaybackPosition, RecentFolder } from "@shared/types";
import { APP_PAGE } from "@shared/constants";
import {
  getAllPlaybackPositions,
  isInProgress,
  togglePinRecentFolder,
  getRecentFolders,
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

function HomeGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10.5V20h13v-9.5" />
      <path d="M9.5 20v-5h5v5" />
    </svg>
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
        <span
          className={`dc-pop-thumb${folder.coverPosterUrl ? " has-cover" : ""}`}
          aria-hidden
        >
          {folder.coverPosterUrl ? (
            // Real folder cover — pulled from the user-placed Poster.{jpg,png,…}
            // inside the Drive folder (see services/folder-poster.ts). The
            // SakuraGlyph stays as the fallback for never-visited or
            // poster-less libraries so the row never renders empty.
            <img
              src={folder.coverPosterUrl}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
            />
          ) : (
            <SakuraGlyph size={22} />
          )}
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

function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

function Popup() {
  const [folders, setFolders] = useState<RecentFolder[]>([]);
  const [resume, setResume] = useState<PlaybackPosition | null>(null);
  const [apiKeyConfigured, setApiKeyConfigured] = useState<boolean | null>(
    null,
  );

  useEffect(() => {
    void getRecentFolders().then(setFolders);
    void getApiKey().then((k) => setApiKeyConfigured(Boolean(k)));
    // Most-recent in-progress position — drives the big "Resume" CTA. We
    // intentionally don't surface a list of in-progress items here; the
    // popup is for one-tap muscle memory ("get me back to where I was"),
    // not browsing. The full Continue Watching row lives on the lobby.
    void getAllPlaybackPositions().then((positions) => {
      const inProgress = positions.filter(isInProgress);
      if (inProgress.length === 0) {
        setResume(null);
        return;
      }
      inProgress.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      setResume(inProgress[0]);
    });
  }, []);

  async function handleTogglePin(folderId: string) {
    const next = await togglePinRecentFolder(folderId);
    setFolders(next);
  }

  const pinned = folders.filter((f) => f.pinned).slice(0, 3);
  const recent = folders.filter((f) => !f.pinned).slice(0, 3);
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

      {resume && resume.folderId ? (
        // Promote the in-progress watch while keeping the lobby one tap away.
        // When there's nothing in progress, the popup falls back to the
        // original full-width "Open Library" shape.
        <div className="dc-pop-cta-row">
          <button
            type="button"
            className="dc-pop-cta dc-pop-cta--resume"
            onClick={() =>
              openApp(
                `/play/${encodeURIComponent(resume.folderId!)}/${encodeURIComponent(resume.fileId)}`,
              )
            }
            title={`${resume.name ?? "Resume last video"} · ${formatTimecode(
              resume.positionSeconds,
            )} / ${formatTimecode(resume.durationSeconds)}`}
          >
            <span className="dc-pop-cta__glyph" aria-hidden>
              ▶
            </span>
            <span className="dc-pop-cta__label">
              Resume
              <span className="dc-pop-cta__detail">
                {(resume.name ?? "last video").replace(/\.[^.]+$/, "")}
              </span>
            </span>
          </button>
          <button
            type="button"
            className="dc-pop-cta dc-pop-cta--lobby"
            onClick={() => openApp("/")}
          >
            <span className="dc-pop-cta__glyph" aria-hidden>
              <HomeGlyph />
            </span>
            <span className="dc-pop-cta__label">
              Lobby
              <span className="dc-pop-cta__detail">Open Nyrima</span>
            </span>
          </button>
        </div>
      ) : (
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
      )}

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

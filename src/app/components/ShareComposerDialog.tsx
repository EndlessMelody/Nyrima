/**
 * ShareComposerDialog — write a share entry for the currently-focused
 * video or library.
 *
 * Target inference: reads the current URL via react-router's useLocation.
 *   - `/play/:folderId/:fileId` → video target. Title + poster pulled from
 *     getFileMetadata + the metadata-cache (no extra Jikan call; we settle
 *     for "miss" if uncached).
 *   - `/library/:folderId`      → library target. Title from
 *     getFileMetadata + poster via resolveSeriesPoster.
 *   - Anywhere else             → empty state with a hint to open something.
 *
 * The composer is a single-step Dialog (no wizard) — caption textbox,
 * optional "make Shared folder public" checkbox (only when not already
 * public), and a Share button that runs the full submitShare flow.
 *
 * Success state replaces the form with a "shared!" panel + a "copy share
 * folder URL" action so the user can paste the link to a friend.
 */

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  Column,
  Row,
  Text,
  Button,
  Dialog,
  Spinner,
} from "@once-ui-system/core/components";
import { useSharingStore } from "../stores/sharing-store";
import { getFileMetadata } from "../services/drive/metadata-service";
import { resolveSeriesPoster } from "../services/poster-resolver";
import { getCached } from "../services/metadata-cache";
import { MAX_SHARE_CAPTION_CHARS } from "@shared/constants";
import { driveFolderUrl } from "@shared/drive-urls";
import type {
  DriveFile,
  ShareTarget,
} from "@shared/types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

interface ResolvedTarget {
  target: ShareTarget;
  title: string;
  posterUrl?: string;
}

export function ShareComposerDialog({ isOpen, onClose }: Props) {
  const location = useLocation();
  const submitting = useSharingStore((s) => s.submitting);
  const lastError = useSharingStore((s) => s.lastError);
  const clearError = useSharingStore((s) => s.clearError);
  const submitShare = useSharingStore((s) => s.submitShare);
  const isPublic = useSharingStore((s) => s.isPublic);
  const refreshPublicState = useSharingStore((s) => s.refreshPublicState);
  const ensureFolders = useSharingStore((s) => s.ensureFolders);

  const [resolved, setResolved] = useState<ResolvedTarget | null>(null);
  const [resolving, setResolving] = useState(false);
  const [caption, setCaption] = useState("");
  const [makePublic, setMakePublic] = useState(true);
  const [success, setSuccess] = useState<{
    shareFolderUrl: string;
    entryTitle: string;
  } | null>(null);

  // Re-derive target whenever the dialog opens or the route changes.
  useEffect(() => {
    if (!isOpen) {
      setResolved(null);
      setCaption("");
      setSuccess(null);
      clearError();
      return;
    }
    let cancelled = false;
    setResolving(true);
    void resolveTargetFromPath(location.pathname)
      .then((r) => {
        if (!cancelled) setResolved(r);
      })
      .catch(() => {
        if (!cancelled) setResolved(null);
      })
      .finally(() => {
        if (!cancelled) setResolving(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, location.pathname, clearError]);

  // Probe the Shared/ folder's public state once when the dialog opens so
  // the "make public" checkbox can render the correct default. Failing
  // silently is fine — the checkbox just stays at its default.
  useEffect(() => {
    if (!isOpen) return;
    void refreshPublicState({ force: false });
  }, [isOpen, refreshPublicState]);

  // If the folder is already public, default the checkbox off — no need to
  // re-publish on every share.
  useEffect(() => {
    if (isPublic === true) setMakePublic(false);
  }, [isPublic]);

  async function onSubmit() {
    if (!resolved) return;
    try {
      const result = await submitShare({
        target: resolved.target,
        title: resolved.title,
        posterUrl: resolved.posterUrl,
        caption: caption.trim() || undefined,
        publishFolder: makePublic && isPublic !== true,
      });
      const folders = await ensureFolders();
      setSuccess({
        shareFolderUrl: driveFolderUrl(folders.root),
        entryTitle: result.entry.title ?? "Your share",
      });
    } catch {
      // lastError surfaces via the store; no extra handling needed.
    }
  }

  async function copyShareUrl() {
    if (!success) return;
    try {
      await navigator.clipboard.writeText(success.shareFolderUrl);
    } catch {
      // ignore — clipboard rejection is harmless
    }
  }

  const captionLeft = MAX_SHARE_CAPTION_CHARS - caption.length;
  const captionOverflow = captionLeft < 0;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={success ? "Shared" : "Share"}
      description={
        success
          ? "Your share entry is live. Paste this URL to a friend so they can follow you."
          : resolved
            ? `Sharing ${resolved.target.kind === "video" ? "this video" : "this library"} with the people following your Shared folder.`
            : "Open a video or library first — then come back here to share it."
      }
      style={{ backgroundColor: "var(--page-background)" }}
      footer={
        success ? (
          <Row gap="8">
            <Button variant="tertiary" onClick={onClose}>
              Done
            </Button>
            <Button variant="primary" onClick={() => void copyShareUrl()}>
              Copy share folder URL
            </Button>
          </Row>
        ) : (
          <Row gap="8">
            <Button variant="tertiary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void onSubmit()}
              disabled={submitting || !resolved || captionOverflow}
            >
              {submitting ? <Spinner size="xs" /> : "Share"}
            </Button>
          </Row>
        )
      }
    >
      {success ? (
        <Column gap="12" paddingY="8">
          <Text variant="body-default-s">{success.entryTitle}</Text>
          <Text
            variant="body-default-xs"
            onBackground="neutral-weak"
            style={{
              fontFamily: "var(--dc-font-mono)",
              wordBreak: "break-all",
            }}
          >
            {success.shareFolderUrl}
          </Text>
        </Column>
      ) : (
        <Column gap="12" paddingY="8">
          {resolving ? (
            <Row gap="8" vertical="center">
              <Spinner size="xs" />
              <Text variant="body-default-s" onBackground="neutral-weak">
                Loading…
              </Text>
            </Row>
          ) : resolved ? (
            <TargetPreview resolved={resolved} />
          ) : (
            <EmptyTargetHint />
          )}

          {resolved && (
            <>
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  fontFamily: "var(--dc-font-mono)",
                  fontSize: "0.6875rem",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--neutral-on-background-medium)",
                }}
              >
                Caption (optional)
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Why are you sharing this?"
                  rows={3}
                  maxLength={MAX_SHARE_CAPTION_CHARS + 200}
                  disabled={submitting}
                  style={{
                    width: "100%",
                    resize: "vertical",
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "var(--dc-hairline)",
                    background: "transparent",
                    color: "var(--neutral-on-background-strong)",
                    fontFamily: "var(--dc-font-display)",
                    fontSize: "0.875rem",
                    letterSpacing: 0,
                    textTransform: "none",
                    lineHeight: 1.4,
                  }}
                />
                <span
                  style={{
                    alignSelf: "flex-end",
                    fontSize: "0.625rem",
                    color: captionOverflow
                      ? "var(--danger-on-background-strong)"
                      : "var(--neutral-on-background-weak)",
                  }}
                >
                  {captionLeft} chars left
                </span>
              </label>

              {isPublic !== true && (
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontFamily: "var(--dc-font-mono)",
                    fontSize: "0.6875rem",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: "var(--neutral-on-background-medium)",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={makePublic}
                    onChange={(e) => setMakePublic(e.target.checked)}
                    disabled={submitting}
                  />
                  <span>
                    Make my <code>Shared/</code> folder public ·
                    {isPublic === false
                      ? " currently private"
                      : " state unknown"}
                  </span>
                </label>
              )}
              {isPublic === true && (
                <Text
                  variant="body-default-xs"
                  onBackground="neutral-weak"
                  style={{ fontFamily: "var(--dc-font-mono)" }}
                >
                  Your <code>Shared/</code> folder is already public.
                </Text>
              )}
            </>
          )}

          {lastError && (
            <Text variant="body-default-xs" onBackground="danger-medium">
              {lastError}
            </Text>
          )}
        </Column>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Target preview + empty state
// ---------------------------------------------------------------------------

function TargetPreview({ resolved }: { resolved: ResolvedTarget }) {
  return (
    <Row
      gap="12"
      vertical="center"
      style={{
        padding: 10,
        borderRadius: 10,
        border: "var(--dc-hairline)",
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 8,
          background: "var(--neutral-alpha-weak)",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        {resolved.posterUrl ? (
          <img
            src={resolved.posterUrl}
            alt=""
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : null}
      </div>
      <Column gap="2" style={{ minWidth: 0 }}>
        <span
          style={{
            fontFamily: "var(--dc-font-mono)",
            fontSize: "0.625rem",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--neutral-on-background-weak)",
          }}
        >
          {resolved.target.kind === "video" ? "Video" : "Library"}
        </span>
        <span
          style={{
            fontSize: "0.9375rem",
            color: "var(--neutral-on-background-strong)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {resolved.title}
        </span>
      </Column>
    </Row>
  );
}

function EmptyTargetHint() {
  return (
    <Text variant="body-default-s" onBackground="neutral-weak">
      Open a video or library, then click Share again. The composer reads
      the current page to know what you want to share.
    </Text>
  );
}

// ---------------------------------------------------------------------------
// URL inference + metadata resolve
// ---------------------------------------------------------------------------

async function resolveTargetFromPath(
  pathname: string,
): Promise<ResolvedTarget | null> {
  const play = matchPlay(pathname);
  if (play) {
    const file = await getFileMetadata(play.fileId, { priority: "normal" })
      .catch(() => null);
    const cached = await getCached(play.fileId).catch(() => undefined);
    return {
      target: {
        kind: "video",
        fileId: play.fileId,
        folderId: play.folderId,
      },
      title: bestVideoTitle(file, cached?.title),
      posterUrl: cached?.posterUrl ?? file?.thumbnailLink,
    };
  }
  const lib = matchLibrary(pathname);
  if (lib) {
    const folder = await getFileMetadata(lib.folderId, { priority: "normal" })
      .catch(() => null);
    const seriesMeta = folder?.name
      ? await resolveSeriesPoster(folder.name).catch(() => null)
      : null;
    return {
      target: { kind: "library", folderId: lib.folderId },
      title: folder?.name ?? "Library",
      posterUrl: seriesMeta?.posterUrl ?? folder?.thumbnailLink,
    };
  }
  return null;
}

function matchPlay(
  pathname: string,
): { folderId: string; fileId: string } | null {
  const m = pathname.match(/^\/play\/([^/]+)\/([^/]+)\/?$/);
  if (!m) return null;
  return {
    folderId: decodeURIComponent(m[1]),
    fileId: decodeURIComponent(m[2]),
  };
}

function matchLibrary(pathname: string): { folderId: string } | null {
  const m = pathname.match(/^\/library\/([^/]+)\/?$/);
  if (!m) return null;
  return { folderId: decodeURIComponent(m[1]) };
}

function bestVideoTitle(file: DriveFile | null, metaTitle?: string): string {
  if (metaTitle) return metaTitle;
  if (file?.name) {
    // Strip extension for a cleaner display.
    const dot = file.name.lastIndexOf(".");
    return dot > 0 ? file.name.slice(0, dot) : file.name;
  }
  return "Untitled video";
}

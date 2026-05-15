/**
 * Player page.
 *
 * Phase 1.5 streaming model:
 *   - We hand the <video> element a direct googleapis.com URL stamped with
 *     the user's API key. The browser issues Range requests on demand, so
 *     playback starts within a few seconds even on multi-GB files — no
 *     more "download the whole movie before pressing play" stall.
 *   - For API-key-restricted (OAuth-only) builds we fall back to fetching
 *     the bytes via authedFetch and creating a blob URL, which still works
 *     but pre-buffers the whole file.
 *   - Subtitles are downloaded as text and converted to WebVTT, then
 *     attached via <track> elements. The user can pick the active track.
 *
 * Out of scope (Phase 2): MKV remux via ffmpeg.wasm / libmpv WASM.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  getFile,
  listFolderAll,
  matchSubtitlesForVideo,
  downloadTextFile,
  buildMediaUrl,
  buildPublicStreamUrl,
  isSubtitleFile,
  isVideoFile,
  getExtension,
} from "../services/drive-api";
import { authedFetch } from "../services/auth";
import { DriveAccessError, type DriveAccessReason } from "../services/errors";
import {
  savePlaybackPosition,
  getPlaybackPosition,
  playbackProgressPct,
} from "../services/storage";
import { SetupAccessDialog } from "../components/SetupAccessDialog";
import { DrivePlayer, type SubtitleTrack } from "../components/DrivePlayer";
import {
  parseSubtitles,
  detectLang,
  prettyLangLabel,
} from "../services/subtitles";
import { extractMkvSubtitles } from "../services/mkv-subtitles";
import { MkvMseController } from "../services/mkv-remux/mse-controller";
import {
  buildDisplayTitle,
  normalizeMovieTitle,
} from "../services/title-normalizer";
import {
  formatBytes,
  formatRuntime,
} from "../services/formatters";
import { usePlaybackPositions } from "../hooks/usePlaybackPositions";
import { PlayerLayout } from "../components/PlayerLayout";
import { PlaylistSidebar } from "../components/PlaylistSidebar";
import { NyrimaMark } from "../components/NyrimaMark";
import {
  UNSUPPORTED_CONTAINERS,
  WATCHED_THRESHOLD_PCT,
} from "@shared/constants";
import { driveFileUrl } from "@shared/drive-urls";
import type { DriveFile } from "@shared/types";
import "./PlayerPage.scss";

// Throttle interval for persisting playback position from the player's
// onTimeUpdate. Going lower than this would flood chrome.storage writes.
const POSITION_SAVE_MS = 4000;

export function PlayerPage() {
  const { folderId = "", fileId = "" } = useParams();
  const navigate = useNavigate();

  const [file, setFile] = useState<DriveFile | null>(null);
  const [folderName, setFolderName] = useState<string>("");
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [folderVideos, setFolderVideos] = useState<DriveFile[]>([]);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [bufferingBlob, setBufferingBlob] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorReason, setErrorReason] = useState<DriveAccessReason | null>(
    null,
  );
  const [unsupported, setUnsupported] = useState(false);
  const [isMkvMse, setIsMkvMse] = useState(false);
  const [isMkvNative, setIsMkvNative] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [initialSeek, setInitialSeek] = useState<number>(0);
  const [positions, setPositions] = usePlaybackPositions(folderId);
  const [theater, setTheater] = useState(false);

  const blobUrlRef = useRef<string | null>(null);
  const lastSaveRef = useRef<number>(0);
  const mseControllerRef = useRef<MkvMseController | null>(null);
  const mkvHeaderRef = useRef<{ buf: Uint8Array; fileSize: number } | null>(
    null,
  );
  const mkvExtractAbortRef = useRef<AbortController | null>(null);

  // Surface a typed DriveAccessError into the UI state.
  const reportError = useCallback((e: unknown) => {
    if (e instanceof DriveAccessError) {
      setError(e.message);
      setErrorReason(e.reason);
    } else if (e instanceof Error) {
      setError(e.message);
      setErrorReason("unknown");
    } else {
      setError("Failed to load video");
      setErrorReason("unknown");
    }
  }, []);

  // Load video metadata + decide a streaming URL + load subtitles.
  useEffect(() => {
    let cancelled = false;
    // Reset everything so retries (navigate(0)) start clean.
    setError(null);
    setErrorReason(null);
    setUnsupported(false);
    setIsMkvMse(false);
    setIsMkvNative(false);
    setBufferingBlob(false);
    setStreamUrl(null);
    setSubtitleTracks([]);
    setFolderVideos([]);
    setFolderName("");
    setInitialSeek(0);
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    if (mseControllerRef.current) {
      mseControllerRef.current.destroy();
      mseControllerRef.current = null;
    }
    if (mkvExtractAbortRef.current) {
      mkvExtractAbortRef.current.abort();
      mkvExtractAbortRef.current = null;
    }
    mkvHeaderRef.current = null;

    async function run() {
      try {
        // Fan-out: video metadata, sibling listing, resume position, and
        // the parent folder's display name are independent — fetching them
        // in parallel saves a round-trip per request from TTFP.
        const [video, siblingsResult, saved, folder] = await Promise.all([
          getFile(fileId),
          listFolderAll(folderId).catch((err) => {
            // eslint-disable-next-line no-console
            console.warn("listFolderAll failed:", err);
            return [] as DriveFile[];
          }),
          getPlaybackPosition(fileId).catch(() => undefined),
          getFile(folderId).catch(() => null),
        ]);
        if (cancelled) return;
        setFile(video);
        if (folder?.name) setFolderName(folder.name);

        const siblings = siblingsResult;
        setFolderVideos(siblings.filter(isVideoFile));

        const ext = getExtension(video.name);
        const isMkv = ext === "mkv";

        // Detect container support up-front.
        const probe = document.createElement("video");
        const canPlay = probe.canPlayType(video.mimeType || "");
        const browserUnsupported =
          !canPlay &&
          !isMkv &&
          UNSUPPORTED_CONTAINERS.includes(
            ext as (typeof UNSUPPORTED_CONTAINERS)[number],
          );
        if (browserUnsupported) {
          setUnsupported(true);
          return;
        }

        // MKV → try native streaming first (works for H.264+AAC/Opus in
        // Chrome/Edge/Firefox). Subtitles are extracted separately from the
        // MKV header and rendered via our own SubtitleOverlay.
        // If native playback fails, handleMediaError will fall back to MSE.
        if (isMkv) {
          if (cancelled) return;
          let nativeOk = false;
          try {
            const directUrl = await buildPublicStreamUrl(fileId);
            if (directUrl) {
              await authedFetch(buildMediaUrl(fileId), {
                headers: { Range: "bytes=0-0" },
              });
              if (cancelled) return;
              setStreamUrl(directUrl);
              setIsMkvNative(true);
              nativeOk = true;
            }
          } catch {
            // Direct URL not accessible (private file, no API key, etc.)
            // — fall through to MSE below.
          }
          if (!nativeOk && !cancelled) {
            // No direct URL or probe failed → go straight to MSE remux.
            setIsMkvMse(true);
          }
        } else {
          // Non-MKV: direct streaming (preferred) with blob fallback.
          const directUrl = await buildPublicStreamUrl(fileId);
          if (directUrl) {
            await authedFetch(buildMediaUrl(fileId), {
              headers: { Range: "bytes=0-0" },
            });
            if (cancelled) return;
            setStreamUrl(directUrl);
          } else {
            setBufferingBlob(true);
            const res = await authedFetch(buildMediaUrl(fileId));
            const blob = await res.blob();
            if (cancelled) return;
            const u = URL.createObjectURL(blob);
            blobUrlRef.current = u;
            setStreamUrl(u);
            setBufferingBlob(false);
          }
        }

        // Subtitles — fetch all matched external subs in parallel.
        const matchedSubs = matchSubtitlesForVideo(video, siblings).filter(
          isSubtitleFile,
        );
        const tracksResults = await Promise.all(
          matchedSubs.map(async (s) => {
            try {
              const text = await downloadTextFile(s.id);
              const cues = parseSubtitles(text, getExtension(s.name));
              const lang = detectLang(s.name);
              return {
                id: `ext-${s.id}`,
                lang,
                label: prettyLangLabel(lang, s.name),
                cues,
              } as SubtitleTrack;
            } catch {
              return null;
            }
          }),
        );
        const tracks = tracksResults.filter(
          (t): t is SubtitleTrack => t !== null,
        );

        // Commit external subs immediately. MKV embedded subs stream in
        // progressively below and merge with this initial set.
        if (!cancelled) setSubtitleTracks(tracks);

        // MKV embedded subtitle extraction — progressive: emits cues as
        // clusters are streamed in, so the active track populates while
        // the rest of the file is still downloading.
        if (isMkv) {
          const ac = new AbortController();
          mkvExtractAbortRef.current = ac;
          void extractMkvSubtitles(fileId, {
            signal: ac.signal,
            onHeader: ({ buf, fileSize: mkvFileSize }) => {
              if (!cancelled) {
                mkvHeaderRef.current = { buf, fileSize: mkvFileSize };
              }
            },
            onProgress: (mkvSubs) => {
              if (cancelled) return;
              const mkvTracks: SubtitleTrack[] = mkvSubs.map((s) => ({
                id: s.id,
                lang: s.lang,
                label: s.label,
                cues: s.cues.slice(),
                imageBased: s.imageBased,
              }));
              setSubtitleTracks((prev) => [
                ...prev.filter((t) => !t.id.startsWith("mkv-")),
                ...mkvTracks,
              ]);
            },
          }).catch((e) => {
            if (!cancelled && !ac.signal.aborted) {
              // eslint-disable-next-line no-console
              console.error("MKV subtitle extraction failed:", e);
            }
          });
        }

        // Resume position (came in from the parallel fetch above).
        if (!cancelled && saved && saved.positionSeconds > 5) {
          setInitialSeek(saved.positionSeconds);
        }
      } catch (e) {
        if (!cancelled) reportError(e);
      }
    }
    void run();
    return () => {
      cancelled = true;
      mkvExtractAbortRef.current?.abort();
    };
  }, [folderId, fileId, reportError]);

  // Clean up blob URLs and MSE controller on unmount.
  useEffect(
    () => () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      if (mseControllerRef.current) {
        mseControllerRef.current.destroy();
        mseControllerRef.current = null;
      }
    },
    [],
  );

  // MSE: when the player exposes its <video> ref, attach the controller.
  const handleVideoRef = useCallback(
    (videoEl: HTMLVideoElement | null) => {
      if (!videoEl || !isMkvMse || !file) return;
      // Don't re-create if already running for this file
      if (mseControllerRef.current) return;

      const ctrl = new MkvMseController();
      mseControllerRef.current = ctrl;

      ctrl.onReady = () => {
        // MSE controller has set videoEl.src directly via DOM.
        // Do NOT call setStreamUrl here — that would cause React to
        // re-render DrivePlayer with a new src prop, which re-triggers
        // video.src assignment and aborts the MediaSource connection.
        // The loading state is already handled by isMkvMse.
      };
      ctrl.onError = (err) => {
        // eslint-disable-next-line no-console
        console.error("MKV MSE error:", err);
        reportError(err);
      };

      void ctrl.start(fileId, videoEl, mkvHeaderRef.current ?? undefined);
    },
    [isMkvMse, file, fileId, reportError],
  );

  // Throttled playback-position persistence.
  const handleTimeUpdate = useCallback(
    (t: number, d: number) => {
      if (!file || !d) return;
      const now = Date.now();
      if (now - lastSaveRef.current < POSITION_SAVE_MS) return;
      lastSaveRef.current = now;
      void savePlaybackPosition({
        fileId: file.id,
        positionSeconds: t,
        durationSeconds: d,
        updatedAt: now,
      });
    },
    [file],
  );

  // When the <video> emits an error, classify via authedFetch probe.
  // For MKV native playback: if the browser can't decode the container/codec,
  // automatically fall back to the MSE remux pipeline.
  const handleMediaError = useCallback(
    async (err: MediaError | null) => {
      const code = err?.code ?? 0;
      // eslint-disable-next-line no-console
      console.error("handleMediaError code:", code, "message:", err?.message);

      // MKV native → MSE fallback: if the browser can't play the MKV
      // natively (unsupported codec like HEVC, or container issue), switch
      // to the MSE remux pipeline transparently.
      if (
        isMkvNative &&
        !isMkvMse &&
        (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ||
          code === MediaError.MEDIA_ERR_DECODE)
      ) {
        // eslint-disable-next-line no-console
        console.warn("MKV native playback failed, falling back to MSE remux");
        setIsMkvNative(false);
        setIsMkvMse(true);
        setStreamUrl(null);
        return;
      }

      if (code === MediaError.MEDIA_ERR_DECODE) {
        setError(
          "The browser couldn't decode this stream. The codec may not be supported.",
        );
        setErrorReason("unknown");
        return;
      }

      // SRC_NOT_SUPPORTED on a direct-URL stream usually means Drive returned
      // 403 to the bare key request (e.g. a private file the user owns but
      // hasn't shared "Anyone with the link"). authedFetch can still reach it
      // via OAuth/cookies, so re-buffer the bytes as a blob URL before giving
      // up. If that also fails, surface the typed DriveAccessError.
      if (
        code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED &&
        !isMkvMse &&
        !isMkvNative
      ) {
        try {
          setBufferingBlob(true);
          const res = await authedFetch(buildMediaUrl(fileId));
          const blob = await res.blob();
          const u = URL.createObjectURL(blob);
          if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
          blobUrlRef.current = u;
          setStreamUrl(u);
          setBufferingBlob(false);
          return;
        } catch (e) {
          setBufferingBlob(false);
          reportError(e);
          return;
        }
      }

      try {
        const res = await authedFetch(buildMediaUrl(fileId), {
          headers: { Range: "bytes=0-0" },
        });
        void res.blob().catch(() => undefined);
        setError(
          "Playback was interrupted. Check your network and click Try again.",
        );
        setErrorReason("unknown");
      } catch (e) {
        reportError(e);
      }
    },
    [fileId, reportError, isMkvNative, isMkvMse],
  );

  const loading =
    !error && !unsupported && (!file || (!streamUrl && !isMkvMse));

  // Pretty metadata derived from the file.
  const meta = useMemo(() => {
    if (!file) return null;
    const ext = getExtension(file.name).toUpperCase() || "FILE";
    const size = file.size ? formatBytes(Number(file.size)) : null;
    const durationMs = file.videoMediaMetadata?.durationMillis
      ? Number(file.videoMediaMetadata.durationMillis)
      : null;
    const duration = durationMs
      ? formatRuntime(Math.floor(durationMs / 1000))
      : null;
    const width = file.videoMediaMetadata?.width;
    const height = file.videoMediaMetadata?.height;
    const resolution = width && height ? `${width}×${height}` : null;
    return { ext, size, duration, resolution };
  }, [file]);

  // Next / previous videos in the same folder.
  const currentIndex = useMemo(
    () => folderVideos.findIndex((v) => v.id === fileId),
    [folderVideos, fileId],
  );
  const prevVideo = currentIndex > 0 ? folderVideos[currentIndex - 1] : null;
  const nextVideo =
    currentIndex >= 0 && currentIndex < folderVideos.length - 1
      ? folderVideos[currentIndex + 1]
      : null;

  // Stabilize the {fileId, title} adapter shapes so DrivePlayer doesn't see
  // a new object identity on every parent render.
  const prevAdapter = useMemo(
    () => (prevVideo ? { fileId: prevVideo.id, title: prevVideo.name } : null),
    [prevVideo],
  );
  const nextAdapter = useMemo(
    () => (nextVideo ? { fileId: nextVideo.id, title: nextVideo.name } : null),
    [nextVideo],
  );

  const handleNext = useCallback(() => {
    if (nextVideo) navigate(`/play/${folderId}/${nextVideo.id}`);
  }, [nextVideo, folderId, navigate]);

  const handlePrev = useCallback(() => {
    if (prevVideo) navigate(`/play/${folderId}/${prevVideo.id}`);
  }, [prevVideo, folderId, navigate]);

  // Early-out screens -------------------------------------------------------
  if (loading) {
    return (
      <div className="ny-player-loading">
        <div className="ny-player-loading__head">
          <span className="dc-tracker">LOADING</span>
          <button
            type="button"
            className="ny-btn ny-btn--ghost"
            onClick={() => navigate(-1)}
          >
            Back
          </button>
        </div>
        <div className="ny-player-loading__stage">
          <div className="ny-player-loading__spin" />
          <span className="ny-player-loading__text">
            {bufferingBlob
              ? "Buffering the full file (OAuth mode)…"
              : "Reaching Drive…"}
          </span>
        </div>
      </div>
    );
  }

  if (unsupported) {
    return (
      <PlayerErrorCard
        title="Container not yet supported"
        body={`${file?.name ?? "This file"} uses a container the browser can't play natively. The MKV/HEVC WASM decoder ships in Phase 2 of Nyrima. For now, MP4 and WebM files play with full quality.`}
        onBack={() => navigate(-1)}
      />
    );
  }

  if (error) {
    return (
      <>
        <PlayerErrorCard
          title={
            errorReason === "no-api-key"
              ? "Drive access isn't set up yet"
              : errorReason === "private-folder" || errorReason === "not-found"
                ? "This video isn't shared publicly"
                : errorReason === "rate-limited"
                  ? "Drive is rate-limiting us"
                  : "Playback failed"
          }
          body={error}
          reason={errorReason}
          onBack={() => navigate(-1)}
          onRetry={() => navigate(0)}
          onOpenSetup={
            errorReason === "no-api-key" ? () => setSetupOpen(true) : undefined
          }
        />
        <SetupAccessDialog
          isOpen={setupOpen}
          onClose={() => setSetupOpen(false)}
          onSaved={() => {
            setSetupOpen(false);
            navigate(0);
          }}
        />
      </>
    );
  }

  // Main player -------------------------------------------------------------
  // Anime-aware folder + episode title is the primary display; the movie
  // normalizer is kept only for the year/quality pills below since
  // `buildDisplayTitle` is intentionally formatting-only and doesn't extract
  // those fields.
  const parsed = file
    ? buildDisplayTitle(folderName, file.name)
    : null;
  const cleaned = file ? normalizeMovieTitle(file.name) : null;
  const displayTitle = parsed?.displayTitle ?? cleaned?.title ?? file?.name ?? "";
  const progressPct = file
    ? playbackProgressPct(positions[file.id])
    : 0;

  function handleMarkWatched() {
    if (!file) return;
    const dur = positions[file.id]?.durationSeconds || 1;
    void savePlaybackPosition({
      fileId: file.id,
      positionSeconds: dur,
      durationSeconds: dur,
      updatedAt: Date.now(),
      name: file.name,
      folderId,
      mimeType: file.mimeType,
    });
    setPositions((prev) => ({
      ...prev,
      [file.id]: {
        ...prev[file.id],
        fileId: file.id,
        positionSeconds: dur,
        durationSeconds: dur,
        updatedAt: Date.now(),
      },
    }));
  }

  function handleCopyLink() {
    if (!file) return;
    void navigator.clipboard.writeText(driveFileUrl(file.id));
  }

  function handleOpenInDrive() {
    if (!file) return;
    window.open(driveFileUrl(file.id), "_blank");
  }

  return (
    <div className={`ny-player-page${theater ? " is-theater" : ""}`}>
      <PlayerLayout
        player={
          <div className="ny-player-main">
            {(streamUrl || isMkvMse) && (
              <DrivePlayer
                src={streamUrl ?? ""}
                subtitleTracks={subtitleTracks}
                title={displayTitle || file?.name}
                initialSeek={initialSeek}
                onMediaError={handleMediaError}
                onTimeUpdate={handleTimeUpdate}
                onVideoRef={
                  isMkvMse && !isMkvNative ? handleVideoRef : undefined
                }
                nextVideo={nextAdapter}
                prevVideo={prevAdapter}
                onNext={handleNext}
                onPrev={handlePrev}
              />
            )}

            {file && (
              <div className="ny-player-info">
                <div className="ny-player-info__head">
                  <div>
                    <h2 className="ny-player-info__title">{displayTitle}</h2>
                    <p className="ny-player-info__filename">{file.name}</p>
                  </div>
                  <button
                    type="button"
                    className="ny-btn ny-btn--ghost"
                    onClick={() => navigate(-1)}
                  >
                    Back
                  </button>
                </div>

                {meta && (
                  <div className="ny-player-info__meta">
                    <span className="ny-player-info__pill">{meta.ext}</span>
                    {meta.resolution && (
                      <span className="ny-player-info__pill">
                        {meta.resolution}
                      </span>
                    )}
                    {meta.duration && (
                      <span className="ny-player-info__pill">
                        {meta.duration}
                      </span>
                    )}
                    {meta.size && (
                      <span className="ny-player-info__pill">{meta.size}</span>
                    )}
                    {cleaned?.quality && (
                      <span className="ny-player-info__pill">
                        {cleaned.quality}
                      </span>
                    )}
                  </div>
                )}

                {progressPct > 0 &&
                  progressPct < WATCHED_THRESHOLD_PCT && (
                    <div className="ny-player-info__progress">
                      <div
                        className="ny-player-info__progress-bar"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  )}

                <div className="ny-player-info__actions">
                  <button
                    type="button"
                    className="ny-btn ny-btn--ghost"
                    onClick={handleOpenInDrive}
                  >
                    Open in Drive
                  </button>
                  <button
                    type="button"
                    className="ny-btn ny-btn--ghost"
                    onClick={handleCopyLink}
                  >
                    Copy link
                  </button>
                  <button
                    type="button"
                    className="ny-btn ny-btn--ghost"
                    onClick={() => setTheater((t) => !t)}
                  >
                    {theater ? "Exit theater" : "Theater mode"}
                  </button>
                  <button
                    type="button"
                    className="ny-btn ny-btn--ghost"
                    onClick={handleMarkWatched}
                  >
                    Mark as watched
                  </button>
                </div>
              </div>
            )}
          </div>
        }
        sidebar={
          <PlaylistSidebar
            videos={folderVideos}
            currentFileId={fileId}
            folderId={folderId}
            positions={positions}
          />
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tiny presentational helpers
// ---------------------------------------------------------------------------

function PlayerErrorCard({
  title,
  kana,
  body,
  reason,
  onBack,
  onRetry,
  onOpenSetup,
}: {
  title: string;
  kana?: string;
  body: string;
  reason?: DriveAccessReason | null;
  onBack: () => void;
  onRetry?: () => void;
  onOpenSetup?: () => void;
}) {
  return (
    <div className="ny-player-error">
      <div className="ny-player-error__head">
        <NyrimaMark size="hero" />
        <div className="ny-player-error__body">
          <h3 className="ny-player-error__title">{title}</h3>
          {kana && <span className="dc-tracker">{kana}</span>}
          {reason && <span className="ny-player-error__reason">{reason}</span>}
          <p className="ny-player-error__text">{body}</p>
        </div>
      </div>
      <div className="ny-player-error__actions">
        {onOpenSetup && (
          <button
            type="button"
            className="ny-btn ny-btn--primary"
            onClick={onOpenSetup}
          >
            Setup access
          </button>
        )}
        {onRetry && (
          <button
            type="button"
            className="ny-btn ny-btn--ghost"
            onClick={onRetry}
          >
            Try again
          </button>
        )}
        <button type="button" className="ny-btn ny-btn--ghost" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

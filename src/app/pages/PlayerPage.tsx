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
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import {
  matchSubtitlesForVideo,
  buildMediaUrl,
  buildPublicStreamUrl,
  isSubtitleFile,
  isVideoFile,
  getExtension,
} from "../services/drive-api";
import {
  getFileMetadata,
  listFolder as cachedListFolder,
  getSubtitleText,
} from "../services/drive/metadata-service";
import { authedFetch, tryGetAccessToken } from "../services/auth";
import { getOAuthClientId } from "../services/oauth-key";
import { getUserProfile } from "../services/user-profile";
import { DriveAccessError, type DriveAccessReason } from "../services/errors";
import {
  savePlaybackPosition,
  getPlaybackPosition,
  playbackProgressPct,
} from "../services/storage";
import { SetupAccessDialog } from "../components/SetupAccessDialog";
import { DrivePlayer, type SubtitleTrack } from "../components/DrivePlayer";
import { DriveStatusBanner } from "../components/DriveStatusBanner";
import { extractMkvSubtitles } from "../services/mkv-subtitles";
import { forceCenterDialogueInAss } from "../services/subtitles";
import { MkvMseController } from "../services/mkv-remux/mse-controller";
import {
  normalizeMovieTitle,
  parseTitle,
  isSeasonFolderName,
} from "@shared/title-parser";
import {
  formatBytes,
  formatRuntime,
} from "../services/formatters";
import { usePlaybackPositions } from "../hooks/usePlaybackPositions";
import {
  markPlayback,
  resetPlaybackTelemetry,
  summarizePlaybackStartup,
} from "../services/playback-telemetry";
import {
  NATIVE_WATCHDOG_MS,
  allowsFallback,
  decideInitialMode,
  getRememberedMode,
  rememberMode,
  forgetMode,
  type PlaybackMode,
  type PlaybackStrategy,
} from "../services/playback-strategy";
import { PlayerLayout } from "../components/PlayerLayout";
import { PlaylistSidebar } from "../components/PlaylistSidebar";
import { getCached } from "../services/metadata-cache";
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

// MKV playback strategy.
//
// `force-native` matches the project's chosen direction: play every file like
// an MP4 via the browser's native <video> element, and overlay subtitles
// from the embedded-MKV parser. The MSE→fMP4 remux pipeline is intentionally
// out of the hot path — it's expensive, buggy for HEVC+FLAC, and the
// browser can already decode the codecs we care about (H.264, HEVC w/ the
// HEVC extension on Windows, VP9, AV1 where supported). When the browser
// genuinely can't play a container/codec, we surface a clear error instead
// of attempting an expensive remux that often fails anyway.
const ACTIVE_STRATEGY: PlaybackStrategy = "force-native";

export function PlayerPage() {
  const { folderId = "", fileId = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const restartRequested = searchParams.get("restart") === "1";

  const [file, setFile] = useState<DriveFile | null>(null);
  const [folderName, setFolderName] = useState<string>("");
  /** Show folder name when the current `folderName` is a season folder (e.g.
   *  "Yahari Ore.../Kan"). Empty string otherwise. */
  const [showFolderName, setShowFolderName] = useState<string>("");
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
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode | null>(null);

  const blobUrlRef = useRef<string | null>(null);
  const lastSaveRef = useRef<number>(0);
  const mseControllerRef = useRef<MkvMseController | null>(null);
  const mkvHeaderRef = useRef<{ buf: Uint8Array; fileSize: number } | null>(
    null,
  );
  const mkvExtractAbortRef = useRef<AbortController | null>(null);
  const mkvSubStreamAbortRef = useRef<AbortController | null>(null);
  const mkvSubFeederRef = useRef<{
    feedChunk: (data: Uint8Array) => boolean;
    finalize: () => void;
    /** End offset (in headerBuf) of the last complete EBML element parsed
     *  during the header walk. Native-mode streamers must pre-feed
     *  `headerBuf.slice(headerParsedTo)` so the parser resumes at an element
     *  boundary instead of starting mid-payload. */
    headerParsedTo: number;
  } | null>(null);
  // Native-attempt watchdog. Armed when we start a native MKV stream; cleared
  // once `canplay` fires or fallback is triggered.
  const nativeWatchdogRef = useRef<number | null>(null);
  // Set true the first time `onCanPlay` fires for the current src. Used to
  // suppress fallback if playback is already healthy.
  const canPlayFiredRef = useRef(false);
  // Latest fileId/mode pair, read by the watchdog timer + fallback handler
  // without having to be re-bound on every render.
  const playbackContextRef = useRef<{ fileId: string; mode: PlaybackMode | null }>(
    { fileId: "", mode: null },
  );
  useEffect(() => {
    playbackContextRef.current = { fileId, mode: playbackMode };
  }, [fileId, playbackMode]);

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
    // One AbortController per route so navigating away cancels in-flight
    // Drive calls (metadata, subtitle text, range probes) before they
    // burn quota or fight with the next page's requests.
    const loadAbort = new AbortController();
    // Telemetry: clear marks from the prior playback and stamp t=0 for this one.
    resetPlaybackTelemetry();
    markPlayback("player:init");
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
    setShowFolderName("");
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
    if (mkvSubStreamAbortRef.current) {
      mkvSubStreamAbortRef.current.abort();
      mkvSubStreamAbortRef.current = null;
    }
    if (nativeWatchdogRef.current !== null) {
      window.clearTimeout(nativeWatchdogRef.current);
      nativeWatchdogRef.current = null;
    }
    canPlayFiredRef.current = false;
    setPlaybackMode(null);
    mkvHeaderRef.current = null;

    async function run() {
      try {
        // Fan-out: video metadata, sibling listing, resume position, and
        // the parent folder's display name are independent — fetching them
        // in parallel saves a round-trip per request from TTFP. Metadata +
        // folder listing go through the cache-first service so repeated
        // navigation inside the same library hits IndexedDB, not Drive.
        markPlayback("drive:metadata:start");
        const [video, siblingsResult, saved, folder] = await Promise.all([
          getFileMetadata(fileId, { signal: loadAbort.signal, priority: "high" }),
          cachedListFolder(folderId, { signal: loadAbort.signal, priority: "high" })
            .then((r) => r.files)
            .catch((err) => {
              if (!loadAbort.signal.aborted) {
                // eslint-disable-next-line no-console
                console.warn("listFolder failed:", err);
              }
              return [] as DriveFile[];
            }),
          getPlaybackPosition(fileId).catch(() => undefined),
          getFileMetadata(folderId, {
            signal: loadAbort.signal,
            priority: "normal",
          }).catch(() => null),
        ]);
        markPlayback("drive:metadata:end");
        if (cancelled) return;
        setFile(video);
        if (folder?.name) setFolderName(folder.name);

        // When the parent is a recognized season folder (Kan / Zoku /
        // Season 2 / …), the *show* name lives one level higher. Resolve it
        // lazily so titles read "YAHARI ORE - KAN - EP03" instead of just
        // "KAN - EP03".
        if (folder?.name && isSeasonFolderName(folder.name)) {
          const parentId = folder.parents?.[0];
          if (parentId) {
            void getFileMetadata(parentId, {
              signal: loadAbort.signal,
              priority: "low",
            })
              .then((show) => {
                if (!cancelled && show?.name) setShowFolderName(show.name);
              })
              .catch(() => undefined);
          }
        }

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

        // MKV → native-first with MSE fallback.
        //
        // The historical decision was to always route MKV to MSE because
        // failed native attempts wasted Drive Range requests. That tradeoff
        // flipped once the subtitle pipeline stopped needing remux: the
        // common H.264+AAC MKV plays natively in ~1 s, and a single wasted
        // Range on a HEVC file is far cheaper than 30 s+ of always-on remux.
        //
        // Flow:
        //   1. decideInitialMode (see playback-strategy.ts) picks native
        //      unless the user forced MSE or we previously remembered this
        //      file failed native.
        //   2. The watchdog below trips after NATIVE_WATCHDOG_MS if the
        //      native attempt hasn't reached `canplay` — common for HEVC,
        //      where the browser refuses silently rather than throwing.
        //   3. `handleMediaError` triggers fallback synchronously when the
        //      <video> emits MEDIA_ERR_SRC_NOT_SUPPORTED / MEDIA_ERR_DECODE.
        //   4. On either fallback path we `rememberMode(fileId, "mse-remux")`
        //      so re-opening the same file skips the watchdog cost.
        if (isMkv) {
          const remembered = await getRememberedMode(fileId);
          if (cancelled) return;
          const decision = decideInitialMode(video, ACTIVE_STRATEGY, remembered);
          markPlayback("playback:mode-initial");
          setPlaybackMode(decision.mode);
          // eslint-disable-next-line no-console
          console.info(
            `[playback] mode=${decision.mode} reason=${decision.reason} file=${video.name}`,
          );

          // Run MKV subtitle extraction BEFORE setting isMkvMse so the
          // feeder ref is populated when React creates the MSE controller.
          // This is fast — just a 4 MB header fetch + parse, no streaming.
          const ac = new AbortController();
          mkvExtractAbortRef.current = ac;
          try {
            const extracted = await extractMkvSubtitles(fileId, {
              signal: ac.signal,
              onHeader: ({ buf, fileSize: mkvFileSize }) => {
                if (!cancelled) {
                  mkvHeaderRef.current = { buf, fileSize: mkvFileSize };
                }
              },
              onProgress: (mkvSubs) => {
                if (cancelled) return;
                const mkvTracks: SubtitleTrack[] = mkvSubs.map((s) => {
                  // Route embedded ASS/SSA through libass (JASSUB) only once
                  // the extractor flips `assSourceComplete` — i.e. all clusters
                  // have been fed and the script is finalized. While streaming,
                  // `assSource` rebuilds on every cluster; handing JASSUB the
                  // WIP script would cause its setTrack effect to refire
                  // constantly (perceptible blink) and would also leave libass
                  // blank if the user seeks past the streamed window. The CSS
                  // overlay handles the incremental period; libass takes over
                  // in one clean transition once the script is complete.
                  const useJassub =
                    !!s.assSource &&
                    !s.imageBased &&
                    s.assSourceComplete === true;
                  return {
                    id: s.id,
                    lang: s.lang,
                    label: s.label,
                    cues: s.cues.slice(),
                    imageBased: s.imageBased,
                    source: "embedded",
                    format: subtitleFormatFromMkvCodec(s.codecId, s.imageBased),
                    codecId: s.codecId,
                    assSource: useJassub ? s.assSource : undefined,
                    assRenderer: useJassub ? "jassub" : undefined,
                  };
                });
                setSubtitleTracks((prev) => [
                  ...prev.filter((t) => !t.id.startsWith("mkv-")),
                  ...mkvTracks,
                ]);
              },
            });
            if (extracted.feedChunk && extracted.finalize && !cancelled) {
              mkvSubFeederRef.current = {
                feedChunk: extracted.feedChunk,
                finalize: extracted.finalize,
                headerParsedTo: extracted.headerParsedTo,
              };
            }
          } catch (e) {
            if (!cancelled && !ac.signal.aborted) {
              // eslint-disable-next-line no-console
              console.error("MKV subtitle extraction failed:", e);
            }
          }
          if (cancelled) return;

          if (decision.mode === "mse-remux") {
            setIsMkvMse(true);
          } else {
            // Native attempt — needs an API-key-stamped URL because we can't
            // pass an Authorization header to <video src=…>. Without a key,
            // direct streaming is impossible (OAuth-only mode); fall straight
            // to MSE in that case.
            const directUrl = await buildPublicStreamUrl(fileId);
            if (cancelled) return;
            if (!directUrl) {
              // eslint-disable-next-line no-console
              console.info("[playback] no API key; MKV → MSE (OAuth mode)");
              setPlaybackMode("mse-remux");
              setIsMkvMse(true);
            } else {
              setIsMkvNative(true);
              setStreamUrl(directUrl);
              // Native mode: <video> handles its own byte fetching, so the
              // MSE controller's piggyback path is unavailable. Without a
              // separate sub-only stream the feeder would only see cues from
              // the 4 MB header, leaving the rest of the file with no
              // embedded subtitles. Kick off a low-priority background fetch
              // that feeds Cluster bytes into the feeder until EOF.
              const header = mkvHeaderRef.current;
              const feeder = mkvSubFeederRef.current;
              // eslint-disable-next-line no-console
              console.info(
                `[subs] native-mode setup: header=${header ? `${header.buf.length}/${header.fileSize}` : "null"} ` +
                `feeder=${feeder ? "ready" : "null"}`,
              );
              if (header && feeder && header.buf.length < header.fileSize) {
                // Align the feeder to the last complete EBML element in the
                // header. Without this, the stream's first chunk (starting at
                // header.buf.length) lands mid-element; the parser reads the
                // payload as a bogus id+length and never finds a real Cluster
                // — yielding `clusters=0` for the entire file.
                if (feeder.headerParsedTo < header.buf.length) {
                  const trailing = header.buf.slice(feeder.headerParsedTo);
                  // eslint-disable-next-line no-console
                  console.info(
                    `[subs] priming feeder with header tail ` +
                    `[${feeder.headerParsedTo}, ${header.buf.length}) = ${trailing.length} bytes`,
                  );
                  feeder.feedChunk(trailing);
                }
                const subAbort = new AbortController();
                mkvSubStreamAbortRef.current = subAbort;
                // eslint-disable-next-line no-console
                console.info(
                  `[subs] starting background stream offset=${header.buf.length} eof=${header.fileSize}`,
                );
                void streamMkvSubsForNative(
                  fileId,
                  header.buf.length,
                  feeder.feedChunk,
                  feeder.finalize,
                  subAbort.signal,
                );
              }
              // Arm the watchdog. If `canplay` lands first, `handleCanPlay`
              // clears it and remembers `native`. If decode error lands
              // first, `handleMediaError` calls `fallbackToMse`.
              if (allowsFallback(ACTIVE_STRATEGY)) {
                // eslint-disable-next-line no-console
                console.info(
                  `[playback] native attempt armed; watchdog=${NATIVE_WATCHDOG_MS}ms`,
                );
                nativeWatchdogRef.current = window.setTimeout(() => {
                  nativeWatchdogRef.current = null;
                  if (canPlayFiredRef.current) return;
                  // eslint-disable-next-line no-console
                  console.warn(
                    `[playback] native MKV watchdog tripped after ${NATIVE_WATCHDOG_MS}ms; falling back to MSE`,
                  );
                  fallbackToMse();
                }, NATIVE_WATCHDOG_MS);
              }
            }
          }
        } else {
          // Non-MKV: direct streaming (preferred) with blob fallback.
          const directUrl = await buildPublicStreamUrl(fileId);
          if (directUrl) {
            if (cancelled) return;
            setStreamUrl(directUrl);
          } else {
            // No API key — fall back to fetching the entire file as a blob
            // via OAuth. This is bandwidth-heavy but is the only path for
            // non-MKV files without a configured API key.
            setBufferingBlob(true);
            markPlayback("media:first-range:start");
            const res = await authedFetch(buildMediaUrl(fileId));
            const blob = await res.blob();
            markPlayback("media:first-range:end");
            if (cancelled) return;
            const u = URL.createObjectURL(blob);
            blobUrlRef.current = u;
            setStreamUrl(u);
            setBufferingBlob(false);
          }
        }

        // Subtitles — pull all matched external subs through the cache.
        // getSubtitleText returns parsed cues so we don't re-parse on revisit.
        const matchedSubs = matchSubtitlesForVideo(video, siblings).filter(
          isSubtitleFile,
        );
        const tracksResults = await Promise.all(
          matchedSubs.map(async (s) => {
            try {
              const entry = await getSubtitleText(s, {
                signal: loadAbort.signal,
                priority: "high",
              });
              const ext = getExtension(s.name);
              const isAss = ext === "ass" || ext === "ssa";
              return {
                id: `ext-${s.id}`,
                lang: entry.lang,
                label: entry.label,
                cues: entry.cues,
                // Hand the raw ASS source to JASSUB. SRT/VTT keep using the
                // plain-text overlay (which is faster and respects the
                // user's typography settings). The script is rewritten to
                // force dialogue → bottom-center; positioned signs stay put.
                source: "external",
                format: subtitleFormatFromExtension(ext),
                assSource: isAss
                  ? forceCenterDialogueInAss(entry.text)
                  : undefined,
                assRenderer: isAss ? "jassub" : undefined,
              } as SubtitleTrack;
            } catch {
              return null;
            }
          }),
        );
        const tracks = tracksResults.filter(
          (t): t is SubtitleTrack => t !== null,
        );

        // Merge external subs with any MKV embedded subs already present.
        if (!cancelled) {
          setSubtitleTracks((prev) => {
            const mkvTracks = prev.filter((t) => t.id.startsWith("mkv-"));
            return [...tracks, ...mkvTracks];
          });
        }

        // Resume position (came in from the parallel fetch above). Skipped
        // when the caller navigated here with `?restart=1` (the lobby's
        // Restart button on the Continue Watching hero).
        if (
          !cancelled &&
          !restartRequested &&
          saved &&
          saved.positionSeconds > 5
        ) {
          setInitialSeek(saved.positionSeconds);
        }
      } catch (e) {
        if (!cancelled) reportError(e);
      }
    }
    void run();
    return () => {
      cancelled = true;
      loadAbort.abort();
      mkvExtractAbortRef.current?.abort();
      mkvSubStreamAbortRef.current?.abort();
      mkvSubStreamAbortRef.current = null;
      mkvSubFeederRef.current = null;
      if (nativeWatchdogRef.current !== null) {
        window.clearTimeout(nativeWatchdogRef.current);
        nativeWatchdogRef.current = null;
      }
    };
  }, [folderId, fileId, reportError, restartRequested]);

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
      // Piggyback subtitle extraction on the same data stream.
      const feeder = mkvSubFeederRef.current;
      if (feeder) {
        ctrl.onRawChunk = (data) => feeder.feedChunk(data);
        ctrl.onStreamComplete = () => feeder.finalize();
      }

      void ctrl.start(fileId, videoEl, mkvHeaderRef.current ?? undefined);
    },
    [isMkvMse, file, fileId, reportError],
  );

  // Transition native MKV → MSE remux. Safe to call from both the watchdog
  // timer and from `handleMediaError`; ref-based guard keeps it idempotent
  // even when React hasn't re-rendered the callback closure yet.
  const fallbackTriggeredRef = useRef(false);
  useEffect(() => {
    fallbackTriggeredRef.current = false;
  }, [fileId]);
  const fallbackToMse = useCallback(() => {
    if (canPlayFiredRef.current) return; // already playing — too late to switch
    if (fallbackTriggeredRef.current) return; // already triggered this load
    fallbackTriggeredRef.current = true;
    if (nativeWatchdogRef.current !== null) {
      window.clearTimeout(nativeWatchdogRef.current);
      nativeWatchdogRef.current = null;
    }
    markPlayback("playback:fallback-to-mse");
    // Note: do NOT call rememberMode here. The native attempt may have
    // failed for non-codec reasons (auth 403, transient network, quota).
    // Persisting "mse-remux" on every fallback would permanently lock the
    // file into the remux pipeline even after the auth issue is fixed.
    // `handleCanPlay` is the authoritative point to remember the mode —
    // it only fires after MSE has actually started playing.
    setIsMkvNative(false);
    setPlaybackMode("mse-remux");
    setStreamUrl(null);
    setIsMkvMse(true);
  }, []);

  // Telemetry: once the browser reports `canplay`, lock in the mode, cancel
  // the watchdog, persist the outcome, and dump the startup table.
  const handleCanPlay = useCallback(() => {
    canPlayFiredRef.current = true;
    if (nativeWatchdogRef.current !== null) {
      window.clearTimeout(nativeWatchdogRef.current);
      nativeWatchdogRef.current = null;
    }
    const ctx = playbackContextRef.current;
    // eslint-disable-next-line no-console
    console.info(`[playback] canplay reached; mode=${ctx.mode ?? "?"}`);
    if (ctx.fileId && ctx.mode) void rememberMode(ctx.fileId, ctx.mode);
    if (!file) return;
    summarizePlaybackStartup(file.name);
  }, [file]);

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

  // When the <video> emits an error, the most common cause is that the
  // API-key URL returned 403/404 (private file or quota throttle). The
  // browser sees an HTTP error body instead of video bytes and fires
  // MEDIA_ERR_SRC_NOT_SUPPORTED. The recovery: re-buffer the file via
  // `authedFetch` (which prefers OAuth) as a blob URL, then assign that
  // blob: URL back to <video src>. The browser plays it natively from
  // memory — works for any codec the OS can decode, no remux needed.
  //
  // This matches the project's "play like MP4 + subtitle overlay" strategy:
  // we never touch the container with JS; the browser handles decode.
  const handleMediaError = useCallback(
    async (err: MediaError | null) => {
      const code = err?.code ?? 0;
      // eslint-disable-next-line no-console
      console.error("handleMediaError code:", code, "message:", err?.message);

      // MSE owns its own error handling.
      if (isMkvMse) return;
      // Avoid re-entering the blob fallback if we're already serving a blob:
      // URL — that means a previous fallback succeeded and this is a fresh,
      // unrelated decode error.
      if (blobUrlRef.current && streamUrl === blobUrlRef.current) {
        setError(
          `Your browser couldn't decode this file even after re-buffering. The codec may not be supported by your OS.`,
        );
        setErrorReason("unknown");
        return;
      }

      // Blob recovery: fetch via authedFetch (OAuth-first) → set as <video src>.
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
        // authedFetch threw a typed DriveAccessError. Probe the bare
        // API-key URL to give the user a clearer reason than the generic
        // MEDIA_ELEMENT_ERROR they'd otherwise see.
        let probeStatus = 0;
        try {
          const apiKeyUrl = await buildPublicStreamUrl(fileId);
          if (apiKeyUrl) {
            const probe = await fetch(apiKeyUrl, {
              headers: { Range: "bytes=0-1" },
            });
            probeStatus = probe.status;
          }
        } catch {
          // Network — treat as transient below.
        }
        if (probeStatus === 404 || probeStatus === 403) {
          // Both OAuth and API key failed for this file.
          const oauthConfigured = !!(await getOAuthClientId());
          setError(
            oauthConfigured
              ? "This file isn't accessible by your Drive account or the public API key. Make sure it's shared with you or shared as 'Anyone with the link'."
              : "This file isn't accessible. Share it as 'Anyone with the link' in Drive, or set up OAuth in the User Center.",
          );
          setErrorReason(probeStatus === 404 ? "not-found" : "private-folder");
          return;
        }
        // Some other failure — surface the typed error from authedFetch.
        reportError(e);
      }
    },
    [fileId, isMkvMse, streamUrl, reportError],
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

  // Look up cached MAL metadata for the next/prev episodes so the Next-up
  // card can render a poster + the parsed "Series - EpNN" display title. We
  // intentionally only read the cache (no network) — the resolver-fed cache
  // is populated by the library page; if the user jumped straight into a
  // player URL we just fall back to the filename.
  const [nextPosterUrl, setNextPosterUrl] = useState<string | undefined>();
  useEffect(() => {
    let cancelled = false;
    if (!nextVideo) {
      setNextPosterUrl(undefined);
      return;
    }
    void (async () => {
      const meta = await getCached(nextVideo.id);
      if (!cancelled) setNextPosterUrl(meta?.posterUrl);
    })();
    return () => {
      cancelled = true;
    };
  }, [nextVideo]);

  // Ambient glow source — the *current* file's cached MAL poster. Same cache
  // pattern as nextPosterUrl; the DrivePlayer samples this to derive a per-
  // episode bloom around the frame.
  const [currentPosterUrl, setCurrentPosterUrl] = useState<string | undefined>();
  useEffect(() => {
    let cancelled = false;
    if (!fileId) {
      setCurrentPosterUrl(undefined);
      return;
    }
    void (async () => {
      const meta = await getCached(fileId);
      if (!cancelled) setCurrentPosterUrl(meta?.posterUrl);
    })();
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  const nextDisplayTitle = useMemo(() => {
    if (!nextVideo) return undefined;
    try {
      const parsed = parseTitle({
        filename: nextVideo.name,
        parentFolder: folderName,
        showFolder: showFolderName || undefined,
      });
      return parsed.fullTitle || nextVideo.name;
    } catch {
      return nextVideo.name;
    }
  }, [nextVideo, folderName, showFolderName]);

  // Stabilize the {fileId, title} adapter shapes so DrivePlayer doesn't see
  // a new object identity on every parent render.
  const prevAdapter = useMemo(
    () => (prevVideo ? { fileId: prevVideo.id, title: prevVideo.name } : null),
    [prevVideo],
  );
  const nextAdapter = useMemo(
    () =>
      nextVideo
        ? {
            fileId: nextVideo.id,
            title: nextVideo.name,
            displayTitle: nextDisplayTitle,
            posterUrl: nextPosterUrl,
          }
        : null,
    [nextVideo, nextDisplayTitle, nextPosterUrl],
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
              : errorReason === "needs-oauth"
                ? "Connect your Drive account to play this file"
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
          onConnectDrive={
            errorReason === "needs-oauth"
              ? async () => {
                  try {
                    const token = await tryGetAccessToken(true);
                    if (token) {
                      // Warm the profile cache so the UserChip updates too.
                      await getUserProfile().catch(() => undefined);
                      navigate(0);
                    }
                  } catch {
                    // User cancelled or flow failed — leave them on the error page.
                  }
                }
              : undefined
          }
          onResetEngine={
            // Offer "Try native again" whenever the MSE remux path failed for
            // an MKV. The mode might have been wrongly remembered as MSE
            // because of a past auth error.
            playbackMode === "mse-remux" && getExtension(file?.name ?? "") === "mkv"
              ? async () => {
                  await forgetMode(fileId).catch(() => undefined);
                  navigate(0);
                }
              : undefined
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
  // Folder-aware title: parent folder is the show (or season, if it matches
  // the season-naming convention — in which case the grandparent is the show
  // and we already fetched it into `showFolderName`). The movie normalizer
  // is kept only for the year/quality pills.
  const parsed = file
    ? parseTitle({
        filename: file.name,
        parentFolder: folderName,
        showFolder: showFolderName || undefined,
      })
    : null;
  const cleaned = file ? normalizeMovieTitle(file.name) : null;
  const displayTitle = parsed?.fullTitle || cleaned?.title || file?.name || "";
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
                onCanPlay={handleCanPlay}
                onVideoRef={
                  isMkvMse && !isMkvNative ? handleVideoRef : undefined
                }
                nextVideo={nextAdapter}
                prevVideo={prevAdapter}
                onNext={handleNext}
                onPrev={handlePrev}
                theatreMode={theater}
                onToggleTheatre={() => setTheater((t) => !t)}
                ambientSourceUrl={currentPosterUrl}
              />
            )}

            {file && (
              <div className="ny-player-info">
                <DriveStatusBanner />
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
            folderName={folderName}
            showFolderName={showFolderName || undefined}
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
  onConnectDrive,
  onResetEngine,
}: {
  title: string;
  kana?: string;
  body: string;
  reason?: DriveAccessReason | null;
  onBack: () => void;
  onRetry?: () => void;
  onOpenSetup?: () => void;
  onConnectDrive?: () => void | Promise<void>;
  onResetEngine?: () => void | Promise<void>;
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
        {onConnectDrive && (
          <button
            type="button"
            className="ny-btn ny-btn--primary"
            onClick={() => void onConnectDrive()}
          >
            Connect Drive
          </button>
        )}
        {onResetEngine && (
          <button
            type="button"
            className="ny-btn ny-btn--ghost"
            onClick={() => void onResetEngine()}
          >
            Try native again
          </button>
        )}
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

function subtitleFormatFromMkvCodec(
  codecId: string,
  imageBased: boolean,
): SubtitleTrack["format"] {
  if (imageBased) return "image";
  const normalized = codecId.toUpperCase();
  if (normalized.includes("ASS")) return "ass";
  if (normalized.includes("SSA")) return "ssa";
  if (normalized.includes("UTF8") || normalized.includes("SRT")) return "srt";
  return "text";
}

function subtitleFormatFromExtension(ext: string): SubtitleTrack["format"] {
  if (ext === "ass" || ext === "ssa" || ext === "srt" || ext === "vtt") {
    return ext;
  }
  return "text";
}

// ---------------------------------------------------------------------------
// Background subtitle stream for natively-played MKVs.
// ---------------------------------------------------------------------------

/**
 * When an MKV plays natively, the browser's <video> element handles its own
 * byte fetching for playback and we never see those bytes in JS. To still
 * extract embedded subtitle cues for the full file we open a SEPARATE
 * streaming Range request from the end of the header to EOF, parsing each
 * chunk through the feeder.
 *
 * Cost: a second Drive stream connection. We mitigate by:
 *   - routing through the queue at low priority (kind: "subtitle"), so
 *     metadata/playback requests get scheduled first
 *   - aborting on navigation
 *   - the OAuth path means the bandwidth is billed against the user's own
 *     account, not the throttled public-key quota
 */
async function streamMkvSubsForNative(
  fileId: string,
  startOffset: number,
  feedChunk: (data: Uint8Array) => boolean,
  finalize: () => void,
  signal: AbortSignal,
): Promise<void> {
  try {
    const res = await authedFetch(
      buildMediaUrl(fileId),
      {
        headers: { Range: `bytes=${startOffset}-` },
        signal,
      },
      { kind: "subtitle", priority: "low", signal },
    );
    // eslint-disable-next-line no-console
    console.info(
      `[subs] stream response: status=${res.status} contentRange=${res.headers.get("content-range")}`,
    );
    const reader = res.body?.getReader();
    if (!reader) {
      const ab = await res.arrayBuffer();
      if (signal.aborted) return;
      feedChunk(new Uint8Array(ab));
      finalize();
      return;
    }
    let totalBytes = 0;
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length > 0) {
        totalBytes += value.length;
        feedChunk(value);
      }
    }
    // eslint-disable-next-line no-console
    console.info(
      `[subs] stream finished: totalBytes=${totalBytes} aborted=${signal.aborted}`,
    );
    if (!signal.aborted) finalize();
  } catch (e) {
    if (signal.aborted) return;
    // eslint-disable-next-line no-console
    console.warn("[subs] native-mode background stream failed:", e);
  }
}

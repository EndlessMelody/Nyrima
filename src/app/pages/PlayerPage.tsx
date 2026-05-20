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
import {
  extractMkvSubtitles,
  type MkvAudioTrack,
} from "../services/mkv-subtitles";
import { stripAssFontReferences } from "../services/subtitles";
import { MkvMseController } from "../services/mkv-remux/mse-controller";
import { parseMkvMediaInfo } from "../services/mkv-remux/demuxer";
import {
  buildVideoMimeType,
  buildAudioMimeType,
} from "../services/mkv-remux/mp4-generator";
import { ExternalMkvAudioRenderer } from "../services/mkv-remux/external-audio-renderer";
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
import { resolveFolderPoster } from "../services/folder-poster";
import { debugLog } from "../services/debug-log";
import { NyrimaMark } from "../components/NyrimaMark";
import {
  UNSUPPORTED_CONTAINERS,
  WATCHED_THRESHOLD_PCT,
} from "@shared/constants";
import { driveFileUrl } from "@shared/drive-urls";
import { isDriveId } from "@shared/drive-id";
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
  const params = useParams();
  const rawFolderId = params.folderId ?? "";
  const rawFileId = params.fileId ?? "";
  const folderId = isDriveId(rawFolderId) ? rawFolderId : "";
  const fileId = isDriveId(rawFileId) ? rawFileId : "";
  const invalidRouteIds =
    !rawFolderId || !rawFileId || !folderId || !fileId;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const restartRequested = searchParams.get("restart") === "1";
  /**
   * `?audio=<TrackNumber>` opts the player into a specific MKV audio track
   * from the start. Set by `handlePickAudioTrackNumber` below — picking a dub
   * navigates to the same path with this param updated, which forces a clean
   * remount of the player with the new track baked into the MSE init segment
   * (or, for native MKV, seeded as the preferred track). This is the
   * "reload to apply the new audio" model: simpler and more reliable than
   * trying to mutate playback mid-stream because Chrome's `audioTracks` API
   * for Matroska is unreliable across builds.
   */
  const audioParam = searchParams.get("audio");
  const requestedAudioTrackNumber =
    audioParam != null && /^\d+$/.test(audioParam) ? Number(audioParam) : null;
  /**
   * Presence of `?audio=` means we got here from a dub-switch reload — the
   * user was already watching this clip moments ago and expects to continue
   * at the same spot without the "Resume?" pill counting down to a seek
   * 3.5 s after metadata loads. Forwarded to DrivePlayer as `silentResume`.
   */
  const isDubSwitchReload = requestedAudioTrackNumber != null;

  const [file, setFile] = useState<DriveFile | null>(null);
  const [folderName, setFolderName] = useState<string>("");
  /** Show folder name when the current `folderName` is a season folder (e.g.
   *  "Yahari Ore.../Kan"). Empty string otherwise. */
  const [showFolderName, setShowFolderName] = useState<string>("");
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [mkvAudioTracks, setMkvAudioTracks] = useState<MkvAudioTrack[]>([]);
  /**
   * MKV TrackNumber of the audio currently driving the player. Seeded from
   * the `?audio=` URL param on mount, then snapped to the first compatible
   * track once the header parse confirms what's actually in the file. `null`
   * means "no MKV audio info yet" — the default for a fresh-open with no
   * `?audio=` param before extractMkvSubtitles returns.
   */
  const [selectedMkvAudioTrackNumber, setSelectedMkvAudioTrackNumber] =
    useState<number | null>(requestedAudioTrackNumber);
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
  /** Live <video> element handed up from DrivePlayer via `onVideoElement`.
   *  Used by `handleScreenshot` to grab the current frame; we keep the ref
   *  separate from the MSE-owning `onVideoRef` path so a future feature
   *  toggling MSE doesn't blow away the screenshot capability. */
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  /** Transient feedback for the screenshot button: shown for ~1.6s after a
   *  click so the user gets confirmation (or a security-block hint) without
   *  needing a toast system. */
  const [screenshotStatus, setScreenshotStatus] = useState<
    "idle" | "saved" | "blocked" | "error"
  >("idle");
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
  const mkvSubBackgroundActiveRef = useRef(false);
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
    if (!folderId || !fileId) {
      setError(null);
      setErrorReason(null);
      setUnsupported(false);
      setFile(null);
      setStreamUrl(null);
      setSubtitleTracks([]);
      setMkvAudioTracks([]);
      setFolderVideos([]);
      setFolderName("");
      setShowFolderName("");
      setInitialSeek(0);
      return;
    }

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
    setMkvAudioTracks([]);
    setSelectedMkvAudioTrackNumber(null);
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
    mkvSubBackgroundActiveRef.current = false;
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

        // Resume position MUST be set before `setStreamUrl` below — otherwise
        // DrivePlayer mounts with `initialSeek=0`, its `loadedmetadata`
        // handler captures that zero in a stable-closure `useEffect([])`,
        // and the resume pill never fires even after `initialSeek` updates
        // on a subsequent render. Skipped on `?restart=1` (the lobby's
        // Restart button) and below the 5s minimum (too short to be worth
        // resuming over the standard start-from-zero behavior).
        if (!restartRequested && saved && saved.positionSeconds > 5) {
          setInitialSeek(saved.positionSeconds);
        } else {
          // Explicit reset so an autoplay-next jump from a partially-watched
          // episode to a fresh one doesn't carry the previous offset over.
          setInitialSeek(0);
        }

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
          debugLog(
            `[playback] mode=${decision.mode} reason=${decision.reason} file=${video.name}`,
          );

          // Run MKV subtitle extraction BEFORE setting isMkvMse so the
          // feeder ref is populated when React creates the MSE controller.
          // This is fast — just a 4 MB header fetch + parse, no streaming.
          const ac = new AbortController();
          mkvExtractAbortRef.current = ac;
          let extracted: Awaited<ReturnType<typeof extractMkvSubtitles>> | null =
            null;
          let probedAudioTracks: MkvAudioTrack[] = [];
          try {
            extracted = await extractMkvSubtitles(fileId, {
              signal: ac.signal,
              onHeader: ({ buf, fileSize: mkvFileSize }) => {
                if (!cancelled) {
                  mkvHeaderRef.current = { buf, fileSize: mkvFileSize };
                }
              },
              onProgress: (mkvSubs) => {
                if (cancelled) return;
                const mkvTracks: SubtitleTrack[] = mkvSubs.map((s) => {
                  // Hand the (possibly partial) ASS script to libass as soon
                  // as the extractor produces it. The script grows as clusters
                  // arrive; JassubOverlay debounces setTrack so the worker
                  // isn't churned per chunk. This is what lets fansub
                  // typesetting (top-center romaji, bottom-right translation,
                  // colored signs, italics) appear from the first cue rather
                  // than only after the whole MKV has finished streaming.
                  const useJassub = !!s.assSource && !s.imageBased;
                  // PGS tracks no longer block the picker — surface them as
                  // selectable once finalize() has produced compositions.
                  // While extraction is in progress, the track shows as
                  // image-based with zero cues, same as before.
                  const pgsReady =
                    !!s.pgsCompositions &&
                    s.pgsCompositions.length > 0 &&
                    s.pgsCompositionsComplete === true;
                  return {
                    id: s.id,
                    lang: s.lang,
                    label: s.label,
                    cues: s.cues.slice(),
                    imageBased: s.imageBased && !pgsReady,
                    source: "embedded",
                    format: subtitleFormatFromMkvCodec(s.codecId, s.imageBased),
                    codecId: s.codecId,
                    assSource: useJassub ? s.assSource : undefined,
                    assRenderer: useJassub ? "jassub" : undefined,
                    pgsCompositions: pgsReady ? s.pgsCompositions : undefined,
                  };
                });
                setSubtitleTracks((prev) => [
                  ...prev.filter((t) => !t.id.startsWith("mkv-")),
                  ...mkvTracks,
                ]);
              },
            });
            if (!cancelled) {
              // Probe each audio track's codec combo against MSE *before*
              // surfacing it in the picker. The check matters for files
              // like HEVC + AC-3 where each codec individually works in
              // MSE but Chrome refuses the muxed combination — without
              // the probe, the user would click the AC-3 row, the page
              // would reload into a forced-MSE attempt, the controller
              // would fail at `isTypeSupported`, and we'd have to bounce
              // them back via the codec-error recovery path (visible
              // double-reload + scary console errors).
              //
              // The muxer-default track is assumed supported because
              // native playback is already proving it works; we only
              // probe non-default tracks (the ones that would force MSE).
              const probedTracks = await probeMkvAudioTrackSupport(
                mkvHeaderRef.current?.buf,
                extracted.audioTracks,
              );
              probedAudioTracks = probedTracks;
              setMkvAudioTracks(probedTracks);
              // Pick the active highlight so it matches what will *actually*
              // play. The URL-requested track wins when it exists AND we can
              // honor it (either it's MSE-remuxable + browser-supported so
              // we'll force MSE below, or it happens to be the muxer-default
              // that native picks too). Otherwise fall back to the first
              // audio track.
              const requested = requestedAudioTrackNumber;
              const requestedTrack =
                requested != null
                  ? probedTracks.find((t) => t.number === requested)
                  : undefined;
              const willHonor =
                !!requestedTrack &&
                ((requestedTrack.remuxable &&
                  requestedTrack.browserSupported !== false) ||
                  requestedTrack.number === probedTracks[0]?.number);
              const initial = willHonor
                ? requestedTrack
                : probedTracks[0];
              if (initial) setSelectedMkvAudioTrackNumber(initial.number);
            }
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

          // If the URL pinned a specific audio track via `?audio=N` and the
          // muxer's default isn't that track, force MSE mode for this load.
          // Native MKV in Chrome always picks the first audio track and
          // ignores any client-side preference, so the only reliable way
          // to honor the user's dub pick is to bake it into the MSE init
          // segment.
          //
          // We force MSE only when:
          //   - the target track is in the MSE remuxer's codec whitelist, AND
          //   - the browser's `isTypeSupported` accepts the muxed combo with
          //     the file's video codec.
          //
          // Otherwise the MSE attempt would fail at the controller's
          // pre-flight check, the user would see two scary console errors,
          // and we'd have to recover via navigate(replace). The probe above
          // catches these cases up front so the bad path never starts.
          let effectiveMode = decision.mode;
          if (
            effectiveMode !== "mse-remux" &&
            requestedAudioTrackNumber != null
          ) {
            const target = probedAudioTracks.find(
              (t) => t.number === requestedAudioTrackNumber,
            );
            const isMuxerDefault =
              probedAudioTracks[0]?.number === requestedAudioTrackNumber;
            if (
              target &&
              target.remuxable &&
              target.browserSupported !== false &&
              !isMuxerDefault
            ) {
              debugLog(
                `[playback] forcing MSE mode to honor ?audio=${requestedAudioTrackNumber} ` +
                `(target=${target.label})`,
              );
              effectiveMode = "mse-remux";
              setPlaybackMode("mse-remux");
            } else if (target && !target.remuxable) {
              // eslint-disable-next-line no-console
              console.warn(
                `[playback] ?audio=${requestedAudioTrackNumber} requests ` +
                `"${target.label}" (codec ${target.codecId}) which isn't in ` +
                `the MSE remuxer's whitelist; native playback will likely ` +
                `pick the muxer-default track instead.`,
              );
            } else if (target && target.browserSupported === false) {
              // eslint-disable-next-line no-console
              console.warn(
                `[playback] ?audio=${requestedAudioTrackNumber} requests ` +
                `"${target.label}" but MediaSource.isTypeSupported rejected ` +
                `the muxed combo with this file's video codec — staying ` +
                `native on the muxer-default audio.`,
              );
            }
          }

          if (effectiveMode === "mse-remux") {
            setIsMkvMse(true);
            // MSE can pause its byte stream whenever SourceBuffers are far
            // ahead. That is good for quota, but it also delays subtitle cue
            // extraction if we only piggyback on media bytes. Run the same
            // low-priority sub-only scan used by native mode so ASS/JASSUB
            // tracks become usable even while playback backpressure sleeps.
            const header = mkvHeaderRef.current;
            const feeder = mkvSubFeederRef.current;
            debugLog(
              `[subs] mse-mode setup: header=${header ? `${header.buf.length}/${header.fileSize}` : "null"} ` +
              `feeder=${feeder ? "ready" : "null"}`,
            );
            if (header && feeder && header.buf.length < header.fileSize) {
              if (feeder.headerParsedTo < header.buf.length) {
                const trailing = header.buf.subarray(feeder.headerParsedTo);
                debugLog(
                  `[subs] priming feeder with header tail ` +
                  `[${feeder.headerParsedTo}, ${header.buf.length}) = ${trailing.length} bytes`,
                );
                feeder.feedChunk(trailing);
              }
              const subAbort = new AbortController();
              mkvSubStreamAbortRef.current = subAbort;
              mkvSubBackgroundActiveRef.current = true;
              debugLog(
                `[subs] starting MSE background stream offset=${header.buf.length} eof=${header.fileSize}`,
              );
              void streamMkvSubsInBackground(
                fileId,
                header.buf.length,
                feeder.feedChunk,
                feeder.finalize,
                subAbort.signal,
              );
            }
          } else {
            // Native attempt — needs an API-key-stamped URL because we can't
            // pass an Authorization header to <video src=…>. Without a key,
            // direct streaming is impossible (OAuth-only mode); fall straight
            // to MSE in that case.
            const directUrl = await buildPublicStreamUrl(fileId);
            if (cancelled) return;
            if (!directUrl) {
              debugLog("[playback] no API key; MKV → MSE (OAuth mode)");
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
              debugLog(
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
                  // subarray (not slice) — zero-copy view. Safe because the
                  // feeder either consumes the bytes synchronously or makes
                  // its own .slice() copy for the straddling-element leftover
                  // path; either way the backing buffer (header.buf) is held
                  // alive by mkvHeaderRef until the next file loads.
                  const trailing = header.buf.subarray(feeder.headerParsedTo);
                  debugLog(
                    `[subs] priming feeder with header tail ` +
                    `[${feeder.headerParsedTo}, ${header.buf.length}) = ${trailing.length} bytes`,
                  );
                  feeder.feedChunk(trailing);
                }
                const subAbort = new AbortController();
                mkvSubStreamAbortRef.current = subAbort;
                mkvSubBackgroundActiveRef.current = true;
                debugLog(
                  `[subs] starting background stream offset=${header.buf.length} eof=${header.fileSize}`,
                );
                void streamMkvSubsInBackground(
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
                debugLog(
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
                // plain-text overlay (which is faster and respects the user's
                // typography settings). Font references are normalised to the
                // bundled fallback so libass doesn't stall scanning the OS for
                // a face it'll never find; everything else (alignment, color,
                // positioning, karaoke, fades) is left exactly as authored.
                source: "external",
                format: subtitleFormatFromExtension(ext),
                assSource: isAss
                  ? stripAssFontReferences(entry.text)
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

        // Resume position is set earlier in this effect — before
        // `setStreamUrl` — so DrivePlayer mounts with the correct
        // `initialSeek` and its loadedmetadata handler observes a non-zero
        // value on the very first fire.
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
      mkvSubBackgroundActiveRef.current = false;
      mkvSubFeederRef.current = null;
      if (nativeWatchdogRef.current !== null) {
        window.clearTimeout(nativeWatchdogRef.current);
        nativeWatchdogRef.current = null;
      }
    };
  }, [
    folderId,
    fileId,
    reportError,
    restartRequested,
    requestedAudioTrackNumber,
  ]);

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

  /**
   * Builds and starts a fresh MseController bound to `videoEl`. The
   * `audioTrackNumber` is seeded from the `?audio=` URL param at mount time,
   * which is how a dub switch (full page reload via `handlePickAudioTrack
   * Number`) ends up baking the chosen track into the fMP4 init segment.
   *
   * `resumeAtSeconds` lets a one-shot `canplay` handler land the playhead
   * at a specific time — currently unused outside `handleVideoRef` (which
   * passes `videoEl.currentTime`, 0 on a fresh mount).
   */
  const startMseController = useCallback(
    (
      videoEl: HTMLVideoElement,
      audioTrackNumber: number | null,
      resumeAtSeconds: number,
    ) => {
      const ctrl = new MkvMseController();
      mseControllerRef.current = ctrl;
      ctrl.onReady = () => {
        // MSE controller has set videoEl.src directly via DOM.
        // Do NOT call setStreamUrl here — that would cause React to
        // re-render DrivePlayer with a new src prop, which re-triggers
        // video.src assignment and aborts the MediaSource connection.
      };
      ctrl.onError = (err) => {
        // eslint-disable-next-line no-console
        console.error("MKV MSE error:", err);
        // Dub-switch reload that landed on an MSE codec combination the
        // browser refuses (the common case: HEVC video + AC-3 audio, which
        // Chrome plays each-of-individually for native MKV but refuses to
        // bundle in one fMP4 init segment). Silently roll back to the
        // muxer-default audio via a `navigate(replace)` — the user gets
        // their original native playback back instead of being parked on
        // an error screen with no obvious next action.
        //
        // `replace: true` so the failed `?audio=…` URL doesn't sit in
        // history; the back button still takes the user to the library.
        const codecMessage = err?.message ?? "";
        const isCodecError = /codec|isn't supported/i.test(codecMessage);
        if (requestedAudioTrackNumber != null && isCodecError) {
          // eslint-disable-next-line no-console
          console.warn(
            `[playback] MSE rejected the codec combo for audio=` +
            `${requestedAudioTrackNumber}; reverting to muxer-default audio. ` +
            `Reason: ${codecMessage}`,
          );
          const params = new URLSearchParams(searchParams);
          params.delete("audio");
          const qs = params.toString();
          navigate(
            `/play/${folderId}/${fileId}${qs ? `?${qs}` : ""}`,
            { replace: true },
          );
          return;
        }
        reportError(err);
      };
      const feeder = mkvSubFeederRef.current;
      if (feeder && !mkvSubBackgroundActiveRef.current) {
        ctrl.onRawChunk = (data) => feeder.feedChunk(data);
        ctrl.onStreamComplete = () => feeder.finalize();
      }
      if (resumeAtSeconds > 0) {
        const onCanPlay = () => {
          try {
            videoEl.currentTime = resumeAtSeconds;
          } catch {
            // best-effort — element may have unmounted
          }
          videoEl.removeEventListener("canplay", onCanPlay);
        };
        videoEl.addEventListener("canplay", onCanPlay);
      }
      const selectedTrack = audioTrackNumber != null
        ? mkvAudioTracks.find((t) => t.number === audioTrackNumber)
        : undefined;
      const externalAudio =
        selectedTrack?.externalAudioSupported === true &&
        selectedTrack.mseAudioSupported !== true
          ? "webcodecs"
          : undefined;
      if (selectedTrack) {
        // eslint-disable-next-line no-console
        console.info(
          `[playback] audio path track=${selectedTrack.number} ` +
          `mse=${selectedTrack.mseAudioSupported === true} ` +
          `externalAudio=${selectedTrack.externalAudioSupported === true} ` +
          `chosen=${externalAudio === "webcodecs" ? "external:webcodecs" : "mse"}`,
        );
      }
      void ctrl.start(
        fileId,
        videoEl,
        mkvHeaderRef.current ?? undefined,
        audioTrackNumber != null || externalAudio
          ? { audioTrackNumber: audioTrackNumber ?? undefined, externalAudio }
          : undefined,
      );
    },
    [
      fileId,
      folderId,
      navigate,
      mkvAudioTracks,
      reportError,
      requestedAudioTrackNumber,
      searchParams,
    ],
  );

  // MSE: when the player exposes its <video> ref, attach the controller.
  //
  // `videoEl.currentTime` does double duty as the resume-after-mount point.
  // On the first mount it's 0 (DrivePlayer's loadedmetadata path applies
  // `initialSeek` separately), but on a native→MSE handover triggered by a
  // dub switch it carries the moment the user clicked, so playback continues
  // there instead of restarting from 0.
  const handleVideoRef = useCallback(
    (videoEl: HTMLVideoElement | null) => {
      if (!videoEl || !isMkvMse || !file) return;
      if (mseControllerRef.current) return;
      const resumeAt = videoEl.currentTime || 0;
      startMseController(videoEl, selectedMkvAudioTrackNumber, resumeAt);
    },
    [isMkvMse, file, selectedMkvAudioTrackNumber, startMseController],
  );

  /**
   * User picked a dub from the SettingsPopover.
   *
   * Fast path (MSE): the controller exposes `switchAudio(trackNumber)` which
   * resets just the audio SourceBuffer (`changeType` + new init segment) and
   * fires a parallel range-fetch to backfill audio between `currentTime`
   * and the main stream's byte position. The video buffer is untouched, so
   * the picture never blinks — VLC-style instant switch.
   *
   * Slow path (fallback): when the controller isn't available (codec combo
   * couldn't be probed, controller errored out, etc.) we fall back to the
   * old route-reload model — same `?audio=<n>` URL contract so the new
   * load picks the right track from scratch.
   *
   * Tracks the muxer can't repack (DTS/TrueHD/non-whitelisted codecs) bail
   * with a console warning regardless of path.
   */
  const handlePickAudioTrackNumber = useCallback(
    (trackNumber: number) => {
      if (trackNumber === selectedMkvAudioTrackNumber) return;
      const target = mkvAudioTracks.find((t) => t.number === trackNumber);
      if (!target) return;
      if (!target.remuxable) {
        // eslint-disable-next-line no-console
        console.warn(
          `[playback] dub "${target.label}" uses codec "${target.codecId}" ` +
          `which Nyrima's MSE remuxer can't repack; staying on the current ` +
          `dub. (No reliable client-side way to switch into this codec.)`,
        );
        return;
      }
      if (target.browserSupported === false) {
        // eslint-disable-next-line no-console
        console.warn(
          `[playback] dub "${target.label}" can't be muxed with this ` +
          `file's video codec in MSE; switch aborted to avoid a failed ` +
          `swap.`,
        );
        return;
      }

      const ctrl = mseControllerRef.current;
      if (ctrl && isMkvMse) {
        // Fast path: in-place swap via the controller's split-buffer API.
        // Optimistically update the UI selection so the picker pill flips
        // immediately; if `switchAudio` rejects (rare — same-track, no
        // header, codec unsupported), the controller logs and we revert.
        const prev = selectedMkvAudioTrackNumber;
        setSelectedMkvAudioTrackNumber(trackNumber);
        // Keep the URL in sync so a refresh / back-forward restores the
        // chosen dub. `replace: true` so we don't pollute history with a
        // new entry per pick.
        setSearchParams(
          (params) => {
            params.set("audio", String(trackNumber));
            return params;
          },
          { replace: true },
        );
        debugLog(
          `[playback] in-place dub switch ${prev} → ${trackNumber} ` +
          `(target=${target.label})`,
        );
        void ctrl
          .switchAudio(trackNumber)
          .then((ok) => {
            if (!ok) setSelectedMkvAudioTrackNumber(prev);
          })
          .catch((err: unknown) => {
            setSelectedMkvAudioTrackNumber(prev);
            // eslint-disable-next-line no-console
            console.warn("[playback] in-place switchAudio failed:", err);
          });
        return;
      }

      // Slow path — controller unavailable (native MKV mode, or MSE not
      // running yet). Preserve the snapshot + reload contract from before
      // the split-buffer work landed.
      const v = videoElRef.current;
      if (v && file) {
        void savePlaybackPosition({
          fileId: file.id,
          positionSeconds: v.currentTime,
          durationSeconds: v.duration || 0,
          updatedAt: Date.now(),
          name: file.name,
          folderId,
          mimeType: file.mimeType,
        });
      }

      const params = new URLSearchParams(searchParams);
      params.set("audio", String(trackNumber));
      params.delete("restart");
      debugLog(
        `[playback] dub switch ${selectedMkvAudioTrackNumber} → ${trackNumber}: ` +
        `navigating with ?audio=${trackNumber} (target=${target.label})`,
      );
      navigate(`/play/${folderId}/${fileId}?${params.toString()}`);
    },
    [
      selectedMkvAudioTrackNumber,
      mkvAudioTracks,
      isMkvMse,
      file,
      folderId,
      fileId,
      navigate,
      searchParams,
      setSearchParams,
    ],
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
    debugLog(`[playback] canplay reached; mode=${ctx.mode ?? "?"}`);
    if (ctx.fileId && ctx.mode) void rememberMode(ctx.fileId, ctx.mode);
    if (!file) return;
    summarizePlaybackStartup(file.name);
  }, [file]);

  // Throttled playback-position persistence.
  //
  // `folderId`, `name`, and `mimeType` are persisted on every tick (not
  // just on the watched/unwatched menu paths) so the *first* save for a
  // freshly opened episode already carries enough context for the lobby's
  // ContinueHero to build a valid `/play/<folderId>/<fileId>` URL.
  // Without these, `savePlaybackPosition`'s merge has nothing to merge
  // into and writes a row with `folderId: undefined`, which surfaced as
  // `/play//<fileId>` and a router warning.
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
        name: file.name,
        folderId,
        mimeType: file.mimeType,
      });
    },
    [file, folderId],
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

  // Folder cover poster — the user-placed `Poster.{jpg,png,…}` in this
  // library, or the parent library's poster when this is a season subfolder
  // with none of its own. Used for both the ambient bloom behind the
  // current episode AND the Next-up card; since both episodes live in the
  // same folder, the same poster is correct for both.
  const [folderPosterUrl, setFolderPosterUrl] = useState<string | undefined>();
  useEffect(() => {
    if (!folderId) {
      setFolderPosterUrl(undefined);
      return;
    }
    let cancelled = false;
    void (async () => {
      // The folder listing was already pulled at player boot, so this is a
      // cache hit unless the user navigated past the cache TTL.
      const poster = await resolveFolderPoster(folderId);
      if (!cancelled) setFolderPosterUrl(poster?.url);
    })();
    return () => {
      cancelled = true;
    };
  }, [folderId]);
  const currentPosterUrl = folderPosterUrl;
  const nextPosterUrl = folderPosterUrl;

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
  if (invalidRouteIds) {
    return (
      <PlayerErrorCard
        title="Invalid video link"
        body="This Nyrima URL has a malformed Drive folder or file ID. Open the video from a valid Drive folder link."
        onBack={() => navigate("/")}
      />
    );
  }

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

  /**
   * Capture the current video frame and download it as a PNG.
   *
   * Implementation notes:
   *   - We draw the live <video> element straight onto a canvas at native
   *     `videoWidth × videoHeight`. No re-scaling, so a 1080p stream yields
   *     a 1920×1080 PNG.
   *   - Canvas reads throw `SecurityError` when the video bytes are
   *     cross-origin without CORS — that's the native-stream-via-DNR path
   *     (Drive's media endpoint doesn't send Access-Control-Allow-Origin,
   *     and the DNR-injected Authorization header conflicts with a
   *     `crossOrigin="anonymous"` attribute). We catch that explicitly and
   *     surface a "blocked" badge rather than failing silently.
   *   - MSE mode + blob fallback both feed <video> from same-origin URLs
   *     (`MediaSource` and `blob:` URIs respectively), so screenshots work
   *     in those paths even when native streaming can't.
   */
  function handleScreenshot() {
    const v = videoElRef.current;
    if (!v || !file) return;
    const w = v.videoWidth;
    const h = v.videoHeight;
    if (w === 0 || h === 0) {
      setScreenshotStatus("error");
      window.setTimeout(() => setScreenshotStatus("idle"), 1600);
      return;
    }
    try {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setScreenshotStatus("error");
        window.setTimeout(() => setScreenshotStatus("idle"), 1600);
        return;
      }
      ctx.drawImage(v, 0, 0, w, h);
      // toBlob is async; it's also where the canvas-tainted SecurityError
      // surfaces on cross-origin video bytes. Use the callback form so the
      // error handler reaches it; toDataURL would have thrown synchronously
      // but is heavier on memory for high-res frames.
      canvas.toBlob((blob) => {
        if (!blob) {
          setScreenshotStatus("error");
          window.setTimeout(() => setScreenshotStatus("idle"), 1600);
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = buildScreenshotFilename(
          displayTitle || file.name,
          v.currentTime,
        );
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Revoke after a tick so the browser has time to start the download.
        window.setTimeout(() => URL.revokeObjectURL(url), 1500);
        setScreenshotStatus("saved");
        window.setTimeout(() => setScreenshotStatus("idle"), 1600);
      }, "image/png");
    } catch (e) {
      // Most likely the "tainted canvas" SecurityError thrown by drawImage
      // on cross-origin video bytes. Surface a distinct "blocked" state so
      // the user understands it's not a transient error.
      const msg = e instanceof Error ? e.message : String(e);
      const tainted =
        msg.includes("Tainted") || msg.includes("SecurityError");
      setScreenshotStatus(tainted ? "blocked" : "error");
      window.setTimeout(() => setScreenshotStatus("idle"), 1600);
    }
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
                silentResume={isDubSwitchReload}
                onMediaError={handleMediaError}
                onTimeUpdate={handleTimeUpdate}
                onCanPlay={handleCanPlay}
                onVideoRef={
                  isMkvMse && !isMkvNative ? handleVideoRef : undefined
                }
                onVideoElement={(el) => {
                  videoElRef.current = el;
                }}
                nextVideo={nextAdapter}
                prevVideo={prevAdapter}
                onNext={handleNext}
                onPrev={handlePrev}
                mkvAudioTracks={mkvAudioTracks}
                selectedMkvAudioTrackNumber={selectedMkvAudioTrackNumber}
                onPickAudioTrackNumber={handlePickAudioTrackNumber}
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
                    onClick={handleScreenshot}
                    disabled={screenshotStatus !== "idle"}
                    title={
                      screenshotStatus === "blocked"
                        ? "Browser blocked the capture (cross-origin video). Screenshots only work in MSE or blob playback modes."
                        : "Save the current frame as a PNG"
                    }
                  >
                    {screenshotStatus === "saved"
                      ? "Saved ✓"
                      : screenshotStatus === "blocked"
                        ? "Blocked"
                        : screenshotStatus === "error"
                          ? "Couldn't capture"
                          : "Screenshot"}
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

/**
 * Build a download filename for a screenshot. Format: `<title> - <timecode>.png`,
 * with the title stripped of any container extension and the timecode rendered
 * with `h_mm_ss_ms3` so it sorts naturally and survives Windows path rules
 * (no colons, no slashes). Returns an opaque "screenshot.png" fallback when
 * the title is empty so the download never lands with a bare extension.
 */
function buildScreenshotFilename(title: string, currentTimeSec: number): string {
  const stem = (title || "")
    .replace(/\.[^./\\]+$/, "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .trim();
  const tc = formatTimecodeForFilename(currentTimeSec);
  if (!stem) return `screenshot-${tc}.png`;
  return `${stem} - ${tc}.png`;
}

/** `1h05m30s` / `4m17s` / `42s` — colon-free so Windows accepts it. */
function formatTimecodeForFilename(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0s";
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}h${mm}m${ss}s` : m > 0 ? `${m}m${ss}s` : `${s}s`;
}

/**
 * Annotate each MKV audio track with `browserSupported`, derived from
 * `MediaSource.isTypeSupported` against the muxed `video/mp4; codecs="…"`
 * mime type the MSE remuxer would generate.
 *
 * Why probe at all: Chrome's MSE has odd allow-list combinations — it'll
 * happily decode HEVC + AAC and AC-3 + AVC, but refuses HEVC + AC-3
 * together. Without this probe the user clicks AC-3, the page reloads
 * into a forced-MSE attempt, the controller's pre-flight check fails, and
 * we have to bounce them back via the reactive recovery path with two
 * scary console errors. The probe runs synchronously off the already-
 * parsed header buffer (no extra network), so the cost is negligible.
 *
 * `headerBuf` may be undefined if the header fetch failed earlier; in
 * that case we conservatively mark every non-default track as
 * `browserSupported: false` so a click can't silently fail later.
 *
 * The muxer-default track always reports `true` — native playback is
 * already proving it works, no probe needed.
 */
async function probeMkvAudioTrackSupport(
  headerBuf: Uint8Array | undefined,
  audioTracks: MkvAudioTrack[],
): Promise<MkvAudioTrack[]> {
  if (audioTracks.length === 0) return audioTracks;
  const defaultNumber = audioTracks[0]?.number;
  if (typeof MediaSource === "undefined") {
    // SSR / non-browser env: don't disable anything.
    return audioTracks.map((t) => ({ ...t, browserSupported: true }));
  }
  const probed = await Promise.all(audioTracks.map(async (t) => {
    if (t.number === defaultNumber) {
      if (!headerBuf) return { ...t, browserSupported: true };
    }
    if (!t.remuxable) {
      // Can't even build an init segment — leave the flag undefined so the
      // existing `remuxable: false` path handles the UI.
      return { ...t };
    }
    if (!headerBuf) {
      return { ...t, browserSupported: false };
    }
    try {
      const info = parseMkvMediaInfo(headerBuf, {
        audioTrackNumber: t.number,
      });
      if (!info.audio) return { ...t, browserSupported: false };
      // Split-buffer probe: each SourceBuffer is independent, so we ask the
      // browser per-track. The old single-buffer `buildMimeType` combined
      // them and made HEVC+AC-3 look unswitchable even though Chrome accepts
      // each codec on its own.
      const videoMime = buildVideoMimeType(info.video);
      const audioMime = buildAudioMimeType(info.audio);
      const mseSupported =
        MediaSource.isTypeSupported(videoMime) &&
        MediaSource.isTypeSupported(audioMime);
      const externalAudioSupported =
        await ExternalMkvAudioRenderer.isSupported(info.audio);
      const supported = mseSupported || externalAudioSupported;
      // eslint-disable-next-line no-console
      console.info(
        `[playback] codec probe track=${t.number} video="${videoMime}" ` +
        `audio="${audioMime}" mse=${mseSupported} ` +
        `externalAudio=${externalAudioSupported} supported=${supported}`,
      );
      return {
        ...t,
        browserSupported: supported,
        mseAudioSupported: mseSupported,
        externalAudioSupported,
      };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        `[playback] codec probe failed for track=${t.number}:`,
        e,
      );
      return { ...t, browserSupported: false };
    }
  }));

  // The muxer-default is natively playable, but keep richer probe metadata
  // (MSE-vs-external support) when the header was available.
  return probed.map((t) =>
    t.number === defaultNumber && t.browserSupported === false
      ? { ...t, browserSupported: true }
      : t,
  );
}

// ---------------------------------------------------------------------------
// Background subtitle stream for MKVs.
// ---------------------------------------------------------------------------

/**
 * Native MKV playback hides media bytes inside the browser, and MSE playback
 * can pause byte intake while SourceBuffers are already far ahead. In both
 * modes, this low-priority Range stream lets embedded subtitle extraction keep
 * moving independently of playback backpressure.
 *
 * Cost: a second Drive stream connection. We mitigate by:
 *   - routing through the queue at low priority (kind: "subtitle"), so
 *     metadata/playback requests get scheduled first
 *   - aborting on navigation
 *   - the OAuth path means the bandwidth is billed against the user's own
 *     account, not the throttled public-key quota
 */
async function streamMkvSubsInBackground(
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
    debugLog(
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
    debugLog(
      `[subs] stream finished: totalBytes=${totalBytes} aborted=${signal.aborted}`,
    );
    if (!signal.aborted) finalize();
  } catch (e) {
    if (signal.aborted) return;
    // eslint-disable-next-line no-console
    console.warn("[subs] background subtitle stream failed:", e);
  }
}

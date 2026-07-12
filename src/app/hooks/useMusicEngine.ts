/**
 * The music player's playback engine.
 *
 * Owns a detached `<audio>` element, a {@link MusicAudioGraph} (the live EQ),
 * the folder-derived queue, and the synced-lyrics state — and exposes a flat
 * API the page's presentational components bind to. Playback always goes
 * through a same-origin blob (see music-source) so the EQ stays audible and
 * OAuth-private tracks play.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  downloadAudioObjectUrl,
  findSiblingCover,
  findSiblingLrc,
  loadFolderContext,
  parseTrackName,
  prefetchAudioObjectUrl,
  type AudioFormatInfo,
} from "../services/music-source";
import { downloadTextFile } from "../services/drive-api";
import { mediaFormatLabel } from "../services/media-library-source";
import {
  isMediaSessionSupported,
  setMediaSessionActionHandlers,
  setMediaSessionMetadata,
  setMediaSessionPlaybackState,
  setMediaSessionPositionState,
} from "../services/media-session";
import {
  applyAudioOutputDevice,
  isOutputDeviceApiSupported,
  isOutputDevicePickerSupported,
  listAudioOutputDevices,
  pickAudioOutputDevice,
  type AudioOutputDevice,
} from "../services/audio-output";
import { MusicAudioGraph, type AudioControls } from "../services/audio-graph";
import { parseDisplayLyrics, type LrcLine } from "../services/lrc";
import {
  DEFAULT_EQ_VALUES,
  getEqPresetValues,
  shouldDeferPlaybackRequest,
  shouldStartPlaybackImmediately,
  type AudioPreset,
  volumePercentToElementVolume,
} from "../services/music-player";
import { isLocalId } from "@shared/local-id";
import { localLibrary } from "../services/local-library/local-source";
import { loadLocalFolderContext, localAudioObjectUrl } from "../services/local-library/local-music";
import type { DriveFile } from "@shared/types";

export type LyricsSource = "embedded" | "local" | "online";
export type EngineStatus = "idle" | "loading" | "ready" | "error";

export interface EngineTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  cover: string;
  format: string;
  source: "Drive" | "Local";
  year: string;
  genre: string;
  durationMs: number;
  /** Sample rate / bit depth / channels parsed from the source file (FLAC/WAV only). */
  sampleRate?: number;
  bitDepth?: number;
  channels?: number;
}

export interface QueueEntry {
  id: string;
  title: string;
  artist: string;
  metaLabel: string;
  current: boolean;
}

export interface RouteTrackHint {
  id?: string;
  title?: string;
  artist?: string;
  album?: string;
  cover?: string;
  durationMs?: number;
  format?: string;
  source?: "drive" | "local";
  year?: string;
  genre?: string;
  playlistIds?: string[];
  playlistFiles?: DriveFile[];
  autoPlay?: boolean;
}

const DEFAULT_CONTROLS: AudioControls = {
  bass: 4,
  treble: 2,
  voiceClarity: 3,
  surround: true,
  stabilizer: false,
  reverb: 1,
  soundStage: 5,
};
const WAVE_BAR_COUNT = 34;
const TRACK_FADE_MS = 2000;
const TRACK_FADE_SECONDS = TRACK_FADE_MS / 1000;

export interface MusicEngine {
  track: EngineTrack;
  status: EngineStatus;
  errorMessage: string | null;
  loadProgress: number;
  eqActive: boolean;
  waveBars: number[];

  playing: boolean;
  currentTimeSec: number;
  durationSec: number;
  volume: number;
  shuffle: boolean;
  repeat: boolean;
  togglePlay: () => void;
  seekToFraction: (fraction: number) => void;
  next: () => void;
  previous: () => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  setVolume: (value: number) => void;

  queue: QueueEntry[];
  reorderQueue: (from: number, to: number) => void;
  removeFromQueue: (id: string) => void;
  playNextInQueue: (id: string) => void;
  playTrack: (id: string) => void;

  preset: AudioPreset;
  eqValues: number[];
  controls: AudioControls;
  setPreset: (preset: AudioPreset) => void;
  setEqBand: (index: number, value: number) => void;
  setControls: (controls: AudioControls) => void;
  resetEq: () => void;

  lyrics: LrcLine[];
  lyricsStatus: "none" | "loading" | "ready";
  lyricsSource: LyricsSource;
  setLyricsSource: (source: LyricsSource) => void;
  loadLrcText: (text: string) => void;

  outputDevices: AudioOutputDevice[];
  outputDeviceId: string;
  outputDeviceLabel: string;
  outputDeviceSupported: boolean;
  outputDevicePickerSupported: boolean;
  setOutputDevice: (deviceId: string, label?: string) => Promise<boolean>;
  pickOutputDevice: () => Promise<boolean>;
}

export function useMusicEngine(
  routeFileId: string,
  routeTrack: RouteTrackHint | undefined,
): MusicEngine {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  if (!audioRef.current && typeof Audio !== "undefined") {
    audioRef.current = new Audio();
    audioRef.current.preload = "auto";
  }
  const graphRef = useRef<MusicAudioGraph | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  /** Local-track object URLs are owned by `localLibrary` and must not be revoked here. */
  const objectUrlIsLocalRef = useRef(false);
  const embeddedCoverUrlRef = useRef<string | null>(null);

  const [activeId, setActiveId] = useState(routeFileId);
  const [queueFiles, setQueueFiles] = useState<DriveFile[]>([]);
  const [allFiles, setAllFiles] = useState<DriveFile[]>([]);

  const [status, setStatus] = useState<EngineStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState(0);
  const [waveBars, setWaveBars] = useState<number[]>(() =>
    idleWaveBars(WAVE_BAR_COUNT),
  );
  const [embeddedCoverUrl, setEmbeddedCoverUrl] = useState<string | null>(null);
  const [embeddedLyricsText, setEmbeddedLyricsText] = useState<string | null>(null);
  const [audioFormat, setAudioFormat] = useState<AudioFormatInfo | null>(null);

  const [outputDevices, setOutputDevices] = useState<AudioOutputDevice[]>([]);
  const [outputDeviceId, setOutputDeviceId] = useState("default");
  const [outputDeviceLabel, setOutputDeviceLabel] = useState("System default");

  const [playing, setPlaying] = useState(false);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [volume, setVolumeState] = useState(68);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [eqActive, setEqActive] = useState(false);
  const targetVolumeRef = useRef(volumePercentToElementVolume(68));
  const fadeFrameRef = useRef<number | null>(null);
  const fadeResolveRef = useRef<(() => void) | null>(null);
  const fadeSerialRef = useRef(0);
  const endingFadeTrackRef = useRef<string | null>(null);
  const transitionSerialRef = useRef(0);

  const [preset, setPresetState] = useState<AudioPreset>("Anime OST");
  const [eqValues, setEqValues] = useState<number[]>(() =>
    getEqPresetValues("Anime OST"),
  );
  const [controls, setControlsState] = useState<AudioControls>(DEFAULT_CONTROLS);

  const [lyrics, setLyrics] = useState<LrcLine[]>([]);
  const [lyricsStatus, setLyricsStatus] = useState<"none" | "loading" | "ready">(
    "none",
  );
  const [lyricsSource, setLyricsSource] = useState<LyricsSource>("local");

  // Refs the audio event handlers read so we can bind listeners exactly once.
  const playStateRef = useRef({ shuffle, repeat, pendingPlay: false });
  const navRef = useRef<{ next: () => void }>({ next: () => {} });
  const activeIdRef = useRef(activeId);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const cancelFade = useCallback(() => {
    if (fadeFrameRef.current != null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(fadeFrameRef.current);
    }
    fadeFrameRef.current = null;
    fadeSerialRef.current += 1;
    fadeResolveRef.current?.();
    fadeResolveRef.current = null;
  }, []);

  const fadeElementTo = useCallback(
    (target: number, durationMs = TRACK_FADE_MS): Promise<void> => {
      const el = audioRef.current;
      const clampedTarget = Math.min(1, Math.max(0, target));
      if (!el) return Promise.resolve();
      cancelFade();

      if (durationMs <= 0 || typeof requestAnimationFrame !== "function") {
        el.volume = clampedTarget;
        return Promise.resolve();
      }

      const serial = fadeSerialRef.current;
      const startVolume = el.volume;
      const startedAt =
        typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now();

      return new Promise((resolve) => {
        fadeResolveRef.current = resolve;
        const tick = (timestamp: number) => {
          if (serial !== fadeSerialRef.current) return;
          const elapsed = timestamp - startedAt;
          const progress = Math.min(1, elapsed / durationMs);
          el.volume = startVolume + (clampedTarget - startVolume) * progress;
          if (progress >= 1) {
            fadeFrameRef.current = null;
            fadeResolveRef.current = null;
            el.volume = clampedTarget;
            resolve();
            return;
          }
          fadeFrameRef.current = requestAnimationFrame(tick);
        };
        fadeFrameRef.current = requestAnimationFrame(tick);
      });
    },
    [cancelFade],
  );

  const playWithFadeIn = useCallback((): Promise<boolean> => {
    const el = audioRef.current;
    if (!el) return Promise.resolve(false);
    const targetVolume = targetVolumeRef.current;
    endingFadeTrackRef.current = null;
    cancelFade();
    if (!hasPlayableAudioSource(el)) {
      el.volume = targetVolume;
      return Promise.resolve(false);
    }
    el.volume = 0;
    return el
      .play()
      .then(() => {
        void fadeElementTo(targetVolume, TRACK_FADE_MS);
        return true;
      })
      .catch(() => {
        cancelFade();
        el.volume = targetVolume;
        if (el.paused) setPlaying(false);
        return false;
      });
  }, [cancelFade, fadeElementTo]);

  const fadeOutThen = useCallback(
    (action: () => void) => {
      const el = audioRef.current;
      const serial = ++transitionSerialRef.current;
      const run = () => {
        if (serial === transitionSerialRef.current) action();
      };
      if (!el || el.paused || el.ended || status !== "ready") {
        run();
        return;
      }
      void fadeElementTo(0, TRACK_FADE_MS).then(run);
    },
    [fadeElementTo, status],
  );

  // --- audio element lifecycle ---------------------------------------------
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => {
      const current = el.currentTime || 0;
      setCurrentTimeSec(current);
      const duration = Number.isFinite(el.duration) ? el.duration : 0;
      const remaining = duration - current;
      if (
        !el.paused &&
        duration > 0 &&
        remaining > 0 &&
        remaining <= TRACK_FADE_SECONDS &&
        endingFadeTrackRef.current !== activeIdRef.current
      ) {
        endingFadeTrackRef.current = activeIdRef.current;
        void fadeElementTo(0, Math.max(120, remaining * 1000));
      }
    };
    const onDuration = () =>
      setDurationSec(Number.isFinite(el.duration) ? el.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      if (playStateRef.current.repeat) {
        el.currentTime = 0;
        void playWithFadeIn();
        return;
      }
      navRef.current.next();
    };
    const onError = () => {
      setStatus("error");
      setErrorMessage("This track could not be played.");
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("durationchange", onDuration);
    el.addEventListener("loadedmetadata", onDuration);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onError);
    el.volume = targetVolumeRef.current;
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("durationchange", onDuration);
      el.removeEventListener("loadedmetadata", onDuration);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onError);
      cancelFade();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dispose the graph + revoke the last blob on unmount.
  useEffect(() => {
    return () => {
      cancelFade();
      graphRef.current?.dispose();
      if (objectUrlRef.current && !objectUrlIsLocalRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
      if (embeddedCoverUrlRef.current) URL.revokeObjectURL(embeddedCoverUrlRef.current);
      audioRef.current?.pause();
    };
  }, [cancelFade]);

  useEffect(() => {
    playStateRef.current.shuffle = shuffle;
    playStateRef.current.repeat = repeat;
  }, [shuffle, repeat]);

  // --- folder context (queue source) ---------------------------------------
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const routeQueue = orderQueueFiles(
      routeTrack?.playlistFiles ?? [],
      routeTrack?.playlistFiles?.find((file) => file.id === routeFileId) ??
        routeTrack?.playlistFiles?.[0] ?? {
          id: routeFileId,
          name: routeTrack?.title ?? "Current track",
          mimeType: "audio/*",
        },
      routeTrack?.playlistIds,
    );
    setActiveId(routeFileId);
    if (routeTrack?.autoPlay) {
      playStateRef.current.pendingPlay = true;
    }
    if (routeQueue.length > 0) {
      setQueueFiles(routeQueue);
      setAllFiles(routeQueue);
    }
    const contextPromise = isLocalId(routeFileId)
      ? loadLocalFolderContext(routeFileId)
      : loadFolderContext(routeFileId, controller.signal);
    contextPromise
      .then((ctx) => {
        if (cancelled) return;
        const preferredFiles = routeQueue.length > 0
          ? mergeDriveFiles(routeQueue, ctx.audioFiles)
          : ctx.audioFiles.length > 0
            ? ctx.audioFiles
            : [ctx.currentFile];
        const queue = orderQueueFiles(
          preferredFiles,
          ctx.currentFile,
          routeTrack?.playlistIds,
        );
        setAllFiles(mergeDriveFiles(ctx.allFiles, routeQueue));
        setQueueFiles(queue);
      })
      .catch(() => {
        // Folder discovery failed (bad id / no access). Playback may still
        // surface its own error; the queue just stays empty.
        if (!cancelled) {
          setAllFiles(routeQueue);
          setQueueFiles(routeQueue);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [routeFileId, routeTrack?.autoPlay, routeTrack?.playlistFiles, routeTrack?.playlistIds, routeTrack?.title]);

  // --- track source loading -------------------------------------------------
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !activeId) return;
    let cancelled = false;
    const controller = new AbortController();

    setStatus("loading");
    setErrorMessage(null);
    setLoadProgress(0);
    setCurrentTimeSec(0);
    setWaveBars(idleWaveBars(WAVE_BAR_COUNT));
    endingFadeTrackRef.current = null;
    cancelFade();
    el.autoplay = false;
    el.volume = targetVolumeRef.current;
    setEmbeddedLyricsText(null);
    setLyricsSource("local");
    setLyrics([]);
    setLyricsStatus("none");
    if (embeddedCoverUrlRef.current) {
      URL.revokeObjectURL(embeddedCoverUrlRef.current);
      embeddedCoverUrlRef.current = null;
    }
    setEmbeddedCoverUrl(null);
    setAudioFormat(null);

    const isLocalTrack = isLocalId(activeId);
    const loadPromise = isLocalTrack
      ? localAudioObjectUrl(activeId).then((audio) => {
          if (!cancelled) setLoadProgress(1);
          return audio;
        })
      : downloadAudioObjectUrl(activeId, {
          signal: controller.signal,
          priority: "critical",
          kind: "media-stream",
          onProgress: (fraction) => {
            if (!cancelled) setLoadProgress(fraction);
          },
        });

    loadPromise
      .then(({ url, embedded, format }) => {
        if (cancelled) {
          if (!isLocalTrack) URL.revokeObjectURL(url);
          if (embedded.pictureUrl) URL.revokeObjectURL(embedded.pictureUrl);
          return;
        }
        if (objectUrlRef.current && !objectUrlIsLocalRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
        }
        objectUrlRef.current = url;
        objectUrlIsLocalRef.current = isLocalTrack;
        setAudioFormat(format ?? null);
        if (embeddedCoverUrlRef.current) {
          URL.revokeObjectURL(embeddedCoverUrlRef.current);
          embeddedCoverUrlRef.current = null;
        }
        if (embedded.pictureUrl) {
          embeddedCoverUrlRef.current = embedded.pictureUrl;
          setEmbeddedCoverUrl(embedded.pictureUrl);
        } else {
          setEmbeddedCoverUrl(null);
        }
        const embeddedLyrics = embedded.lyricsText?.trim() || null;
        setEmbeddedLyricsText(embeddedLyrics);
        if (embeddedLyrics) setLyricsSource("embedded");
        const shouldStartWhenReady = playStateRef.current.pendingPlay;
        el.autoplay = shouldStartWhenReady;
        el.src = url;
        el.load();
        setStatus("ready");
        if (shouldStartWhenReady) {
          playStateRef.current.pendingPlay = false;
          void playWithFadeIn();
        }
      })
      .catch((err) => {
        if (cancelled || controller.signal.aborted) return;
        setStatus("error");
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to load this track.",
        );
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeId, cancelFade, playWithFadeIn]);

  // --- volume + EQ propagation ---------------------------------------------
  useEffect(() => {
    targetVolumeRef.current = volumePercentToElementVolume(volume);
    if (audioRef.current && !fadeResolveRef.current) {
      audioRef.current.volume = targetVolumeRef.current;
    }
  }, [volume]);

  useEffect(() => {
    graphRef.current?.setEqBands(eqValues);
  }, [eqValues]);

  useEffect(() => {
    graphRef.current?.setControls(controls);
  }, [controls]);

  // --- derived current file + metadata -------------------------------------
  const currentFile = useMemo(
    () => queueFiles.find((f) => f.id === activeId) ?? null,
    [queueFiles, activeId],
  );

  const folderCover = useMemo(() => findSiblingCover(allFiles), [allFiles]);

  const track = useMemo<EngineTrack>(() => {
    const parsed = currentFile ? parseTrackName(currentFile.name) : null;
    const durationMs =
      durationSec > 0 ? Math.round(durationSec * 1000) : routeTrack?.durationMs ?? 0;
    const year =
      currentFile?.modifiedTime
        ? String(new Date(currentFile.modifiedTime).getFullYear())
        : routeTrack?.year ?? "—";
    return {
      id: activeId,
      title: parsed?.title ?? routeTrack?.title ?? currentFile?.name ?? "Unknown track",
      artist: parsed?.artist ?? routeTrack?.artist ?? "Unknown artist",
      album: routeTrack?.album ?? currentFile?.name ?? "",
      cover: embeddedCoverUrl ?? folderCover?.thumbnailLink ?? "/Nyrima_Logo.png",
      format: currentFile ? mediaFormatLabel(currentFile) : routeTrack?.format ?? "—",
      source: isLocalId(activeId) ? "Local" : "Drive",
      year,
      genre: routeTrack?.genre ?? "—",
      durationMs,
      sampleRate: audioFormat?.sampleRate,
      bitDepth: audioFormat?.bitsPerSample,
      channels: audioFormat?.channels,
    };
  }, [currentFile, activeId, durationSec, embeddedCoverUrl, folderCover, routeTrack, audioFormat]);

  const queue = useMemo<QueueEntry[]>(() => {
    return queueFiles.map((file) => {
      const parsed = parseTrackName(file.name);
      const current = file.id === activeId;
      return {
        id: file.id,
        title: parsed.title,
        artist: parsed.artist ?? "Unknown artist",
        metaLabel: current ? "Playing" : mediaFormatLabel(file),
        current,
      };
    });
  }, [queueFiles, activeId]);

  useEffect(() => {
    if (!playing || status !== "ready" || queueFiles.length < 2) return;
    const index = queueFiles.findIndex((file) => file.id === activeId);
    const nextFile = index >= 0 ? queueFiles[index + 1] : null;
    if (!nextFile || isLocalId(nextFile.id)) return;

    const controller = new AbortController();
    void prefetchAudioObjectUrl(nextFile.id, {
      signal: controller.signal,
      priority: "low",
      kind: "media-stream",
    });
    return () => controller.abort();
  }, [activeId, playing, queueFiles, status]);

  // --- lyrics ---------------------------------------------------------------
  useEffect(() => {
    if (lyricsSource === "embedded") {
      if (!embeddedLyricsText) {
        setLyrics([]);
        setLyricsStatus("none");
        return;
      }
      const parsed = parseDisplayLyrics(embeddedLyricsText);
      setLyrics(parsed);
      setLyricsStatus(parsed.length > 0 ? "ready" : "none");
      return;
    }
    if (lyricsSource === "online") {
      // Online source is not wired yet — show its empty state.
      setLyrics([]);
      setLyricsStatus("none");
      return;
    }
    if (!currentFile) {
      setLyrics([]);
      setLyricsStatus("none");
      return;
    }
    const sibling = findSiblingLrc(allFiles, currentFile);
    if (!sibling) {
      setLyrics([]);
      setLyricsStatus("none");
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setLyricsStatus("loading");
    const textPromise = isLocalId(sibling.id)
      ? localLibrary.resolveFile(sibling.id).then((file) => file.text())
      : downloadTextFile(sibling.id, { signal: controller.signal });
    textPromise
      .then((text) => {
        if (cancelled) return;
        const parsed = parseDisplayLyrics(text);
        setLyrics(parsed);
        setLyricsStatus(parsed.length > 0 ? "ready" : "none");
      })
      .catch(() => {
        if (!cancelled) {
          setLyrics([]);
          setLyricsStatus("none");
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [currentFile, allFiles, embeddedLyricsText, lyricsSource]);

  // --- transport handlers ---------------------------------------------------
  const ensureGraph = useCallback(() => {
    // Called from user-gesture handlers so the AudioContext can start.
    void graphRef.current?.ensure().then((ok) => {
      if (ok) setEqActive(true);
    });
  }, []);

  // Build the graph once the element exists (deferred resume until gesture).
  useEffect(() => {
    if (!graphRef.current && audioRef.current) {
      const graph = new MusicAudioGraph(audioRef.current);
      graph.setEqBands(eqValues);
      graph.setControls(controls);
      graphRef.current = graph;
    }
  }, [controls, eqValues]);

  // Match the AudioContext's sample rate to a hi-res source on the *first*
  // build — see MusicAudioGraph.setPreferredSampleRate for why this can't
  // change a context that's already been built.
  useEffect(() => {
    graphRef.current?.setPreferredSampleRate(audioFormat?.sampleRate ?? null);
  }, [audioFormat]);

  // --- output device ---------------------------------------------------------
  const outputDeviceSupported = useMemo(() => isOutputDeviceApiSupported(), []);
  const outputDevicePickerSupported = useMemo(() => isOutputDevicePickerSupported(), []);

  useEffect(() => {
    if (!outputDeviceSupported) return;
    let cancelled = false;
    const refresh = () => {
      void listAudioOutputDevices().then((devices) => {
        if (!cancelled) setOutputDevices(devices);
      });
    };
    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener("devicechange", refresh);
    };
  }, [outputDeviceSupported]);

  const setOutputDevice = useCallback(
    async (deviceId: string, label?: string) => {
      const ok = await applyAudioOutputDevice(deviceId, [
        audioRef.current,
        graphRef.current?.audioContext,
      ]);
      if (ok) {
        setOutputDeviceId(deviceId);
        setOutputDeviceLabel(
          label ?? outputDevices.find((d) => d.deviceId === deviceId)?.label ?? "System default",
        );
      }
      return ok;
    },
    [outputDevices],
  );

  const pickOutputDevice = useCallback(async () => {
    const device = await pickAudioOutputDevice();
    if (!device) return false;
    return setOutputDevice(device.deviceId, device.label);
  }, [setOutputDevice]);

  // The EQ graph's AudioContext is created lazily on the first play (see
  // `ensureGraph`/`eqActive`), defaulting to the system output. Re-apply a
  // non-default device chosen beforehand once that context exists.
  useEffect(() => {
    if (!eqActive || outputDeviceId === "default") return;
    void applyAudioOutputDevice(outputDeviceId, [graphRef.current?.audioContext]);
  }, [eqActive, outputDeviceId]);

  useEffect(() => {
    if (!playing || typeof requestAnimationFrame !== "function") {
      setWaveBars(idleWaveBars(WAVE_BAR_COUNT));
      return;
    }

    let frame = 0;
    let lastPaint = 0;
    const tick = (timestamp: number) => {
      if (timestamp - lastPaint >= 48) {
        const next = graphRef.current?.readWaveformBars(WAVE_BAR_COUNT);
        setWaveBars(next && next.length > 0 ? next : activeFallbackWaveBars(timestamp));
        lastPaint = timestamp;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [activeId, eqActive, playing]);

  const playTrack = useCallback(
    (id: string) => {
      ensureGraph();
      if (id === activeIdRef.current) {
        // Same track already loaded — just (re)play it.
        if (shouldDeferPlaybackRequest(status)) {
          playStateRef.current.pendingPlay = true;
          return;
        }
        if (shouldStartPlaybackImmediately(status, hasPlayableAudioSource(audioRef.current))) {
          void playWithFadeIn();
        }
        return;
      }
      fadeOutThen(() => {
        playStateRef.current.pendingPlay = true;
        setActiveId(id);
      });
    },
    [ensureGraph, fadeOutThen, playWithFadeIn, status],
  );

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el || status === "error") return;
    ensureGraph();
    if (el.paused) {
      if (shouldDeferPlaybackRequest(status)) {
        playStateRef.current.pendingPlay = true;
        el.volume = targetVolumeRef.current;
        return;
      }
      if (shouldStartPlaybackImmediately(status, hasPlayableAudioSource(el))) {
        void playWithFadeIn();
      }
    } else {
      cancelFade();
      el.volume = targetVolumeRef.current;
      el.pause();
    }
  }, [cancelFade, ensureGraph, playWithFadeIn, status]);

  const next = useCallback((userInitiated = true) => {
    if (userInitiated) ensureGraph();
    const nextId = selectNextTrackId(activeIdRef.current, queueFiles, 1, shuffle);
    if (!nextId || nextId === activeIdRef.current) return;
    fadeOutThen(() => {
      playStateRef.current.pendingPlay = true;
      setActiveId(nextId);
    });
  }, [ensureGraph, fadeOutThen, queueFiles, shuffle]);

  const previous = useCallback(() => {
    const el = audioRef.current;
    // Mirror the usual player behaviour: restart if we're >3s in.
    if (el && el.currentTime > 3) {
      el.currentTime = 0;
      endingFadeTrackRef.current = null;
      cancelFade();
      el.volume = targetVolumeRef.current;
      return;
    }
    ensureGraph();
    const previousId = selectNextTrackId(activeIdRef.current, queueFiles, -1, false);
    if (!previousId || previousId === activeIdRef.current) return;
    fadeOutThen(() => {
      playStateRef.current.pendingPlay = true;
      setActiveId(previousId);
    });
  }, [cancelFade, ensureGraph, fadeOutThen, queueFiles]);

  navRef.current.next = () => next(false);

  const seekToFraction = useCallback(
    (fraction: number) => {
      const el = audioRef.current;
      if (!el || durationSec <= 0) return;
      endingFadeTrackRef.current = null;
      cancelFade();
      el.volume = targetVolumeRef.current;
      el.currentTime = Math.min(durationSec, Math.max(0, fraction * durationSec));
      setCurrentTimeSec(el.currentTime);
    },
    [cancelFade, durationSec],
  );

  const setVolume = useCallback((value: number) => {
    const clamped = Math.min(100, Math.max(0, value));
    setVolumeState(clamped);
  }, []);

  // --- MediaSession (OS media keys / lock-screen now-playing) ---------------
  // `seekbackward`/`seekforward`/`seekto` act on the audio element directly,
  // so they need the latest duration without re-registering on every
  // timeupdate — mirror it into a ref the same way `activeIdRef` does above.
  const durationRef = useRef(durationSec);
  useEffect(() => {
    durationRef.current = durationSec;
  }, [durationSec]);

  useEffect(() => {
    if (!isMediaSessionSupported()) return;
    return setMediaSessionActionHandlers({
      play: () => togglePlay(),
      pause: () => togglePlay(),
      previoustrack: queueFiles.length > 1 ? () => previous() : undefined,
      nexttrack: queueFiles.length > 1 ? () => next() : undefined,
      seekbackward: (details) => {
        const el = audioRef.current;
        if (!el) return;
        el.currentTime = Math.max(0, el.currentTime - (details.seekOffset ?? 10));
      },
      seekforward: (details) => {
        const el = audioRef.current;
        if (!el) return;
        const dur = durationRef.current || el.duration || Infinity;
        el.currentTime = Math.min(dur, el.currentTime + (details.seekOffset ?? 10));
      },
      seekto: (details) => {
        if (details.seekTime == null || durationRef.current <= 0) return;
        seekToFraction(details.seekTime / durationRef.current);
      },
    });
  }, [togglePlay, previous, next, seekToFraction, queueFiles.length]);

  useEffect(() => {
    if (!isMediaSessionSupported()) return;
    setMediaSessionMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: track.cover ? [{ src: track.cover }] : undefined,
    });
  }, [track.title, track.artist, track.album, track.cover]);

  useEffect(() => {
    setMediaSessionPlaybackState(playing ? "playing" : "paused");
  }, [playing]);

  useEffect(() => {
    if (!isMediaSessionSupported()) return;
    setMediaSessionPositionState(
      durationSec > 0
        ? {
            duration: durationSec,
            position: currentTimeSec,
            playbackRate: audioRef.current?.playbackRate ?? 1,
          }
        : null,
    );
  }, [durationSec, currentTimeSec]);

  // Engine instances are page-scoped (see file header) — clear the OS
  // now-playing state entirely when this one unmounts so a stale track
  // doesn't linger on the lock screen after navigating away.
  useEffect(() => {
    return () => {
      setMediaSessionMetadata(null);
      setMediaSessionPlaybackState("none");
      setMediaSessionPositionState(null);
    };
  }, []);

  // --- queue editing --------------------------------------------------------
  const reorderQueue = useCallback((from: number, to: number) => {
    setQueueFiles((current) => {
      if (
        from === to ||
        from < 0 ||
        to < 0 ||
        from >= current.length ||
        to >= current.length
      ) {
        return current;
      }
      const nextOrder = [...current];
      const [moved] = nextOrder.splice(from, 1);
      nextOrder.splice(to, 0, moved);
      return nextOrder;
    });
  }, []);

  const removeFromQueue = useCallback(
    (id: string) => {
      if (id === activeId) return; // don't yank the playing track
      setQueueFiles((current) => current.filter((f) => f.id !== id));
    },
    [activeId],
  );

  const playNextInQueue = useCallback((id: string) => {
    setQueueFiles((current) => {
      const index = current.findIndex((f) => f.id === id);
      if (index < 0) return current;
      const nextOrder = [...current];
      const [moved] = nextOrder.splice(index, 1);
      const currentIndex = nextOrder.findIndex((f) => f.id === activeIdRef.current);
      const insertAt = currentIndex >= 0 ? currentIndex + 1 : 0;
      nextOrder.splice(insertAt, 0, moved);
      return nextOrder;
    });
  }, []);

  // --- EQ handlers ----------------------------------------------------------
  const setPreset = useCallback((nextPreset: AudioPreset) => {
    setPresetState(nextPreset);
    setEqValues(getEqPresetValues(nextPreset));
  }, []);

  const setEqBand = useCallback((index: number, value: number) => {
    setEqValues((current) => current.map((item, i) => (i === index ? value : item)));
    setPresetState("Custom");
  }, []);

  const setControls = useCallback((nextControls: AudioControls) => {
    setControlsState(nextControls);
  }, []);

  const resetEq = useCallback(() => {
    setPresetState("Flat");
    setEqValues([...DEFAULT_EQ_VALUES]);
    setControlsState(DEFAULT_CONTROLS);
  }, []);

  const loadLrcText = useCallback((text: string) => {
    const parsed = parseDisplayLyrics(text);
    setLyrics(parsed);
    setLyricsStatus(parsed.length > 0 ? "ready" : "none");
    setLyricsSource("local");
  }, []);

  return {
    track,
    status,
    errorMessage,
    loadProgress,
    eqActive,
    waveBars,

    playing,
    currentTimeSec,
    durationSec,
    volume,
    shuffle,
    repeat,
    togglePlay,
    seekToFraction,
    next,
    previous,
    toggleShuffle: () => setShuffle((value) => !value),
    toggleRepeat: () => setRepeat((value) => !value),
    setVolume,

    queue,
    reorderQueue,
    removeFromQueue,
    playNextInQueue,
    playTrack,

    preset,
    eqValues,
    controls,
    setPreset,
    setEqBand,
    setControls,
    resetEq,

    lyrics,
    lyricsStatus,
    lyricsSource,
    setLyricsSource,
    loadLrcText,

    outputDevices,
    outputDeviceId,
    outputDeviceLabel,
    outputDeviceSupported,
    outputDevicePickerSupported,
    setOutputDevice,
    pickOutputDevice,
  };
}

function idleWaveBars(count: number): number[] {
  return Array.from({ length: count }, (_, index) => {
    const height = 0.18 + (((index * 19) % 58) / 100);
    return Math.min(0.82, height);
  });
}

function activeFallbackWaveBars(timestamp: number): number[] {
  const phase = timestamp / 180;
  return Array.from({ length: WAVE_BAR_COUNT }, (_, index) => {
    const wave = Math.sin(phase + index * 0.72) * 0.5 + 0.5;
    const ripple = Math.sin(phase * 0.58 + index * 1.37) * 0.5 + 0.5;
    return 0.16 + wave * 0.42 + ripple * 0.2;
  });
}

function orderQueueFiles(
  files: DriveFile[],
  currentFile: DriveFile,
  playlistIds: string[] | undefined,
): DriveFile[] {
  if (!playlistIds || playlistIds.length === 0) return files;
  const byId = new Map(files.map((file) => [file.id, file]));
  const ordered = playlistIds
    .map((id) => byId.get(id))
    .filter((file): file is DriveFile => !!file);

  if (!ordered.some((file) => file.id === currentFile.id)) {
    ordered.unshift(currentFile);
  }

  return ordered.length > 0 ? ordered : files;
}

function mergeDriveFiles(primary: DriveFile[], secondary: DriveFile[]): DriveFile[] {
  const seen = new Set<string>();
  const merged: DriveFile[] = [];
  for (const file of [...primary, ...secondary]) {
    if (!file?.id || seen.has(file.id)) continue;
    seen.add(file.id);
    merged.push(file);
  }
  return merged;
}

function selectNextTrackId(
  currentId: string,
  queueFiles: DriveFile[],
  direction: 1 | -1,
  shuffle: boolean,
): string | null {
  if (queueFiles.length === 0) return null;
  if (shuffle && direction === 1 && queueFiles.length > 1) {
    let idx = Math.floor(Math.random() * queueFiles.length);
    if (queueFiles[idx]?.id === currentId) idx = (idx + 1) % queueFiles.length;
    return queueFiles[idx]?.id ?? null;
  }

  const index = queueFiles.findIndex((file) => file.id === currentId);
  if (index < 0) return queueFiles[0]?.id ?? null;
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= queueFiles.length) return currentId;
  return queueFiles[nextIndex]?.id ?? null;
}

function hasPlayableAudioSource(el: HTMLAudioElement | null): boolean {
  return !!el && !!(el.currentSrc || el.src);
}

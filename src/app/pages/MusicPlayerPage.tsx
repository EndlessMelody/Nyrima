import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import cn from "classnames";
import {
  ArrowLeft,
  AudioLines,
  Check,
  ChevronDown,
  Disc3,
  FileAudio,
  GripVertical,
  Heart,
  ListMusic,
  ListPlus,
  Loader2,
  Mic2,
  MonitorSpeaker,
  Moon,
  MoreHorizontal,
  Music2,
  Palette,
  Pause,
  Play,
  Repeat2,
  RotateCcw,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Star,
  Upload,
  Volume2,
  Wand2,
  Wifi,
  X,
  type LucideIcon,
} from "lucide-react";
import { NyrimaMark } from "../components/NyrimaMark";
import {
  EQ_FREQUENCIES,
  MUSIC_PLAYER_ROUTE_PREFIX,
  formatPlaybackClock,
  resolveMusicPlayerBackTarget,
  type AudioPreset,
  type MusicPlayerBackState,
} from "../services/music-player";
import {
  useMusicEngine,
  type EngineStatus,
  type LyricsSource,
  type QueueEntry,
} from "../hooks/useMusicEngine";
import type { AudioOutputDevice } from "../services/audio-output";
import { type LrcLine } from "../services/lrc";
import type { DriveFile } from "@shared/types";
import "./MusicPlayerPage.scss";

interface RouteTrack {
  id: string;
  title: string;
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

interface MusicPlayerRouteState extends MusicPlayerBackState {
  track?: Partial<RouteTrack>;
}

interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  cover: string;
  durationMs: number;
  format: string;
  source: "Drive" | "Local";
  year: string;
  genre: string;
  sampleRate?: number;
  bitDepth?: number;
  channels?: number;
}

interface AudioControlsState {
  bass: number;
  treble: number;
  voiceClarity: number;
  surround: boolean;
  stabilizer: boolean;
  reverb: number;
  soundStage: number;
}

interface OutputDeviceProps {
  devices: AudioOutputDevice[];
  activeId: string;
  activeLabel: string;
  supported: boolean;
  pickerSupported: boolean;
  onSelect: (deviceId: string, label?: string) => void;
  onPick: () => void;
}

const AUDIO_PRESETS: AudioPreset[] = [
  "Music",
  "Vocal",
  "Anime OST",
  "Night",
  "Flat",
  "Custom",
];

const HEADER_TABS = ["Songs", "Albums", "Artists", "Playlists", "Favorites"];

export function MusicPlayerPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const routeState = coerceRouteState(location.state);
  const routeFileId = params.trackId ? decodeURIComponent(params.trackId) : "";

  const engine = useMusicEngine(routeFileId, routeState.track);

  const [activeTab, setActiveTab] = useState("Songs");
  const [query, setQuery] = useState("");
  const [favorite, setFavorite] = useState(false);

  const backTarget = resolveMusicPlayerBackTarget(routeState);
  const progress =
    engine.durationSec > 0 ? (engine.currentTimeSec / engine.durationSec) * 100 : 0;
  const totalTime =
    engine.durationSec > 0
      ? formatPlaybackClock(engine.durationSec)
      : formatDuration(engine.track.durationMs);

  const handleBack = () => {
    if (!hasExplicitBackState(routeState) && location.key !== "default" && window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate(backTarget);
  };

  return (
      <div className="music-player-page">
      <div className="music-player-page__ambient" aria-hidden="true" />
      <MusicPlayerHeader
        activeTab={activeTab}
        query={query}
        onBack={handleBack}
        onTabChange={setActiveTab}
        onQueryChange={setQuery}
      />

      <main className="music-player-page__main">
        <NowPlayingHero
          track={engine.track}
          status={engine.status}
          errorMessage={engine.errorMessage}
          loadProgress={engine.loadProgress}
          eqActive={engine.eqActive}
          waveBars={engine.waveBars}
          favorite={favorite}
          playing={engine.playing}
          progress={progress}
          currentTime={formatPlaybackClock(engine.currentTimeSec)}
          totalTime={totalTime}
          volume={engine.volume}
          shuffle={engine.shuffle}
          repeat={engine.repeat}
          outputDevice={{
            devices: engine.outputDevices,
            activeId: engine.outputDeviceId,
            activeLabel: engine.outputDeviceLabel,
            supported: engine.outputDeviceSupported,
            pickerSupported: engine.outputDevicePickerSupported,
            onSelect: engine.setOutputDevice,
            onPick: engine.pickOutputDevice,
          }}
          onFavorite={() => setFavorite((value) => !value)}
          onProgressChange={(value) => engine.seekToFraction(value / 100)}
          onPlayPause={engine.togglePlay}
          onPrev={engine.previous}
          onNext={engine.next}
          onShuffle={engine.toggleShuffle}
          onRepeat={engine.toggleRepeat}
          onVolumeChange={engine.setVolume}
        />

        <div className="console-cell console-cell--queue">
          <UpNextQueue
            queue={engine.queue}
            onReorder={engine.reorderQueue}
            onRemove={engine.removeFromQueue}
            onPlayNext={engine.playNextInQueue}
            onPlay={engine.playTrack}
          />
        </div>

        <SoundTuningPanel
          preset={engine.preset}
          eqValues={engine.eqValues}
          controls={engine.controls}
          onPresetChange={engine.setPreset}
          onEqChange={engine.setEqBand}
          onControlsChange={engine.setControls}
          onReset={engine.resetEq}
        />

        <div className="console-cell console-cell--lyrics">
          <LyricsPanel
            lines={engine.lyrics}
            status={engine.lyricsStatus}
            source={engine.lyricsSource}
            onSourceChange={engine.setLyricsSource}
            onLoadLrc={engine.loadLrcText}
          />
        </div>
      </main>
      </div>
  );
}

function MusicPlayerHeader({
  activeTab,
  query,
  onBack,
  onTabChange,
  onQueryChange,
}: {
  activeTab: string;
  query: string;
  onBack: () => void;
  onTabChange: (tab: string) => void;
  onQueryChange: (query: string) => void;
}) {
  return (
    <header className="music-player-header">
      <div className="music-player-header__left">
        <button
          type="button"
          className="music-back-button ny-focusable"
          onClick={onBack}
          aria-label="Back to previous section"
          title="Back to previous section"
        >
          <ArrowLeft aria-hidden="true" />
          <span>Back</span>
        </button>
        <div className="music-player-header__brand">
          <NyrimaMark size="header" />
          <span>Nyrima</span>
        </div>
        <div className="music-player-header__title">
          <span>Music Player</span>
          <small>Hi-res listening room</small>
        </div>
      </div>

      <nav className="music-player-header__tabs" aria-label="Music sections">
        {HEADER_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={cn("ny-focusable", { "is-active": activeTab === tab })}
            onClick={() => onTabChange(tab)}
            aria-pressed={activeTab === tab}
          >
            {tab}
          </button>
        ))}
      </nav>

      <div className="music-player-header__right">
        <label className="music-player-search">
          <Search aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search songs, artists, albums"
            autoComplete="off"
          />
        </label>
        <IconButton icon={SlidersHorizontal} label="Audio tuning" />
        <IconButton icon={ListMusic} label="Queue" />
        <IconButton icon={Palette} label="Theme" />
      </div>
    </header>
  );
}

function NowPlayingHero({
  track,
  status,
  errorMessage,
  loadProgress,
  eqActive,
  waveBars,
  favorite,
  playing,
  progress,
  currentTime,
  totalTime,
  volume,
  shuffle,
  repeat,
  outputDevice,
  onFavorite,
  onProgressChange,
  onPlayPause,
  onPrev,
  onNext,
  onShuffle,
  onRepeat,
  onVolumeChange,
}: {
  track: MusicTrack;
  status: EngineStatus;
  errorMessage: string | null;
  loadProgress: number;
  eqActive: boolean;
  waveBars: number[];
  favorite: boolean;
  playing: boolean;
  progress: number;
  currentTime: string;
  totalTime: string;
  volume: number;
  shuffle: boolean;
  repeat: boolean;
  outputDevice: OutputDeviceProps;
  onFavorite: () => void;
  onProgressChange: (value: number) => void;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onShuffle: () => void;
  onRepeat: () => void;
  onVolumeChange: (value: number) => void;
}) {
  return (
    <section className="now-playing-card" aria-label="Now playing">
      <div className="now-playing-card__grid">
        <TrackArtwork track={track} playing={playing} />
        <TrackInfoPanel
          track={track}
          status={status}
          errorMessage={errorMessage}
          loadProgress={loadProgress}
          eqActive={eqActive}
          waveBars={waveBars}
          favorite={favorite}
          playing={playing}
          onFavorite={onFavorite}
        />
      </div>

      <PlaybackTimeline
        value={progress}
        currentTime={currentTime}
        totalTime={totalTime}
        disabled={status !== "ready"}
        onChange={onProgressChange}
      />

      <PlaybackControls
        playing={playing}
        loading={status === "loading"}
        shuffle={shuffle}
        repeat={repeat}
        volume={volume}
        outputDevice={outputDevice}
        onPlayPause={onPlayPause}
        onPrev={onPrev}
        onNext={onNext}
        onShuffle={onShuffle}
        onRepeat={onRepeat}
        onVolumeChange={onVolumeChange}
      />
    </section>
  );
}

function TrackArtwork({ track, playing }: { track: MusicTrack; playing: boolean }) {
  const fallbackCover = "/Nyrima_Logo.png";
  return (
    <div className="track-artwork">
      <div className="track-artwork__frame">
        <img
          src={track.cover || fallbackCover}
          alt={`${track.title} artwork`}
          referrerPolicy="no-referrer"
          onError={(event) => {
            if (!event.currentTarget.src.endsWith(fallbackCover)) {
              event.currentTarget.src = fallbackCover;
            }
          }}
        />
        <span className="track-artwork__shine" aria-hidden="true" />
        <span className={cn("track-artwork__disc", { "is-playing": playing })} aria-hidden="true">
          <Disc3 />
        </span>
      </div>
      <div className="track-artwork__caption">
        <span>Nyrima HQ</span>
        <span>{track.source} source</span>
      </div>
    </div>
  );
}

function TrackInfoPanel({
  track,
  status,
  errorMessage,
  loadProgress,
  eqActive,
  waveBars,
  favorite,
  playing,
  onFavorite,
}: {
  track: MusicTrack;
  status: EngineStatus;
  errorMessage: string | null;
  loadProgress: number;
  eqActive: boolean;
  waveBars: number[];
  favorite: boolean;
  playing: boolean;
  onFavorite: () => void;
}) {
  const eyebrow =
    status === "loading"
      ? `Buffering ${Math.round(loadProgress * 100)}%`
      : status === "error"
        ? "Playback error"
        : "Now Playing";
  const resolutionBadge = formatResolutionBadge(track);
  return (
    <div className="track-info-panel">
      <div className="track-info-panel__top">
        <span className={cn("music-eyebrow", { "is-error": status === "error" })}>
          {status === "loading" ? (
            <Loader2 className="music-eyebrow__spin" aria-hidden="true" />
          ) : (
            <AudioLines aria-hidden="true" />
          )}
          {eyebrow}
        </span>
        <div className="track-info-panel__actions">
          <button
            type="button"
            className={cn("music-icon-button ny-focusable", { "is-active": favorite })}
            onClick={onFavorite}
            aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
          >
            <Heart aria-hidden="true" />
          </button>
          <IconButton icon={MoreHorizontal} label="More options" />
        </div>
      </div>

      <div className="track-info-panel__copy">
        <h2>{track.title}</h2>
        <p>{track.artist}</p>
        <span>{track.album}</span>
      </div>

      {status === "error" && errorMessage && (
        <p className="track-info-panel__error" role="alert">
          {errorMessage}
        </p>
      )}

      <div className="track-info-panel__badges" aria-label="Track source badges">
        <span>{track.format}</span>
        {resolutionBadge && <span>{resolutionBadge}</span>}
        <span>{track.source}</span>
        {eqActive && <span className="is-live">EQ Live</span>}
        <span>Nyrima HQ</span>
      </div>

      <dl className="track-info-panel__meta">
        <div>
          <dt>Duration</dt>
          <dd>{formatDuration(track.durationMs)}</dd>
        </div>
        <div>
          <dt>Year</dt>
          <dd>{track.year}</dd>
        </div>
        <div>
          <dt>Genre</dt>
          <dd>{track.genre}</dd>
        </div>
      </dl>

      <div
        className={cn("music-waveform", {
          "is-playing": playing,
          "is-live": eqActive,
        })}
        aria-label="Audio visualizer"
      >
        {waveBars.map((bar, index) => (
          <span
            key={index}
            style={{
              ["--bar" as string]: `${Math.round(Math.max(0.1, Math.min(1, bar)) * 100)}%`,
              ["--delay" as string]: `${index * 28}ms`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function PlaybackTimeline({
  value,
  currentTime,
  totalTime,
  disabled,
  onChange,
}: {
  value: number;
  currentTime: string;
  totalTime: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="playback-timeline">
      <time className="playback-timeline__time" aria-label="Elapsed time">
        {currentTime}
      </time>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ ["--progress" as string]: `${value}%` }}
        aria-label="Seek through current track"
      />
      <time className="playback-timeline__time playback-timeline__time--total" aria-label="Total time">
        {totalTime}
      </time>
    </div>
  );
}

function PlaybackControls({
  playing,
  loading,
  shuffle,
  repeat,
  volume,
  outputDevice,
  onPlayPause,
  onPrev,
  onNext,
  onShuffle,
  onRepeat,
  onVolumeChange,
}: {
  playing: boolean;
  loading: boolean;
  shuffle: boolean;
  repeat: boolean;
  volume: number;
  outputDevice: OutputDeviceProps;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onShuffle: () => void;
  onRepeat: () => void;
  onVolumeChange: (value: number) => void;
}) {
  return (
    <div className="playback-controls">
      <div className="playback-controls__center" aria-label="Playback controls">
        <button
          type="button"
          className={cn("music-icon-button ny-focusable", { "is-active": shuffle })}
          onClick={onShuffle}
          aria-label="Shuffle"
          aria-pressed={shuffle}
        >
          <Shuffle aria-hidden="true" />
        </button>
        <IconButton icon={SkipBack} label="Previous track" onClick={onPrev} />
        <button
          type="button"
          className="playback-controls__play ny-focusable"
          onClick={onPlayPause}
          aria-label={playing ? "Pause" : "Play"}
        >
          {loading ? (
            <Loader2 className="music-eyebrow__spin" aria-hidden="true" />
          ) : playing ? (
            <Pause aria-hidden="true" />
          ) : (
            <Play aria-hidden="true" />
          )}
        </button>
        <IconButton icon={SkipForward} label="Next track" onClick={onNext} />
        <button
          type="button"
          className={cn("music-icon-button ny-focusable", { "is-active": repeat })}
          onClick={onRepeat}
          aria-label="Repeat"
          aria-pressed={repeat}
        >
          <Repeat2 aria-hidden="true" />
        </button>
      </div>

      <div className="playback-controls__right">
        <OutputDeviceSelect {...outputDevice} />
        <label className="music-volume-control">
          <Volume2 aria-hidden="true" />
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(event) => onVolumeChange(Number(event.target.value))}
            style={{ ["--progress" as string]: `${volume}%` }}
            aria-label="Volume"
          />
        </label>
      </div>
    </div>
  );
}

function OutputDeviceSelect({
  devices,
  activeId,
  activeLabel,
  supported,
  pickerSupported,
  onSelect,
  onPick,
}: OutputDeviceProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!supported) return null;

  const items: AudioOutputDevice[] = devices.some((item) => item.deviceId === "default")
    ? devices
    : [{ deviceId: "default", label: "System default" }, ...devices];

  return (
    <div className="music-device-select" ref={rootRef}>
      <button
        type="button"
        className="music-device-select__trigger ny-focusable"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <MonitorSpeaker aria-hidden="true" />
        <span>{activeLabel}</span>
        <ChevronDown aria-hidden="true" className={cn("music-device-select__chevron", { "is-open": open })} />
      </button>
      {open && (
        <ul className="music-device-select__menu" role="listbox" aria-label="Output device">
          {items.map((item) => (
            <li key={item.deviceId} role="option" aria-selected={item.deviceId === activeId}>
              <button
                type="button"
                className={cn("ny-focusable", { "is-active": item.deviceId === activeId })}
                onClick={() => {
                  onSelect(item.deviceId, item.label);
                  setOpen(false);
                }}
              >
                {item.label}
                {item.deviceId === activeId && <Check aria-hidden="true" />}
              </button>
            </li>
          ))}
          {pickerSupported && (
            <li role="presentation">
              <button
                type="button"
                className="ny-focusable music-device-select__picker"
                onClick={() => {
                  onPick();
                  setOpen(false);
                }}
              >
                Choose other device…
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function SoundTuningPanel({
  preset,
  eqValues,
  controls,
  onPresetChange,
  onEqChange,
  onControlsChange,
  onReset,
}: {
  preset: AudioPreset;
  eqValues: number[];
  controls: AudioControlsState;
  onPresetChange: (preset: AudioPreset) => void;
  onEqChange: (index: number, value: number) => void;
  onControlsChange: (controls: AudioControlsState) => void;
  onReset: () => void;
}) {
  return (
    <section className="music-panel sound-tuning-panel" aria-label="Sound tuning">
      <PanelHeader
        icon={SlidersHorizontal}
        kicker="Sound tuning"
        title="Easy audio shaping"
        action={
          <button type="button" className="music-panel__reset ny-focusable" onClick={onReset}>
            <RotateCcw aria-hidden="true" />
            Reset
          </button>
        }
      />

      <div className="audio-preset-list" role="group" aria-label="Audio presets">
        {AUDIO_PRESETS.map((item) => (
          <button
            key={item}
            type="button"
            className={cn("ny-focusable", { "is-active": preset === item })}
            onClick={() => onPresetChange(item)}
            aria-pressed={preset === item}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="sound-tuning-panel__grid">
        <EqualizerControl
          preset={preset}
          values={eqValues}
          onPresetChange={onPresetChange}
          onValueChange={onEqChange}
          onReset={onReset}
        />

        <div className="audio-control-grid">
          <TuningSlider
            icon={Disc3}
            label="Bass"
            value={controls.bass}
            onChange={(bass) => onControlsChange({ ...controls, bass })}
          />
          <TuningSlider
            icon={Sparkles}
            label="Treble"
            value={controls.treble}
            onChange={(treble) => onControlsChange({ ...controls, treble })}
          />
          <TuningSlider
            icon={Mic2}
            label="Voice Clarity"
            value={controls.voiceClarity}
            onChange={(voiceClarity) => onControlsChange({ ...controls, voiceClarity })}
          />
          <TuningToggle
            icon={AudioLines}
            label="Surround"
            checked={controls.surround}
            onChange={(surround) => onControlsChange({ ...controls, surround })}
          />
          <TuningToggle
            icon={Moon}
            label="Volume Stabilizer"
            checked={controls.stabilizer}
            onChange={(stabilizer) => onControlsChange({ ...controls, stabilizer })}
          />
          <TuningSlider
            icon={Wand2}
            label="Reverb"
            value={controls.reverb}
            onChange={(reverb) => onControlsChange({ ...controls, reverb })}
          />
          <TuningSlider
            icon={Wifi}
            label="Sound Stage"
            value={controls.soundStage}
            onChange={(soundStage) => onControlsChange({ ...controls, soundStage })}
          />
        </div>
      </div>
    </section>
  );
}

function EqualizerControl({
  preset,
  values,
  onPresetChange,
  onValueChange,
  onReset,
}: {
  preset: AudioPreset;
  values: number[];
  onPresetChange: (preset: AudioPreset) => void;
  onValueChange: (index: number, value: number) => void;
  onReset: () => void;
}) {
  return (
    <div className="equalizer-control">
      <div className="equalizer-control__head">
        <div>
          <h3>10-band EQ</h3>
          <span>Gentle curve control</span>
        </div>
        <label>
          <select
            value={preset}
            onChange={(event) => onPresetChange(event.target.value as AudioPreset)}
            aria-label="Equalizer preset"
          >
            {AUDIO_PRESETS.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <button type="button" className="ny-focusable" onClick={onReset}>
          Reset
        </button>
      </div>

      <div className="equalizer-control__sliders">
        {EQ_FREQUENCIES.map((frequency, index) => {
          const value = values[index] ?? 0;
          return (
            <label key={frequency} className="eq-band">
              <span className="eq-band__value">{value > 0 ? `+${value}` : value}</span>
              <input
                type="range"
                min={-6}
                max={6}
                step={1}
                value={value}
                onChange={(event) => onValueChange(index, Number(event.target.value))}
                style={{ ["--eq" as string]: `${((value + 6) / 12) * 100}%` }}
                aria-label={`${frequency} hertz equalizer band`}
              />
              <span className="eq-band__label">{frequency}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function LyricsPanel({
  lines,
  status,
  source,
  onSourceChange,
  onLoadLrc,
}: {
  lines: LrcLine[];
  status: "none" | "loading" | "ready";
  source: LyricsSource;
  onSourceChange: (source: LyricsSource) => void;
  onLoadLrc: (text: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasLyrics = lines.length > 0;

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void file.text().then((text) => onLoadLrc(text)).catch(() => {});
    event.target.value = "";
  };

  return (
    <section className="music-panel lyrics-panel" aria-label="Lyrics">
      <PanelHeader icon={FileAudio} kicker="Lyrics" title="Lyrics" />
      <div className="lyrics-panel__sources" role="group" aria-label="Lyrics source">
        {(["embedded", "local", "online"] as LyricsSource[]).map((item) => (
          <button
            key={item}
            type="button"
            className={cn("ny-focusable", { "is-active": source === item })}
            onClick={() => onSourceChange(item)}
            aria-pressed={source === item}
          >
            {sourceLabel(item)}
          </button>
        ))}
      </div>

      <div className="lyrics-panel__body">
        {status === "loading" ? (
          <div className="lyrics-empty-state">
            <div className="lyrics-empty-state__icon" aria-hidden="true">
              <Loader2 className="music-eyebrow__spin" />
            </div>
            <h3>Loading lyrics…</h3>
          </div>
        ) : hasLyrics ? (
          <div className="lyrics-panel__lines">
            {lines.map((line, index) => (
              <p key={`${line.text}-${index}`}>
                {line.text || "♪"}
              </p>
            ))}
          </div>
        ) : (
          <div className="lyrics-empty-state">
            <div className="lyrics-empty-state__icon" aria-hidden="true">
              <Music2 />
            </div>
            <h3>
              {source === "embedded"
                ? "No embedded lyrics found in this track."
                : source === "local"
                  ? "No .lrc lyrics found for this track."
                  : `${sourceLabel(source)} lyrics aren't wired up yet.`}
            </h3>
            <p>
              {source === "embedded" ? (
                <>
                  FLAC <code>LYRICS</code> or <code>SYNCEDLYRICS</code> tags will
                  appear here as readable text when present. Switch to Local .lrc to load a sidecar file.
                </>
              ) : (
                <>
                  Drop a matching <code>.lrc</code> file next to the track in Drive, or
                  load one here. Timing tags are stripped so only the lyric text is shown.
                </>
              )}
            </p>
            <div className="lyrics-empty-state__actions">
              <button
                type="button"
                className="ny-focusable"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload aria-hidden="true" />
                Load .lrc
              </button>
            </div>
            <input
              ref={fileInputRef}
              className="lyrics-empty-state__file"
              type="file"
              accept=".lrc,text/plain"
              onChange={handleFile}
              tabIndex={-1}
              aria-hidden="true"
            />
          </div>
        )}
      </div>
    </section>
  );
}

function UpNextQueue({
  queue,
  onReorder,
  onRemove,
  onPlayNext,
  onPlay,
}: {
  queue: QueueEntry[];
  onReorder: (from: number, to: number) => void;
  onRemove: (id: string) => void;
  onPlayNext: (id: string) => void;
  onPlay: (id: string) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const handleDragOver = (index: number) => (event: DragEvent<HTMLLIElement>) => {
    event.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    onReorder(dragIndex, index);
    setDragIndex(index);
  };

  return (
    <aside className="music-panel up-next-queue" aria-label="Up Next queue">
      <PanelHeader
        icon={ListMusic}
        kicker="Queue"
        title="Up Next"
        action={
          <button type="button" className="music-panel__reset ny-focusable">
            Clear queue
          </button>
        }
      />
      <ul className="up-next-queue__list">
        {queue.map((item, index) => (
          <li
            key={item.id}
            className={cn("queue-track", {
              "is-current": item.current,
              "is-dragging": dragIndex === index,
            })}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={handleDragOver(index)}
            onDragEnd={() => setDragIndex(null)}
            onDrop={() => setDragIndex(null)}
          >
            <span className="queue-track__grip" aria-hidden="true">
              <GripVertical />
            </span>
            <button
              type="button"
              className="queue-track__main ny-focusable"
              onClick={() => onPlay(item.id)}
            >
              <span className="queue-track__thumb" aria-hidden="true">
                {item.current ? <AudioLines /> : <Music2 />}
              </span>
              <span className="queue-track__body">
                <span>{item.title}</span>
                <small>{item.artist}</small>
              </span>
            </button>
            <span className="queue-track__trailing">
              <span className="queue-track__meta">
                {item.current ? (
                  <span className="queue-track__now">Playing</span>
                ) : (
                  <span className="queue-track__duration">{item.metaLabel}</span>
                )}
              </span>
              <span className="queue-track__actions">
                {!item.current && (
                  <button
                    type="button"
                    className="queue-track__action ny-focusable"
                    onClick={() => onPlayNext(item.id)}
                    aria-label={`Play "${item.title}" next`}
                    title="Play next"
                  >
                    <ListPlus aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  className="queue-track__action ny-focusable"
                  onClick={() => onRemove(item.id)}
                  aria-label={`Remove "${item.title}" from queue`}
                  title="Remove from queue"
                >
                  <X aria-hidden="true" />
                </button>
              </span>
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function PanelHeader({
  icon: Icon,
  kicker,
  title,
  action,
}: {
  icon: LucideIcon;
  kicker: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <header className="music-panel__header">
      <span className="music-panel__icon" aria-hidden="true">
        <Icon />
      </span>
      <div>
        <span>{kicker}</span>
        <h2>{title}</h2>
      </div>
      {action}
    </header>
  );
}

function TuningSlider({
  icon: Icon,
  label,
  value,
  onChange,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="tuning-control">
      <span className="tuning-control__head">
        <Icon aria-hidden="true" />
        <span>{label}</span>
        <output>{value}</output>
      </span>
      <input
        type="range"
        min={0}
        max={10}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ ["--progress" as string]: `${value * 10}%` }}
      />
    </label>
  );
}

function TuningToggle({
  icon: Icon,
  label,
  checked,
  onChange,
}: {
  icon: LucideIcon;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="tuning-toggle">
      <span className="tuning-toggle__body">
        <Icon aria-hidden="true" />
        <span>{label}</span>
        <small>{checked ? "On" : "Off"}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="tuning-toggle__switch" aria-hidden="true" />
    </label>
  );
}

function IconButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="music-icon-button ny-focusable"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon aria-hidden="true" />
    </button>
  );
}

function coerceRouteState(value: unknown): MusicPlayerRouteState {
  if (!value || typeof value !== "object") return {};
  return value as MusicPlayerRouteState;
}

function hasExplicitBackState(state: MusicPlayerRouteState): boolean {
  return [state.sourceRoute, state.from, state.previousSection].some((value) => {
    if (typeof value !== "string") return false;
    if (!value.startsWith("/") || value.startsWith("//")) return false;
    return !value.startsWith(MUSIC_PLAYER_ROUTE_PREFIX);
  });
}

function sourceLabel(source: LyricsSource): string {
  if (source === "local") return "Local .lrc";
  if (source === "online") return "Online";
  return "Embedded";
}

function formatDuration(ms: number | undefined): string {
  if (!ms || ms <= 0) return "0:00";
  return formatPlaybackClock(Math.round(ms / 1000));
}

/** "24-bit/96kHz" style badge from a parsed FLAC/WAV format, or `null` for lossy sources. */
function formatResolutionBadge(track: MusicTrack): string | null {
  const { sampleRate, bitDepth } = track;
  if (!sampleRate && !bitDepth) return null;
  const khz = sampleRate
    ? `${sampleRate % 1000 === 0 ? sampleRate / 1000 : (sampleRate / 1000).toFixed(1)}kHz`
    : null;
  const bits = bitDepth ? `${bitDepth}-bit` : null;
  return [bits, khz].filter(Boolean).join("/");
}

/**
 * SubtitlesAudioPanel — the deep "Tracks & timing" panel below the player and
 * the single home for track selection in the below-section. Tabs cover
 * subtitle tracks (embedded + external), audio tracks, typography (reusing the
 * real SubtitleConfigPanel), timing offsets, and scene-bookmark notes.
 *
 * Honest unavailable states:
 *   - Audio delay: HTML <video> can't offset audio independently → disabled.
 *   - Chapters: no chapter extraction exists → surfaced as the disabled Skip
 *     OP/ED controls in the playback strip rather than a dedicated tab here.
 */

import { useState } from "react";
import cn from "classnames";
import { Captions, Clock, Bookmark, Trash2 } from "lucide-react";
import type { SubtitleTrack } from "../DrivePlayer";
import type { MkvAudioTrack } from "../../services/mkv-subtitles";
import { SubtitleConfigPanel } from "../SubtitleConfigPanel";
import { formatTimecode } from "../../services/formatters";
import type { SceneBookmark } from "../../services/scene-bookmarks";

type Tab = "subtitles" | "audio" | "style" | "notes";

const TABS: [Tab, string][] = [
  ["subtitles", "Subtitles"],
  ["audio", "Audio"],
  ["style", "Style"],
  ["notes", "Notes"],
];

interface Props {
  subtitleTracks: SubtitleTrack[];
  activeSubId: string | null;
  onPickSubtitle: (id: string | null) => void;
  audioTracks: MkvAudioTrack[];
  selectedAudioNumber: number | null;
  onPickAudio: (trackNumber: number) => void;
  bookmarks: SceneBookmark[];
  onJumpBookmark: (timeSec: number) => void;
  onRemoveBookmark: (id: string) => void;
}

export function SubtitlesAudioPanel({
  subtitleTracks,
  activeSubId,
  onPickSubtitle,
  audioTracks,
  selectedAudioNumber,
  onPickAudio,
  bookmarks,
  onJumpBookmark,
  onRemoveBookmark,
}: Props) {
  const [tab, setTab] = useState<Tab>("subtitles");

  const embedded = subtitleTracks.filter((t) => t.source !== "external");
  const external = subtitleTracks.filter((t) => t.source === "external");

  return (
    <section className="watch-panel subs-panel" aria-label="Subtitles and audio">
      <header className="watch-panel__header">
        <span className="watch-panel__icon" aria-hidden="true">
          <Captions />
        </span>
        <div>
          <span>Tracks &amp; timing</span>
          <h2>Subtitles &amp; Audio</h2>
        </div>
      </header>

      <div className="watch-tabs" role="tablist" aria-label="Track sections">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={cn("ny-focusable", { "is-active": tab === id })}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="watch-panel__body" role="tabpanel">
        {tab === "subtitles" && (
          <SubtitleTab
            embedded={embedded}
            external={external}
            activeSubId={activeSubId}
            onPickSubtitle={onPickSubtitle}
          />
        )}

        {tab === "audio" && (
          <AudioTab
            audioTracks={audioTracks}
            selectedAudioNumber={selectedAudioNumber}
            onPickAudio={onPickAudio}
          />
        )}

        {tab === "style" && (
          <div className="subs-panel__style">
            <SubtitleConfigPanel />
          </div>
        )}

        {tab === "notes" && (
          <NotesTab
            bookmarks={bookmarks}
            onJumpBookmark={onJumpBookmark}
            onRemoveBookmark={onRemoveBookmark}
          />
        )}
      </div>
    </section>
  );
}

function SubtitleTab({
  embedded,
  external,
  activeSubId,
  onPickSubtitle,
}: {
  embedded: SubtitleTrack[];
  external: SubtitleTrack[];
  activeSubId: string | null;
  onPickSubtitle: (id: string | null) => void;
}) {
  const total = embedded.length + external.length;
  return (
    <div className="subs-list">
      <button
        type="button"
        className={cn("subs-list__item ny-focusable", {
          "is-active": activeSubId === null,
        })}
        onClick={() => onPickSubtitle(null)}
      >
        <span className="subs-list__name">Off</span>
        <span className="subs-list__badge">—</span>
      </button>

      {total === 0 && (
        <div className="watch-empty watch-empty--inline">
          No subtitle tracks for this video.
        </div>
      )}

      {embedded.length > 0 && (
        <>
          <div className="subs-list__group">Embedded</div>
          {embedded.map((track) => (
            <SubtitleRow
              key={track.id}
              track={track}
              active={activeSubId === track.id}
              onPick={onPickSubtitle}
            />
          ))}
        </>
      )}

      {external.length > 0 && (
        <>
          <div className="subs-list__group">External</div>
          {external.map((track) => (
            <SubtitleRow
              key={track.id}
              track={track}
              active={activeSubId === track.id}
              onPick={onPickSubtitle}
            />
          ))}
        </>
      )}
    </div>
  );
}

function SubtitleRow({
  track,
  active,
  onPick,
}: {
  track: SubtitleTrack;
  active: boolean;
  onPick: (id: string | null) => void;
}) {
  return (
    <button
      type="button"
      className={cn("subs-list__item ny-focusable", {
        "is-active": active,
        "is-disabled": track.imageBased,
      })}
      disabled={track.imageBased}
      title={
        track.imageBased
          ? `${track.label} — image-based subtitles can't be styled as text`
          : track.label
      }
      onClick={() => {
        if (!track.imageBased) onPick(track.id);
      }}
    >
      <span className="subs-list__name">{track.label}</span>
      <span className="subs-list__tags">
        {track.lang && (
          <span className="subs-list__lang">{track.lang.toUpperCase()}</span>
        )}
        <span className="subs-list__badge">{badgeFor(track)}</span>
      </span>
    </button>
  );
}

function AudioTab({
  audioTracks,
  selectedAudioNumber,
  onPickAudio,
}: {
  audioTracks: MkvAudioTrack[];
  selectedAudioNumber: number | null;
  onPickAudio: (trackNumber: number) => void;
}) {
  if (audioTracks.length === 0) {
    return (
      <div className="watch-empty watch-empty--inline">
        No selectable audio tracks — the browser plays this file’s default audio.
      </div>
    );
  }
  return (
    <div className="subs-list">
      {audioTracks.map((track) => {
        const selected = track.number === selectedAudioNumber;
        const disabled = !track.remuxable && !selected;
        return (
          <button
            type="button"
            key={track.number}
            className={cn("subs-list__item ny-focusable", {
              "is-active": selected,
              "is-disabled": disabled,
            })}
            disabled={disabled}
            title={
              disabled
                ? `${track.label} — codec ${track.codecId} can't be switched into in-browser`
                : track.label
            }
            onClick={() => {
              if (!disabled) onPickAudio(track.number);
            }}
          >
            <span className="subs-list__name">{track.label}</span>
            <span className="subs-list__tags">
              {track.language && (
                <span className="subs-list__lang">
                  {track.language.toUpperCase()}
                </span>
              )}
              {track.channels != null && (
                <span className="subs-list__lang">{track.channels}ch</span>
              )}
              <span className="subs-list__badge">
                {track.codecId.replace(/^A_/, "")}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function NotesTab({
  bookmarks,
  onJumpBookmark,
  onRemoveBookmark,
}: {
  bookmarks: SceneBookmark[];
  onJumpBookmark: (timeSec: number) => void;
  onRemoveBookmark: (id: string) => void;
}) {
  if (bookmarks.length === 0) {
    return (
      <div className="watch-empty">
        <Bookmark aria-hidden="true" />
        <h3>No scene bookmarks yet.</h3>
        <p>
          Use the Bookmark button under the player to save the current moment.
          Saved scenes appear here so you can jump back to them.
        </p>
      </div>
    );
  }
  return (
    <div className="notes-list">
      {bookmarks.map((bm) => (
        <div key={bm.id} className="notes-list__item">
          <button
            type="button"
            className="notes-list__jump ny-focusable"
            onClick={() => onJumpBookmark(bm.timeSec)}
            title="Jump to this moment"
          >
            <Clock aria-hidden="true" />
            <span>{formatTimecode(bm.timeSec)}</span>
            <em>{new Date(bm.createdAt).toLocaleDateString()}</em>
          </button>
          <button
            type="button"
            className="notes-list__remove ny-focusable"
            onClick={() => onRemoveBookmark(bm.id)}
            aria-label="Remove bookmark"
            title="Remove bookmark"
          >
            <Trash2 aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

function badgeFor(track: SubtitleTrack): string {
  if (track.imageBased || track.format === "image") return "IMG";
  if (track.assRenderer === "jassub") return "ASS";
  if (track.format) return track.format.toUpperCase();
  return "SUB";
}

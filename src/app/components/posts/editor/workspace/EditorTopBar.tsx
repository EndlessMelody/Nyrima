/**
 * Workspace top bar — back navigation, title, word count/reading time,
 * save status, Edit/Preview toggle, Publish, and the inspector-rail
 * toggle. Styled after `.ny-command-bar` (LobbyPage.scss): sticky, glassy,
 * single-row.
 */

import { ArrowLeft, PanelLeft, PanelRight } from "lucide-react";
import { Button, Text } from "@once-ui-system/core/components";
import type { PostStats } from "../../../../services/posts";

export type EditorMode = "edit" | "preview";
export type SaveState = "idle" | "saving" | "saved" | "error";

interface Props {
  title: string;
  onTitleChange: (title: string) => void;
  onTitleEnter: () => void;
  saveState: SaveState;
  localOnly: boolean;
  stats: PostStats;
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  publishLabel: string;
  publishDisabled: boolean;
  onPublishClick: () => void;
  railOpen: boolean;
  onToggleRail: () => void;
  leftRailOpen: boolean;
  onToggleLeftRail: () => void;
  onBack: () => void;
}

export function EditorTopBar({
  title,
  onTitleChange,
  onTitleEnter,
  saveState,
  localOnly,
  stats,
  mode,
  onModeChange,
  publishLabel,
  publishDisabled,
  onPublishClick,
  railOpen,
  onToggleRail,
  leftRailOpen,
  onToggleLeftRail,
  onBack,
}: Props) {
  return (
    <header className="ny-editor-topbar" data-saving={saveState === "saving" || undefined}>
      <button type="button" className="ny-editor-topbar__back" onClick={onBack} aria-label="Back to Posts">
        <ArrowLeft size={16} />
      </button>

      <button
        type="button"
        className="ny-editor-topbar__rail-toggle"
        aria-pressed={leftRailOpen}
        aria-label="Toggle structure rail"
        onClick={onToggleLeftRail}
      >
        <PanelLeft size={16} />
      </button>

      <input
        className="ny-editor-topbar__title"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onTitleEnter();
          }
        }}
        placeholder="Post title"
        maxLength={240}
      />

      <span className="ny-editor-topbar__stats">
        {stats.words} word{stats.words === 1 ? "" : "s"} · {stats.minutes} min read
      </span>

      <SaveIndicator state={saveState} local={localOnly} />

      <div className="ny-editor-topbar__mode" data-mode={mode}>
        <span className="ny-editor-topbar__mode-thumb" aria-hidden="true" />
        <button
          type="button"
          className={mode === "edit" ? "is-active" : ""}
          onClick={() => onModeChange("edit")}
        >
          Edit
        </button>
        <button
          type="button"
          className={mode === "preview" ? "is-active" : ""}
          onClick={() => onModeChange("preview")}
        >
          Preview
        </button>
      </div>

      <Button variant="primary" onClick={onPublishClick} disabled={publishDisabled}>
        {publishLabel}
      </Button>

      <button
        type="button"
        className="ny-editor-topbar__rail-toggle"
        aria-pressed={railOpen}
        aria-label="Toggle inspector"
        onClick={onToggleRail}
      >
        <PanelRight size={16} />
      </button>
    </header>
  );
}

function SaveIndicator({ state, local }: { state: SaveState; local: boolean }) {
  const label =
    state === "saving"
      ? "Saving…"
      : state === "saved"
        ? local
          ? "Saved locally"
          : "Saved"
        : state === "error"
          ? "Couldn't save"
          : "";
  if (!label) return null;
  return (
    <Text
      variant="body-default-xs"
      onBackground="neutral-weak"
      style={{
        fontFamily: "var(--dc-font-mono)",
        whiteSpace: "nowrap",
        color: state === "error" ? "var(--danger-on-background-strong, #ff8a8a)" : undefined,
      }}
    >
      {label}
    </Text>
  );
}

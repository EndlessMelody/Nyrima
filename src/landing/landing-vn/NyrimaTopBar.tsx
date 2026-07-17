import {
  BookOpenText,
  FastForward,
  Info,
  LogIn,
  Play,
  Settings,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { NyrimaMark } from "../../app/components/NyrimaMark";
import type { CompletionStatus } from "./completion";
import { parseNodeKey, type NodeTarget } from "./dialogueFlow";
import type { Chapter } from "./landingSections";
import type {
  DialogueLogEntry,
  VNAutoDelay,
  VNFontFamily,
  VNSettings,
  VNTextColor,
  VNTypingSpeed,
} from "./vnControls";

export type VNHudPanel = "log" | "info" | "settings";

interface NyrimaTopBarProps {
  autoEnabled: boolean;
  soundEnabled: boolean;
  skipEnabled: boolean;
  activePanel: VNHudPanel | null;
  dialogueLog: DialogueLogEntry[];
  settings: VNSettings;
  chapters: Chapter[];
  completion: CompletionStatus;
  onToggleAuto: () => void;
  onToggleSound: () => void;
  onToggleSkip: () => void;
  onTogglePanel: (panel: VNHudPanel) => void;
  onClosePanel: () => void;
  onUpdateSettings: (settings: Partial<VNSettings>) => void;
  onJumpToNode: (target: NodeTarget) => void;
  onEnterNyrima: () => void;
}

const TYPING_OPTIONS: { value: VNTypingSpeed; label: string }[] = [
  { value: "slow", label: "Slow" },
  { value: "normal", label: "Normal" },
  { value: "fast", label: "Fast" },
  { value: "instant", label: "Instant" },
];

const AUTO_DELAY_OPTIONS: { value: VNAutoDelay; label: string }[] = [
  { value: "short", label: "Short" },
  { value: "normal", label: "Normal" },
  { value: "long", label: "Long" },
];

const FONT_OPTIONS: { value: VNFontFamily; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "rounded", label: "Rounded" },
  { value: "pixel", label: "Pixel" },
  { value: "serif", label: "Serif" },
];

const TEXT_COLOR_OPTIONS: { value: VNTextColor; label: string }[] = [
  { value: "soft-white", label: "Soft white" },
  { value: "warm-cream", label: "Warm cream" },
  { value: "pastel-pink", label: "Pastel pink" },
  { value: "pastel-blue", label: "Pastel blue" },
];

export function NyrimaTopBar({
  autoEnabled,
  soundEnabled,
  skipEnabled,
  activePanel,
  dialogueLog,
  settings,
  chapters,
  completion,
  onToggleAuto,
  onToggleSound,
  onToggleSkip,
  onTogglePanel,
  onClosePanel,
  onUpdateSettings,
  onJumpToNode,
  onEnterNyrima,
}: NyrimaTopBarProps) {
  return (
    <>
      <header className="lvn-topbar" onClick={(event) => event.stopPropagation()}>
        <a className="lvn-brand" href="/" aria-label="Nyrima home">
          <NyrimaMark size="header" />
          <span className="ny-wordmark">Nyrima</span>
          <span className="lvn-brand__pulse" aria-hidden="true" />
        </a>

        <div className="lvn-topbar__actions" aria-label="Visual novel controls">
          <HudIconButton
            className="lvn-topbar__control--auto"
            active={autoEnabled}
            pressed
            icon={<Play size={17} />}
            label="Auto"
            onClick={onToggleAuto}
          />
          <HudIconButton
            className="lvn-topbar__control--skip"
            active={skipEnabled}
            pressed
            icon={<FastForward size={17} />}
            label="Skip"
            onClick={onToggleSkip}
          />
          <HudIconButton
            className="lvn-topbar__control--sound"
            active={soundEnabled}
            pressed
            icon={soundEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />}
            label="Sound"
            onClick={onToggleSound}
          />
          <HudIconButton
            className="lvn-topbar__control--log"
            active={activePanel === "log"}
            pressed
            icon={<BookOpenText size={17} />}
            label="Log"
            onClick={() => onTogglePanel("log")}
            ariaExpanded={activePanel === "log"}
          />
          <HudIconButton
            className="lvn-topbar__control--info"
            active={activePanel === "info"}
            pressed
            icon={<Info size={17} />}
            label="Info"
            onClick={() => onTogglePanel("info")}
            ariaExpanded={activePanel === "info"}
          />
          <HudIconButton
            className="lvn-topbar__control--settings"
            active={activePanel === "settings"}
            pressed
            icon={<Settings size={17} />}
            label="Settings"
            onClick={() => onTogglePanel("settings")}
            ariaExpanded={activePanel === "settings"}
          />
          <button
            type="button"
            className="lvn-cta-btn"
            aria-label="Enter Nyrima"
            title="Enter Nyrima"
            onClick={onEnterNyrima}
          >
            <LogIn size={16} />
            <span>Enter Nyrima</span>
          </button>
        </div>
      </header>

      {activePanel === "log" ? (
        <DialogueLogPanel
          entries={dialogueLog}
          chapters={chapters}
          completion={completion}
          onJumpToNode={onJumpToNode}
          onClose={onClosePanel}
        />
      ) : null}
      {activePanel === "info" ? <InfoPanel onClose={onClosePanel} /> : null}
      {activePanel === "settings" ? (
        <SettingsPanel
          settings={settings}
          onClose={onClosePanel}
          onUpdateSettings={onUpdateSettings}
        />
      ) : null}
    </>
  );
}

function HudIconButton({
  active = false,
  pressed = false,
  className,
  icon,
  label,
  onClick,
  ariaExpanded,
}: {
  active?: boolean;
  pressed?: boolean;
  className?: string;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  ariaExpanded?: boolean;
}) {
  return (
    <button
      type="button"
      className={`lvn-ghost-btn lvn-topbar__control${active ? " is-active" : ""}${
        className ? ` ${className}` : ""
      }`}
      aria-label={label}
      aria-pressed={pressed ? active : undefined}
      aria-expanded={ariaExpanded}
      title={label}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

function HudPanelShell({
  children,
  className,
  title,
  onClose,
}: {
  children: ReactNode;
  className: string;
  title: string;
  onClose: () => void;
}) {
  const closeFromBackdrop = (event: MouseEvent) => {
    event.stopPropagation();
    onClose();
  };

  return (
    <>
      <div className="lvn-hud-backdrop" aria-hidden="true" onClick={closeFromBackdrop} />
      <section
        className={`lvn-hud-panel ${className}`}
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="lvn-hud-panel__header">
          <span>{title}</span>
          <button type="button" className="lvn-hud-panel__close" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </section>
    </>
  );
}

function DialogueLogPanel({
  entries,
  chapters,
  completion,
  onJumpToNode,
  onClose,
}: {
  entries: DialogueLogEntry[];
  chapters: Chapter[];
  completion: CompletionStatus;
  onJumpToNode: (target: NodeTarget) => void;
  onClose: () => void;
}) {
  return (
    <HudPanelShell
      className="lvn-hud-panel--log"
      title={`Dialogue Log // ARCHIVE ${completion.percent}%`}
      onClose={onClose}
    >
      <div className="lvn-hud-panel__body">
        {entries.length ? (
          entries.map((entry) => {
            const target = entry.nodeKey ? parseNodeKey(entry.nodeKey, chapters) : null;
            return (
              <article className="lvn-log-line" key={entry.id}>
                <span className="lvn-log-line__speaker">{entry.speaker}</span>
                <p>{entry.text}</p>
                {target ? (
                  <button
                    type="button"
                    className="lvn-log-line__jump"
                    onClick={() => {
                      onJumpToNode(target);
                      onClose();
                    }}
                  >
                    JUMP ↗
                  </button>
                ) : null}
              </article>
            );
          })
        ) : (
          <p className="lvn-hud-panel__empty">Dialogue will appear here once Ny-chan has spoken.</p>
        )}
      </div>
    </HudPanelShell>
  );
}

function InfoPanel({ onClose }: { onClose: () => void }) {
  return (
    <HudPanelShell className="lvn-hud-panel--info" title="About This Landing" onClose={onClose}>
      <div className="lvn-hud-panel__body">
        <p className="lvn-info-panel__lede">
          This is a tiny visual novel-style landing experience for Nyrima, shaped around
          the developer's personality, taste, and the way the app wants to welcome you in.
        </p>
        <p>
          Pick a chapter, follow Ny-chan's guide, and enter Nyrima when you are ready.
        </p>
      </div>
    </HudPanelShell>
  );
}

function SettingsPanel({
  settings,
  onClose,
  onUpdateSettings,
}: {
  settings: VNSettings;
  onClose: () => void;
  onUpdateSettings: (settings: Partial<VNSettings>) => void;
}) {
  return (
    <HudPanelShell className="lvn-hud-panel--settings" title="VN Settings" onClose={onClose}>
      <div className="lvn-hud-panel__body lvn-settings-panel">
        <ChoiceGroup
          label="Typing speed"
          value={settings.typingSpeed}
          options={TYPING_OPTIONS}
          onChange={(typingSpeed) => onUpdateSettings({ typingSpeed })}
        />
        <ChoiceGroup
          label="Auto delay"
          value={settings.autoDelay}
          options={AUTO_DELAY_OPTIONS}
          onChange={(autoDelay) => onUpdateSettings({ autoDelay })}
        />
        <ChoiceGroup
          label="Effects"
          value={settings.effectsEnabled ? "on" : "off"}
          options={[
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
          ]}
          onChange={(value) => onUpdateSettings({ effectsEnabled: value === "on" })}
        />
        <ChoiceGroup
          label="Font"
          value={settings.fontFamily}
          options={FONT_OPTIONS}
          onChange={(fontFamily) => onUpdateSettings({ fontFamily })}
        />
        <ChoiceGroup
          label="Text color"
          value={settings.textColor}
          options={TEXT_COLOR_OPTIONS}
          onChange={(textColor) => onUpdateSettings({ textColor })}
        />
      </div>
    </HudPanelShell>
  );
}

function ChoiceGroup<TValue extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: TValue;
  options: { value: TValue; label: string }[];
  onChange: (value: TValue) => void;
}) {
  return (
    <div className="lvn-setting-group">
      <span className="lvn-setting-group__label">{label}</span>
      <div className="lvn-setting-group__choices">
        {options.map((option) => (
          <button
            type="button"
            className={`lvn-setting-choice${option.value === value ? " is-active" : ""}`}
            aria-pressed={option.value === value}
            key={option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

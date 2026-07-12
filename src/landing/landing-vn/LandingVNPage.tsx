/**
 * LandingVNPage — Nyrima's landing, presented as a visual-novel stage.
 *
 * A landing page first, paced like a VN. On load Ny-chan speaks a short intro
 * (2–3 pages) with NO chapter cards; once it finishes, the four chapter cards
 * reveal. Opening a chapter shows the information panel with a single-line header
 * (← Guide Map · subsection tabs · chapter title) over real, structured content.
 * "Guide Map" (a small text action at the header's left) returns to the index.
 *
 * It is NOT a personalized onboarding flow — no first-time / returning branching.
 * Every arrival starts at the intro; only lightweight VN preferences are saved.
 *
 * Two lanes: Ny-chan owns a protected left lane; the chapter index, the
 * information panel, and the fixed dialogue box all live in the right content
 * lane, sharing `--vn-content-width` and the same x-position (a full breathing
 * gap clear of the mascot). The continue helper lives inside the dialogue box's
 * own footer row and stays visible at all times.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { goTo, LOGIN_PATH } from "../components/sections/sectionData";
import { MagicalSky } from "./MagicalSky";
import { MascotStage } from "./MascotStage";
import { VNDialogueBox } from "./VNDialogueBox";
import { ChapterIndex } from "./ChapterIndex";
import { ChoiceMenu } from "./ChoiceMenu";
import { PanelHeaderLine } from "./PanelHeaderLine";
import { InfoGlassPanel } from "./InfoGlassPanel";
import { NyrimaTopBar, type VNHudPanel } from "./NyrimaTopBar";
import { useLandingSections } from "./useLandingSections";
import { SPEAKER } from "./landingSections";
import {
  effectiveLines,
  getChoiceOption,
  isAtChoicePoint,
  normalizeLines,
  resolveEmotion,
  type Interjection,
} from "./dialogueFlow";
import {
  AFFECTION_GAIN,
  POKE_DEBOUNCE_MS,
  RAPID_POKE_THRESHOLD,
  addAffection,
  isRapidPoke,
  markTiersUnlocked,
  newlyUnlockedTiers,
  pickPokeReaction,
  readStoredAffection,
  recordPoke,
  writeStoredAffection,
  type AffectionState,
} from "./affection";
import { COMPLETION_REWARD, HOVER_REMARKS, IDLE_LINES, pickAmbient } from "./ambientLines";
import { isNodeSeen } from "./completion";
import {
  appendDialogueLogEntry,
  readStoredSoundPreference,
  readStoredVNSettings,
  writeStoredSoundPreference,
  writeStoredVNSettings,
  type DialogueLogEntry,
  type VNSettings,
} from "./vnControls";
import "./landing-vn.scss";

const TYPE_BLIP_INTERVAL_MS = 48;
const TYPE_SOUND_PATH = "/sounds/vn-type.wav";
const TYPE_SPEED_MS_BY_SETTING: Record<VNSettings["typingSpeed"], number> = {
  slow: 36,
  normal: 22,
  fast: 10,
  instant: 0,
};
const AUTO_ADVANCE_DELAY_MS_BY_SETTING: Record<VNSettings["autoDelay"], number> = {
  short: 550,
  normal: 900,
  long: 1400,
};
const IDLE_TIER1_MS = 25_000;
const IDLE_TIER2_MS = 60_000;
const HOVER_DEBOUNCE_MS = 600;

type AdvanceSource = "manual" | "auto";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function useTypingBlipPlayer(soundEnabled: boolean) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioFailedRef = useRef(false);
  const contextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (soundEnabled) audioFailedRef.current = false;
  }, [soundEnabled]);

  return useCallback(() => {
    if (!soundEnabled || typeof window === "undefined" || document.hidden) return;

    const playSynthFallback = () => {
      const AudioContextCtor =
        window.AudioContext ??
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioContextCtor) return;

      try {
        const context = contextRef.current ?? new AudioContextCtor();
        contextRef.current = context;
        if (context.state === "suspended") void context.resume();

        const now = context.currentTime;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(880, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.035, now + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.05);
      } catch {
        // Some browsers block audio until a user gesture; the toggle state still persists.
      }
    };

    if (!audioFailedRef.current && typeof Audio !== "undefined") {
      const audio = audioRef.current ?? new Audio(TYPE_SOUND_PATH);
      if (!audioRef.current) {
        audio.volume = 0.18;
        audio.preload = "auto";
        audio.addEventListener(
          "error",
          () => {
            audioFailedRef.current = true;
          },
          { once: true },
        );
        audioRef.current = audio;
      }

      audio.currentTime = 0;
      void audio.play().catch(() => {
        audioFailedRef.current = true;
        playSynthFallback();
      });
      return;
    }

    playSynthFallback();
  }, [soundEnabled]);
}

/**
 * Idle ambient remarks: while `enabled`, a tier1 (~25s) and tier2 (~60s) timer
 * both reset on pointer/key/wheel activity and call `onIdle` when they elapse.
 * Activity tracking deliberately bypasses React state — a mouse wiggle resets
 * the timers without triggering a re-render.
 */
function useIdleInterjection({
  enabled,
  onIdle,
}: {
  enabled: boolean;
  onIdle: (tier: "tier1" | "tier2") => void;
}) {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled) return;

    let tier1: number;
    let tier2: number;
    const schedule = () => {
      window.clearTimeout(tier1);
      window.clearTimeout(tier2);
      tier1 = window.setTimeout(() => onIdleRef.current("tier1"), IDLE_TIER1_MS);
      tier2 = window.setTimeout(() => onIdleRef.current("tier2"), IDLE_TIER2_MS);
    };

    schedule();
    const events: Array<keyof WindowEventMap> = ["pointermove", "keydown", "wheel"];
    events.forEach((type) => window.addEventListener(type, schedule));

    return () => {
      window.clearTimeout(tier1);
      window.clearTimeout(tier2);
      events.forEach((type) => window.removeEventListener(type, schedule));
    };
  }, [enabled]);
}

export function LandingVNPage() {
  const reducedMotion = usePrefersReducedMotion();
  const nav = useLandingSections();
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => readStoredSoundPreference());
  const [activePanel, setActivePanel] = useState<VNHudPanel | null>(null);
  const [vnSettings, setVNSettings] = useState(() => readStoredVNSettings());
  const [dialogueLog, setDialogueLog] = useState<DialogueLogEntry[]>([]);
  const [skipEnabled, setSkipEnabled] = useState(false);
  const playTypingBlip = useTypingBlipPlayer(soundEnabled);
  const lastTypingBlipAtRef = useRef(0);
  const typeSpeedMs = TYPE_SPEED_MS_BY_SETTING[vnSettings.typingSpeed];
  const autoAdvanceDelayMs = AUTO_ADVANCE_DELAY_MS_BY_SETTING[vnSettings.autoDelay];
  // Skip only fast-forwards through nodes the visitor has already seen, so it
  // can't spoil unread content; it auto-disables once an unseen node, a
  // choice point, or an interjection is reached (see effects below).
  const nodeSeen = isNodeSeen(nav.nodeKey, nav.visited);
  const effectiveSkip = skipEnabled && nodeSeen;
  const instantText = reducedMotion || vnSettings.typingSpeed === "instant" || effectiveSkip;

  const [lineIndex, setLineIndex] = useState(0);
  const [pickedOptionId, setPickedOptionId] = useState<string | null>(null);
  const [shown, setShown] = useState("");
  const [interjection, setInterjection] = useState<Interjection | null>(null);
  const [interjectionIndex, setInterjectionIndex] = useState(0);

  // Poke / affection — persisted across visits (vnControls-style storage).
  const [affection, setAffection] = useState<AffectionState>(() => readStoredAffection());
  const pokeTimestampsRef = useRef<number[]>([]);
  const lastPokeAtRef = useRef(0);

  // Ambient remarks — session-only (no-repeat-until-exhausted idle pool, and
  // a once-per-chapter hover remark + its pending debounce timeout).
  const usedAmbientIdsRef = useRef<Set<string>>(new Set());
  const hoveredChaptersRef = useRef<Set<string>>(new Set());
  const hoverTimeoutRef = useRef<number>();

  // The node's base lines, plus the picked choice option's reply lines (if any).
  const baseLineCount = nav.dialogue.length;
  const lines = useMemo(
    () => effectiveLines(nav.dialogue, nav.choice, pickedOptionId),
    [nav.dialogue, nav.choice, pickedOptionId],
  );
  const lineCount = lines.length;

  // An interjection (poke reaction, idle remark, …) temporarily takes over the
  // dialogue box. While active it supplies fullText/emotion and owns advance();
  // dismissing it resumes the underlying line, re-typed from scratch.
  const activeLines = interjection?.lines ?? lines;
  const activeIndex = interjection ? interjectionIndex : lineIndex;
  const fullText = activeLines[activeIndex]?.text ?? "";
  const complete = shown.length >= fullText.length;
  const isLastLine = lineIndex >= lineCount - 1;
  const isLastActiveLine = activeIndex >= activeLines.length - 1;
  // True once the base lines finish and a choice is waiting for a pick — the
  // choice menu owns input and advance()/auto/intro-reveal all hold here. An
  // active interjection takes priority and suppresses the choice menu.
  const atChoicePoint =
    !interjection && isAtChoicePoint(lineIndex, baseLineCount, nav.choice, pickedOptionId, complete);
  const pickedOption = getChoiceOption(nav.choice, pickedOptionId);
  // Per-line emotion overrides win even inside an interjection (e.g. the
  // completion reward's teary→adoring shift); falling back to the
  // interjection's own emotion, then the node's.
  const fallbackEmotion = interjection?.emotion ?? nav.emotion;
  const emotion = resolveEmotion(activeLines[activeIndex], interjection ? null : pickedOption, fallbackEmotion);

  // Reset to the first line whenever the node (intro/index/chapter/sub) changes.
  useEffect(() => {
    setLineIndex(0);
    setPickedOptionId(null);
    setInterjection(null);
    setInterjectionIndex(0);
    if (hoverTimeoutRef.current !== undefined) {
      window.clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = undefined;
    }
  }, [nav.nodeKey]);

  // Completion reward: once every subsection has been visited, deliver a
  // one-time teary->adoring "thank you" via the interjection channel and bump
  // affection. Declared right after the nodeKey-reset effect so, if both run
  // in the same commit (the last subsection both completes the archive and
  // changes nodeKey), this effect's setInterjection(...) is applied after —
  // and wins over — that effect's setInterjection(null).
  useEffect(() => {
    if (!nav.completion.isComplete || nav.rewardSeen) return;
    nav.markRewardSeen();
    setInterjection({
      id: COMPLETION_REWARD.id,
      lines: normalizeLines(COMPLETION_REWARD.lines),
      emotion: COMPLETION_REWARD.emotion,
    });
    setInterjectionIndex(0);
    setShown("");
    setAffection((prev) => {
      const next = addAffection(prev, AFFECTION_GAIN.completionReward);
      const tiers = newlyUnlockedTiers(prev.points, next.points, prev.unlockedTierIds);
      const updated = tiers.length > 0 ? markTiersUnlocked(next, tiers.map((tier) => tier.id)) : next;
      writeStoredAffection(updated);
      return updated;
    });
  }, [nav.completion.isComplete, nav.rewardSeen, nav.markRewardSeen]);

  // Typewriter (instant under reduced motion or the Instant preference).
  useEffect(() => {
    if (instantText) {
      setShown(fullText);
      return;
    }
    setShown("");
    let count = 0;
    const id = window.setInterval(() => {
      count += 1;
      setShown(fullText.slice(0, count));
      const now = performance.now();
      if (count < fullText.length && now - lastTypingBlipAtRef.current >= TYPE_BLIP_INTERVAL_MS) {
        lastTypingBlipAtRef.current = now;
        playTypingBlip();
      }
      if (count >= fullText.length) window.clearInterval(id);
    }, typeSpeedMs);
    return () => window.clearInterval(id);
  }, [fullText, instantText, playTypingBlip, typeSpeedMs]);

  // VN pacing: once the last intro page finishes typing, reveal the index. An
  // unresolved intro choice or an active interjection holds the reveal.
  const finishIntroRef = useRef(nav.finishIntro);
  finishIntroRef.current = nav.finishIntro;
  useEffect(() => {
    if (nav.level === "intro" && isLastLine && complete && !atChoicePoint && !interjection) {
      finishIntroRef.current();
    }
  }, [nav.level, isLastLine, complete, atChoicePoint, interjection]);

  useEffect(() => {
    if (!complete || !fullText.trim()) return;
    if (interjection) {
      setDialogueLog((entries) =>
        appendDialogueLogEntry(entries, {
          id: `${interjection.id}:${interjectionIndex}:${fullText}`,
          speaker: SPEAKER.name,
          text: fullText,
        }),
      );
      return;
    }
    setDialogueLog((entries) =>
      appendDialogueLogEntry(entries, {
        id: `${nav.nodeKey}:${lineIndex}:${fullText}`,
        speaker: SPEAKER.name,
        text: fullText,
        nodeKey: nav.nodeKey,
      }),
    );
  }, [complete, fullText, lineIndex, nav.nodeKey, interjection, interjectionIndex]);

  // Tap / key advance: finish the typing line, else step to the next line (or,
  // if an interjection is active, step/dismiss it instead). At a choice point
  // the menu owns input, so advance() does nothing — this also makes
  // stage-background clicks unable to skip past an open choice.
  const advance = useCallback((source: AdvanceSource = "manual") => {
    if (source === "manual") setAutoEnabled(false);
    if (atChoicePoint) return;
    if (shown.length < fullText.length) {
      setShown(fullText);
      return;
    }
    if (interjection) {
      if (!isLastActiveLine) {
        setInterjectionIndex((i) => i + 1);
      } else {
        setInterjection(null);
        setInterjectionIndex(0);
        setShown("");
      }
      return;
    }
    if (!isLastLine) setLineIndex((i) => i + 1);
  }, [atChoicePoint, shown.length, fullText, interjection, isLastActiveLine, isLastLine]);

  const advanceRef = useRef<(source?: AdvanceSource) => void>(advance);
  advanceRef.current = advance;

  // Auto mode never resolves a choice — it pauses here and resumes once the
  // visitor picks an option. It does walk through an active interjection.
  useEffect(() => {
    if (!autoEnabled || activePanel || !complete || atChoicePoint) return;
    if (!interjection && isLastLine) return;
    const id = window.setTimeout(() => {
      advanceRef.current("auto");
    }, autoAdvanceDelayMs);
    return () => window.clearTimeout(id);
  }, [
    activePanel,
    autoAdvanceDelayMs,
    autoEnabled,
    complete,
    isLastLine,
    atChoicePoint,
    interjection,
    interjectionIndex,
    lineIndex,
    nav.nodeKey,
  ]);

  // Skip auto-disables the moment it would otherwise spoil something: an
  // unseen node, a choice point (the menu owns input), or an interjection.
  useEffect(() => {
    if (skipEnabled && (!nodeSeen || atChoicePoint || interjection)) {
      setSkipEnabled(false);
    }
  }, [skipEnabled, nodeSeen, atChoicePoint, interjection]);

  // While Skip is active on a seen node, step through it on a short fixed
  // interval (faster than auto-advance). Stops at the last line without
  // disabling Skip, so it stays armed for the next node.
  useEffect(() => {
    if (!effectiveSkip || !complete || isLastLine) return;
    const id = window.setTimeout(() => {
      advanceRef.current("auto");
    }, 150);
    return () => window.clearTimeout(id);
  }, [effectiveSkip, complete, isLastLine, lineIndex, interjection, interjectionIndex]);

  // Resolve the choice: jump straight into the picked option's reply lines and
  // log the visitor's "line". Picking also nudges affection — silently, so it
  // doesn't compete with the reply for the dialogue box.
  const pickOption = useCallback(
    (optionId: string) => {
      const option = getChoiceOption(nav.choice, optionId);
      if (!option) return;
      setAutoEnabled(false);
      setPickedOptionId(optionId);
      setLineIndex(baseLineCount);
      setDialogueLog((entries) =>
        appendDialogueLogEntry(entries, {
          id: `${nav.nodeKey}:choice:${optionId}`,
          speaker: "You",
          text: option.label,
          nodeKey: nav.nodeKey,
        }),
      );
      setAffection((prev) => {
        const next = addAffection(prev, AFFECTION_GAIN.choice);
        const tiers = newlyUnlockedTiers(prev.points, next.points, prev.unlockedTierIds);
        const updated = tiers.length > 0 ? markTiersUnlocked(next, tiers.map((tier) => tier.id)) : next;
        writeStoredAffection(updated);
        return updated;
      });
    },
    [nav.choice, nav.nodeKey, baseLineCount],
  );

  // Poke Ny-chan: +1 affection (debounced), cycling through reaction lines
  // delivered as an interjection. Crossing an affection tier shows that
  // tier's one-time easter egg instead of the usual poke reaction; rapid
  // poking (3 within ~2.5s) gets a flustered "mercy" reaction.
  const handlePoke = useCallback(() => {
    const now = Date.now();
    if (now - lastPokeAtRef.current < POKE_DEBOUNCE_MS) return;
    lastPokeAtRef.current = now;

    const timestamps = [...pokeTimestampsRef.current, now].slice(-RAPID_POKE_THRESHOLD);
    pokeTimestampsRef.current = timestamps;
    const rapid = isRapidPoke(timestamps);

    const next = recordPoke(affection);
    const tiers = newlyUnlockedTiers(affection.points, next.points, affection.unlockedTierIds);
    const updated = tiers.length > 0 ? markTiersUnlocked(next, tiers.map((tier) => tier.id)) : next;
    setAffection(updated);
    writeStoredAffection(updated);

    const tier = tiers[tiers.length - 1];
    const reaction = tier ? tier.reaction : pickPokeReaction(next.pokeCount, rapid);
    setInterjection({
      id: tier ? `affection:${tier.id}` : `poke:${next.pokeCount}`,
      lines: normalizeLines(reaction.lines),
      emotion: reaction.emotion,
    });
    setInterjectionIndex(0);
    setShown("");
  }, [affection]);

  // Idle ambient remarks: a light "still there?" nudge (tier1, ~25s),
  // escalating to a sleepy "did you wander off?" line (tier2, ~60s) if the
  // visitor stays idle. Neither timer resets when an interjection appears —
  // only on real input — so tier2 can supersede a still-showing tier1 (or
  // other) interjection.
  const idleEligible = complete && !atChoicePoint && !activePanel && !autoEnabled;
  const onIdle = useCallback((tier: "tier1" | "tier2") => {
    const picked = pickAmbient(IDLE_LINES[tier], usedAmbientIdsRef.current);
    if (!picked) return;
    usedAmbientIdsRef.current.add(picked.id);
    setInterjection({
      id: `idle:${picked.id}`,
      lines: normalizeLines(picked.lines),
      emotion: picked.emotion,
    });
    setInterjectionIndex(0);
    setShown("");
  }, []);
  useIdleInterjection({ enabled: idleEligible, onIdle });

  // Chapter-card hover remark: 600ms debounce, fired once per chapter per
  // visit, suppressed while typing, at a choice point, mid-interjection, or
  // with a HUD panel open.
  const handleHoverChapter = useCallback(
    (id: string | null) => {
      if (hoverTimeoutRef.current !== undefined) {
        window.clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = undefined;
      }
      if (!id || hoveredChaptersRef.current.has(id)) return;
      if (!complete || atChoicePoint || interjection || activePanel) return;
      const remark = HOVER_REMARKS[id];
      if (!remark) return;
      hoverTimeoutRef.current = window.setTimeout(() => {
        hoveredChaptersRef.current.add(id);
        setInterjection({
          id: `hover:${remark.id}`,
          lines: normalizeLines(remark.lines),
          emotion: remark.emotion,
        });
        setInterjectionIndex(0);
        setShown("");
      }, HOVER_DEBOUNCE_MS);
    },
    [complete, atChoicePoint, interjection, activePanel],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (activePanel) {
          setActivePanel(null);
          return;
        }
        setAutoEnabled(false);
        if (nav.level === "chapter") nav.toIndex();
        return;
      }
      // While a button is focused (chapter cards, subsection tabs, the Guide
      // Map action), let it own Enter/Space/arrows — arrows rove between tabs
      // and cards, Enter/Space activate. Elsewhere these advance the dialogue.
      const onButton = document.activeElement?.tagName === "BUTTON";
      if (event.key === "ArrowRight" && !onButton) {
        event.preventDefault();
        advanceRef.current("manual");
        return;
      }
      if ((event.key === "Enter" || event.key === " ") && !onButton) {
        event.preventDefault();
        advanceRef.current("manual");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePanel, nav]);

  const toggleSound = useCallback(() => {
    setSoundEnabled((enabled) => {
      const next = !enabled;
      writeStoredSoundPreference(next);
      return next;
    });
  }, []);

  const updateVNSettings = useCallback((settings: Partial<VNSettings>) => {
    setVNSettings((current) => {
      const next = { ...current, ...settings };
      writeStoredVNSettings(next);
      return next;
    });
  }, []);

  const openChapter = useCallback(
    (id: string) => {
      setAutoEnabled(false);
      nav.openChapter(id);
    },
    [nav],
  );

  const openSubsection = useCallback(
    (id: string) => {
      setAutoEnabled(false);
      nav.openSubsection(id);
    },
    [nav],
  );

  const toIndex = useCallback(() => {
    setAutoEnabled(false);
    nav.toIndex();
  }, [nav]);

  const stop = useCallback((event: MouseEvent) => event.stopPropagation(), []);

  return (
    <div
      className={`lvn-stage${reducedMotion ? " is-reduced" : ""}${
        vnSettings.effectsEnabled ? "" : " is-effects-muted"
      }`}
      data-level={nav.level}
      data-vn-font={vnSettings.fontFamily}
      data-vn-text-color={vnSettings.textColor}
      onClick={() => advance("manual")}
      role="presentation"
    >
      <MagicalSky />

      <div className="lvn-frame" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>

      <NyrimaTopBar
        autoEnabled={autoEnabled}
        soundEnabled={soundEnabled}
        skipEnabled={skipEnabled}
        activePanel={activePanel}
        dialogueLog={dialogueLog}
        settings={vnSettings}
        chapters={nav.chapters}
        completion={nav.completion}
        onToggleAuto={() => setAutoEnabled((enabled) => !enabled)}
        onToggleSound={toggleSound}
        onToggleSkip={() => setSkipEnabled((enabled) => !enabled)}
        onTogglePanel={(panel) => setActivePanel((open) => (open === panel ? null : panel))}
        onClosePanel={() => setActivePanel(null)}
        onUpdateSettings={updateVNSettings}
        onJumpToNode={nav.jumpTo}
        onEnterNyrima={() => goTo(LOGIN_PATH)}
      />

      <MascotStage
        emotion={emotion}
        speaking={!complete}
        affectionPoints={affection.points}
        onPoke={handlePoke}
      />

      {/* Content region: empty during the intro, then the index, then a chapter
          panel. Always the same width + x-position as the dialogue box. */}
      <div className="lvn-content" onClick={stop}>
        {nav.level === "chapter" && nav.chapter && nav.subsection ? (
          <InfoGlassPanel
            chapter={nav.chapter}
            subsection={nav.subsection}
            header={
              <PanelHeaderLine
                chapter={nav.chapter}
                subsection={nav.subsection}
                visited={nav.visited}
                onBack={toIndex}
                onChoose={openSubsection}
              />
            }
          />
        ) : nav.level === "index" ? (
          <ChapterIndex
            chapters={nav.chapters}
            visited={nav.visited}
            onOpen={openChapter}
            onHoverChapter={handleHoverChapter}
          />
        ) : null}
      </div>

      {/* The fixed dialogue box. Its footer carries the progress dots and the
          always-visible continue hint, so the hint lives inside the box. */}
      <div className="lvn-bottom">
        {atChoicePoint && nav.choice ? (
          <ChoiceMenu choice={nav.choice} onPick={pickOption} />
        ) : null}
        <div className="lvn-dialogue-wrap">
          <VNDialogueBox
            shown={instantText ? fullText : shown}
            fullText={fullText}
            complete={complete}
            lineIndex={lineIndex}
            lineCount={lineCount}
          />
        </div>
      </div>
    </div>
  );
}

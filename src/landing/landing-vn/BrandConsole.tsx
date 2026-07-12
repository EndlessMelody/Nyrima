import { useEffect, useRef, useState } from "react";
import { NyrimaMark } from "../../app/components/NyrimaMark";
import { BRAND_LINES } from "./brandLines";

/**
 * "ANSI Shadow"–style block banner for the wordmark. Rendered in a <pre> with
 * the neon gradient clipped across it, so the lockup reads as a terminal boot
 * banner rather than a typeset logo.
 */
const NYRIMA_ASCII = `███╗   ██╗██╗   ██╗██████╗ ██╗███╗   ███╗ █████╗
████╗  ██║╚██╗ ██╔╝██╔══██╗██║████╗ ████║██╔══██╗
██╔██╗ ██║ ╚████╔╝ ██████╔╝██║██╔████╔██║███████║
██║╚██╗██║  ╚██╔╝  ██╔══██╗██║██║╚██╔╝██║██╔══██║
██║ ╚████║   ██║   ██║  ██║██║██║ ╚═╝ ██║██║  ██║
╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝╚═╝╚═╝     ╚═╝╚═╝  ╚═╝`;

/** Tiny ASCII mascot (Ny-chan) for the console sign-off. */
const NY_CHAN = ` /\\_/\\
( ^.^ )
 > ♥ <`;

/** Fake library listing rendered as \`ls\` output. */
const LIBRARY = [
  { perm: "drwx", name: "Frieren/", meta: "28 ep" },
  { perm: "drwx", name: "Attack on Titan/", meta: "87 ep" },
  { perm: "drwx", name: "Violet Evergarden/", meta: "13 ep" },
];

/** Capability manifest rendered as \`cat features.txt\` output. */
const FEATURES = [
  "resumes exactly where you left off",
  "per-folder comments with friends",
  "no install · works on any device",
];

/** Typewriter timing (ms). */
const TYPE_MS = 42; // per character while typing
const ERASE_MS = 18; // per character while erasing
const HOLD_MS = 2600; // pause once a line is fully typed
const GAP_MS = 420; // pause after erasing before the next line

type Phase = "typing" | "holding" | "erasing";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Left "brand console": a diegetic terminal that mirrors the SYS.MENU panel —
 * a titlebar + status, the Nyrima lockup on a glass plinth, a scanning signal
 * bar, and a typewriter that rotates through the in-character BRAND_LINES.
 */
export function BrandConsole() {
  const [count, setCount] = useState(0); // chars revealed of the active line
  const [index, setIndex] = useState(0); // active BRAND_LINES entry
  const [phase, setPhase] = useState<Phase>("typing");
  const reduceRef = useRef(prefersReducedMotion());

  const line = BRAND_LINES[index];
  const full = line.text + (line.accent ?? "");

  // Drive the typewriter. When reduced motion is on, the full first line is
  // shown statically and no timers run.
  useEffect(() => {
    if (reduceRef.current) {
      setCount(full.length);
      return;
    }

    let timer: number;
    if (phase === "typing") {
      if (count < full.length) {
        timer = window.setTimeout(() => setCount((c) => c + 1), TYPE_MS);
      } else {
        timer = window.setTimeout(() => setPhase("holding"), HOLD_MS);
      }
    } else if (phase === "holding") {
      timer = window.setTimeout(() => setPhase("erasing"), 0);
    } else {
      if (count > 0) {
        timer = window.setTimeout(() => setCount((c) => c - 1), ERASE_MS);
      } else {
        timer = window.setTimeout(() => {
          setIndex((i) => (i + 1) % BRAND_LINES.length);
          setPhase("typing");
        }, GAP_MS);
      }
    }
    return () => window.clearTimeout(timer);
  }, [phase, count, full.length]);

  // Split the revealed slice back into base + accent so the pink highlight is
  // applied to whatever portion of `accent` has been typed so far.
  const baseLen = line.text.length;
  const shown = full.slice(0, count);
  const baseShown = shown.slice(0, baseLen);
  const accentShown = shown.slice(baseLen);

  return (
    <div className="lvn-brand-console">
      <span className="lvn-brand-console__kicker" aria-hidden="true">
        <span className="lvn-brand-console__kicker-inner">
          <span className="lvn-brand-console__kicker-mark">◈</span>
          Personal Anime Cinema
        </span>
      </span>

      <div className="lvn-brand-console__lockup">
        <NyrimaMark
          size="header"
          className="lvn-brand-console__lockup-logo"
          aria-hidden="true"
        />
        <pre className="lvn-brand-console__ascii" aria-hidden="true">{NYRIMA_ASCII}</pre>
        <h1 className="lvn-sr-only">Nyrima</h1>
      </div>

      <span className="lvn-brand-console__signal" aria-hidden="true" />

      <p className="lvn-brand-console__readout" aria-live="polite">
        <span className="lvn-brand-console__prompt" aria-hidden="true">
          &gt;
        </span>
        <span className="lvn-brand-console__line">
          {baseShown}
          <span className="lvn-brand-console__accent">{accentShown}</span>
        </span>
      </p>

      <ul className="lvn-brand-console__log" aria-hidden="true">
        <li>
          <span className="lvn-brand-console__log-ok">OK</span> gdrive mounted · 1 library linked
        </li>
        <li>
          <span className="lvn-brand-console__log-ok">OK</span> codecs HEVC · AV1 · FLAC · AC3
        </li>
        <li>
          <span className="lvn-brand-console__log-ok">OK</span> subtitles libass · PGS · jassub
        </li>
        <li>
          <span className="lvn-brand-console__log-run">··</span> guest session — no account required
        </li>
      </ul>

      <dl className="lvn-brand-console__specs" aria-hidden="true">
        <div>
          <dt>VIDEO</dt>
          <dd>up to 4K</dd>
        </div>
        <div>
          <dt>AUDIO</dt>
          <dd>lossless</dd>
        </div>
        <div>
          <dt>SUBS</dt>
          <dd>ASS · PGS</dd>
        </div>
        <div>
          <dt>SOURCE</dt>
          <dd>Blu-ray</dd>
        </div>
      </dl>

      {/* ls — fake library directory listing with a now-playing line */}
      <div className="lvn-brand-console__cmd" aria-hidden="true">
        <p className="lvn-brand-console__cmd-line">
          <span className="lvn-brand-console__cmd-prompt">$</span> ls ~/library
        </p>
        <ul className="lvn-brand-console__ls">
          {LIBRARY.map((row) => (
            <li key={row.name}>
              <span className="lvn-brand-console__ls-perm">{row.perm}</span>
              <span className="lvn-brand-console__ls-name">{row.name}</span>
              <span className="lvn-brand-console__ls-meta">{row.meta}</span>
            </li>
          ))}
          <li className="is-playing">
            <span className="lvn-brand-console__ls-perm is-play">▶rw-</span>
            <span className="lvn-brand-console__ls-name">ep12.mkv</span>
            <span className="lvn-brand-console__ls-meta">12:48</span>
            <span className="lvn-brand-console__ls-bar">
              <span style={{ width: "38%" }} />
            </span>
          </li>
        </ul>
      </div>

      {/* df — drive usage meter */}
      <div className="lvn-brand-console__cmd" aria-hidden="true">
        <p className="lvn-brand-console__cmd-line">
          <span className="lvn-brand-console__cmd-prompt">$</span> df -h ~/library
        </p>
        <div className="lvn-brand-console__df">
          <span className="lvn-brand-console__df-label">gdrive</span>
          <span className="lvn-brand-console__df-track">
            <span className="lvn-brand-console__df-fill" style={{ width: "48%" }} />
          </span>
          <span className="lvn-brand-console__df-val">2.4T / 5.0T · 48%</span>
        </div>
      </div>

      {/* cat features.txt — capability manifest */}
      <div className="lvn-brand-console__cmd" aria-hidden="true">
        <p className="lvn-brand-console__cmd-line">
          <span className="lvn-brand-console__cmd-prompt">$</span> cat features.txt
        </p>
        <ul className="lvn-brand-console__manifest">
          {FEATURES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      {/* Ny-chan mascot sign-off */}
      <div className="lvn-brand-console__mascot" aria-hidden="true">
        <pre className="lvn-brand-console__mascot-art">{NY_CHAN}</pre>
        <span className="lvn-brand-console__mascot-say">welcome back, senpai~ ♡</span>
      </div>
    </div>
  );
}

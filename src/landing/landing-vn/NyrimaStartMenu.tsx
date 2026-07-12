import { useState, useEffect, useRef } from "react";
import { Play, LogIn, Mail } from "lucide-react";
import { MagicalSky } from "./MagicalSky";
import { ContactPanel } from "./ContactPanel";
import { BootCascade } from "./BootCascade";
import { BrandConsole } from "./BrandConsole";
import { hasBootPlayed, markBootPlayed } from "./bootSequence";
import { goTo, LOGIN_PATH } from "../components/sections/sectionData";

/** Production host — surfaced as the terminal prompt in the title bar. */
const SITE_HOST = "nyrima.pldkhoa.io.vn";

interface NyrimaStartMenuProps {
  onStart: () => void;
}

interface MenuItem {
  id: "start" | "login" | "contact";
  icon: typeof Play;
  label: string;
  sublabel: string;
  ariaLabel: string;
  /** Command echoed in the live prompt (`nyrima:~$ <cmd>`). */
  cmd: string;
  /** Keyboard mnemonic shown as a keycap and bound as a shortcut. */
  hotkey: string;
  /** Shell-style stdout line describing what the command does. */
  hint: string;
}

const MENU_ITEMS: MenuItem[] = [
  {
    id: "start",
    icon: Play,
    label: "Enter Nyrima",
    sublabel: "Meet Ny-chan & start the tour",
    ariaLabel: "Start visual novel experience",
    cmd: "enter",
    hotkey: "⏎",
    hint: "boots the guided VN tour with Ny-chan",
  },
  {
    id: "login",
    icon: LogIn,
    label: "Login",
    sublabel: "Skip to your library",
    ariaLabel: "Skip to login page",
    cmd: "login",
    hotkey: "L",
    hint: "skips ahead straight to your library",
  },
  {
    id: "contact",
    icon: Mail,
    label: "Contact",
    sublabel: "Reach the developer",
    ariaLabel: "Open contact information panel",
    cmd: "contact",
    hotkey: "C",
    hint: "opens a line to the developer",
  },
];

function shouldSkipBoot(): boolean {
  if (typeof window === "undefined") return true;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
  return hasBootPlayed();
}

export function NyrimaStartMenu({ onStart }: NyrimaStartMenuProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [showContact, setShowContact] = useState(false);
  const [bootDone, setBootDone] = useState(shouldSkipBoot);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleBootDone = () => {
    markBootPlayed();
    setBootDone(true);
  };

  const handleStart = () => {
    onStart();
  };

  const handleLogin = () => {
    goTo(LOGIN_PATH);
  };

  const handleContact = () => {
    setShowContact(true);
  };

  const triggerItem = (index: number) => {
    if (index === 0) handleStart();
    else if (index === 1) handleLogin();
    else if (index === 2) handleContact();
  };

  useEffect(() => {
    if (showContact || !bootDone) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % 3);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 + 3) % 3);
      } else if (e.key === "Enter") {
        e.preventDefault();
        triggerItem(activeIndex);
      } else if (e.key === "1" || e.key === "2" || e.key === "3") {
        // Numbered TUI shortcuts: jump to + run a command directly.
        e.preventDefault();
        const idx = Number(e.key) - 1;
        setActiveIndex(idx);
        triggerItem(idx);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, showContact, bootDone]);

  useEffect(() => {
    if (!showContact && bootDone) {
      buttonRefs.current[activeIndex]?.focus();
    }
  }, [activeIndex, showContact, bootDone]);

  return (
    <div className="lvn-start-menu">
      <MagicalSky />
      <div className="lvn-start-menu__grid" aria-hidden="true" />
      <div className="lvn-start-menu__overlay" />
      <div className="lvn-start-menu__scan" aria-hidden="true" />

      {!bootDone && <BootCascade onDone={handleBootDone} />}

      <div className={`lvn-start-menu__content${bootDone ? "" : " is-booting"}`}>
        <div className="lvn-terminal">
          <span className="lvn-start-menu__corner lvn-start-menu__corner--tl" aria-hidden="true" />
          <span className="lvn-start-menu__corner lvn-start-menu__corner--tr" aria-hidden="true" />
          <span className="lvn-start-menu__corner lvn-start-menu__corner--bl" aria-hidden="true" />
          <span className="lvn-start-menu__corner lvn-start-menu__corner--br" aria-hidden="true" />

          <div className="lvn-terminal__titlebar" aria-hidden="true">
            <span className="lvn-terminal__lights">
              <i /> <i /> <i />
            </span>
            <span className="lvn-terminal__path">
              <span className="lvn-terminal__path-user">guest@</span>
              <span className="lvn-terminal__path-host">{SITE_HOST}</span>
              <span className="lvn-terminal__path-sep">:</span>
              <span className="lvn-terminal__path-dir">~/start</span>
              <span className="lvn-terminal__path-prompt">$</span>
            </span>
            <span className="lvn-terminal__status">
              <span className="lvn-start-menu__status-dot" />
              READY
            </span>
          </div>

          <div className="lvn-terminal__body">
            <BrandConsole />

            <span className="lvn-terminal__divider" aria-hidden="true" />

            <div className="lvn-start-menu__menu-container">
              <div className="lvn-start-menu__header" aria-hidden="true">
                <span className="lvn-start-menu__header-tag">◈ SYS.MENU</span>
                <span className="lvn-start-menu__header-meta">
                  <span>
                    STATUS <b className="is-online">ONLINE</b>
                  </span>
                  <span className="lvn-start-menu__header-meta-sep">·</span>
                  <span>
                    LIBRARY <b>GDRIVE</b>
                  </span>
                  <span className="lvn-start-menu__header-meta-sep">·</span>
                  <span>
                    MODE <b>GUEST</b>
                  </span>
                </span>
              </div>

              <nav className="lvn-start-menu__body" aria-label="Visual novel starting menu">
              {/* Live prompt echo — reflects the focused command */}
              <p className="lvn-start-menu__intro" aria-hidden="true">
                <span className="lvn-start-menu__intro-prompt">nyrima:~$</span>
                <span className="lvn-start-menu__intro-cmd">{MENU_ITEMS[activeIndex].cmd}</span>
              </p>

              <button
                ref={(el) => {
                  buttonRefs.current[0] = el;
                }}
                type="button"
                className={`lvn-start-menu__hero ${activeIndex === 0 ? "is-active" : ""}`}
                onClick={() => triggerItem(0)}
                onMouseEnter={() => setActiveIndex(0)}
                aria-label={MENU_ITEMS[0].ariaLabel}
              >
                <span className="lvn-start-menu__hero-aura" aria-hidden="true" />
                <span className="lvn-start-menu__hero-eyebrow">
                  <span className="lvn-start-menu__index">[1]</span> ✦ New here?
                </span>
                <span className="lvn-start-menu__hero-main">
                  <span className="lvn-start-menu__caret" aria-hidden="true">
                    ▶
                  </span>
                  <span className="lvn-start-menu__hero-icon" aria-hidden="true">
                    <Play size={26} />
                  </span>
                  <span className="lvn-start-menu__hero-text">
                    <span className="lvn-start-menu__hero-title">{MENU_ITEMS[0].label}</span>
                    <span className="lvn-start-menu__hero-sub">{MENU_ITEMS[0].sublabel}</span>
                  </span>
                  <kbd className="lvn-start-menu__keycap lvn-start-menu__keycap--hero">
                    {MENU_ITEMS[0].hotkey}
                  </kbd>
                </span>
              </button>

              <div className="lvn-start-menu__rail-label" aria-hidden="true">
                Been here before?
              </div>

              <div className="lvn-start-menu__rail">
                {MENU_ITEMS.slice(1).map((item, idx) => {
                  const i = idx + 1;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      ref={(el) => {
                        buttonRefs.current[i] = el;
                      }}
                      type="button"
                      className={`lvn-start-menu__pill ${activeIndex === i ? "is-active" : ""}`}
                      onClick={() => triggerItem(i)}
                      onMouseEnter={() => setActiveIndex(i)}
                      aria-label={item.ariaLabel}
                    >
                      <span className="lvn-start-menu__caret" aria-hidden="true">
                        ▶
                      </span>
                      <span className="lvn-start-menu__index">[{i + 1}]</span>
                      <Icon size={15} aria-hidden="true" />
                      <span className="lvn-start-menu__pill-label">{item.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Live stdout — echoes what the focused command does */}
              <p className="lvn-start-menu__stdout" aria-hidden="true">
                <span className="lvn-start-menu__stdout-mark">↳</span>
                <span className="lvn-start-menu__stdout-text">{MENU_ITEMS[activeIndex].hint}</span>
              </p>
              </nav>
            </div>
          </div>

          <div className="lvn-terminal__statusbar" aria-hidden="true">
            <span className="lvn-terminal__sb-left">
              <span className="lvn-terminal__sb-chip">GUEST</span>
              <span>LIBRARY GDRIVE</span>
            </span>
            <span className="lvn-terminal__sb-right">
              ↑↓ NAVIGATE <span className="lvn-terminal__sb-sep">·</span> ⏎ SELECT{" "}
              <span className="lvn-terminal__sb-sep">·</span> UTF-8{" "}
              <span className="lvn-terminal__sb-sep">·</span> v1.0
            </span>
          </div>
        </div>
      </div>

      {showContact && <ContactPanel onClose={() => setShowContact(false)} />}
    </div>
  );
}

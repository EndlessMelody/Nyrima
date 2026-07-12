import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Github, Play } from "lucide-react";
import { Button } from "@once-ui-system/core/components";
import {
  landingNavLinks,
  openExternal,
  repoUrl,
  goTo,
  LOGIN_PATH,
} from "../sections/sectionData";

/** Renders one public nav entry by kind: real route or external tab. */
function NavLink({
  link,
  onNavigate,
}: {
  link: (typeof landingNavLinks)[number];
  onNavigate?: () => void;
}) {
  if (link.kind === "route") {
    return (
      <Link to={link.href} onClick={onNavigate}>
        {link.label}
      </Link>
    );
  }
  if (link.kind === "external") {
    return (
      <a
        href={link.href}
        onClick={onNavigate}
        rel="noopener noreferrer"
        target="_blank"
      >
        {link.label}
      </a>
    );
  }
}

/** Brand wordmark: returns to the landing (route "/") and, when already there,
 *  smooth-scrolls to the top. Never leaves a `#` in the URL. */
function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

type SiteHeaderProps = {
  isScrolled: boolean;
};

export function SiteHeader({ isScrolled }: SiteHeaderProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [hasIntroPlayed, setHasIntroPlayed] = useState(false);
  const mobilePanelRef = useRef<HTMLElement | null>(null);
  const mobileToggleRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setHasIntroPlayed(true), 700);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isMobileMenuOpen) {
      return;
    }

    const focusables = mobilePanelRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled])',
    );
    focusables?.[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMobileMenuOpen(false);
        mobileToggleRef.current?.focus();
        return;
      }

      if (event.key !== "Tab" || !focusables || focusables.length === 0) {
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const handleOutsidePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      const isInPanel = mobilePanelRef.current?.contains(target);
      const isToggle = mobileToggleRef.current?.contains(target);
      if (!isInPanel && !isToggle) {
        setIsMobileMenuOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleOutsidePointerDown);
    document.addEventListener("touchstart", handleOutsidePointerDown, {
      passive: true,
    });
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleOutsidePointerDown);
      document.removeEventListener("touchstart", handleOutsidePointerDown);
    };
  }, [isMobileMenuOpen]);

  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  return (
    <header
      className={`site-header${isScrolled ? " is-island" : ""}${
        !hasIntroPlayed ? " is-header-intro" : ""
      }`}
    >
      <div className="site-header__shell">
        <Link
          className="brand-link"
          to="/"
          onClick={scrollToTop}
          aria-label="Nyrima home"
        >
          <img src="/Nyrima_Logo.png" width="34" height="34" alt="" />
          <span>Nyrima</span>
        </Link>

        <nav className="nav-links" aria-label="Primary">
          {landingNavLinks.map((link) => (
            <NavLink key={link.label} link={link} />
          ))}
        </nav>

        <div className="site-header__cta">
          <Button variant="tertiary" onClick={() => openExternal(repoUrl)}>
            <Github size={15} />
            GitHub
          </Button>
          <Button variant="primary" onClick={() => goTo(LOGIN_PATH)}>
            <Play size={15} />
            Open App
          </Button>
        </div>

        <button
          aria-controls="mobile-primary-nav"
          aria-expanded={isMobileMenuOpen}
          aria-label="Toggle navigation menu"
          className="mobile-nav-toggle"
          onClick={() => setIsMobileMenuOpen((open) => !open)}
          ref={mobileToggleRef}
          type="button"
        >
          <span />
          <span />
          <span />
        </button>

        <nav
          aria-label="Mobile navigation"
          className={`mobile-nav-panel${isMobileMenuOpen ? " is-open" : ""}`}
          id="mobile-primary-nav"
          ref={mobilePanelRef}
        >
          {landingNavLinks.map((link) => (
            <NavLink key={link.label} link={link} onNavigate={closeMobileMenu} />
          ))}
          <button
            onClick={() => {
              closeMobileMenu();
              openExternal(repoUrl);
            }}
            type="button"
          >
            <Github size={15} />
            GitHub repository
          </button>
          <button
            onClick={() => {
              closeMobileMenu();
              goTo(LOGIN_PATH);
            }}
            type="button"
          >
            <Play size={15} />
            Open App
          </button>
        </nav>
      </div>
    </header>
  );
}


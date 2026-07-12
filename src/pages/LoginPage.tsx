/**
 * LoginPage — Nyrima's account threshold, staged as a fixed one-screen scene.
 *
 * This is the *account* entry point (distinct from Connect Drive, which links a
 * Google Drive to an already-signed-in account). It is deliberately NOT a long
 * marketing page: the whole thing is composed inside one shared frame at 100vh.
 *
 * Left is Ny-chan's companion panel — three calm zones: an identity row
 * (home + feature badges), a live local glass clock, and a compact VN mascot
 * dialogue card where she reacts to the form (focus, submitting, error,
 * success). Right is the compact glass auth card with the email/password +
 * Google flows, both routed through `AuthProvider` so swapping in a real backend
 * needs no UI change. States covered: idle, focus reactions, submitting
 * (loading), error, and post-auth redirect.
 */

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Captions,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  Maximize,
  Play,
  Sparkles,
  UserRound,
  Volume2,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { NyrimaMark } from "@app/components/NyrimaMark";
import { useAuth } from "@/auth/AuthProvider";
import { EMOTION_ART } from "@/landing/mascotArt";
import {
  featureChips,
  guestCta,
  loginLegalLinks,
  loginPosterUrl,
  mascotHelper,
  mascotMoods,
  mascotSpeaker,
  signInCopy,
  signUpCopy,
  type MascotMood,
} from "./login-page-content";
import "./LoginPage.scss";

type Mode = "signin" | "signup";
type FocusField = "email" | "password" | null;

interface LocationState {
  from?: string;
}

export function LoginPage() {
  const {
    status,
    account,
    error,
    signIn,
    signUp,
    signInWithGoogle,
    startGuestMode,
    clearError,
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as LocationState | null)?.from ?? "/app";

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [rememberDevice, setRememberDevice] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [focusField, setFocusField] = useState<FocusField>(null);
  const [succeeded, setSucceeded] = useState(false);
  const activeCopy = mode === "signin" ? signInCopy : signUpCopy;

  // Pick Ny-chan's reaction from what the form is doing right now. Priority runs
  // from the most decisive state outward: success/error/loading own the scene,
  // then live field focus, then the resting greeting for the active mode.
  const mood: MascotMood = useMemo(() => {
    if (succeeded) return "success";
    if (error) return "error";
    if (submitting) return "loading";
    if (focusField === "email") return "email";
    if (focusField === "password") return "password";
    return mode === "signup" ? "signup" : "default";
  }, [succeeded, error, submitting, focusField, mode]);
  const moodContent = mascotMoods[mood];

  // Apply the public (pink/cyan) palette to match the landing identity.
  useEffect(() => {
    const html = document.documentElement;
    const prevBrand = html.getAttribute("data-brand");
    const prevAccent = html.getAttribute("data-accent");
    html.setAttribute("data-brand", "pink");
    html.setAttribute("data-accent", "cyan");
    return () => {
      if (prevBrand) html.setAttribute("data-brand", prevBrand);
      if (prevAccent) html.setAttribute("data-accent", prevAccent);
    };
  }, []);

  // Already signed in (e.g. navigated here directly) → bounce to the app.
  useEffect(() => {
    if (status === "authenticated" && account) navigate(redirectTo, { replace: true });
  }, [status, account, navigate, redirectTo]);

  // Reuse router history: return to the previous Nyrima entry screen (start
  // menu / landing) when we got here via in-app navigation, else go home.
  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/");
  };

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    clearError();
    setMode(next);
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      if (mode === "signin") {
        await signIn({ email, password });
      } else {
        await signUp({ email, password, displayName });
      }
      setSucceeded(true);
      navigate(redirectTo, { replace: true });
    } catch {
      /* error surfaced via context */
    } finally {
      setSubmitting(false);
    }
  }

  async function onGoogle() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await signInWithGoogle();
      setSucceeded(true);
      navigate(redirectTo, { replace: true });
    } catch {
      /* error surfaced via context */
    } finally {
      setSubmitting(false);
    }
  }

  // "Try Nyrima": enter guest mode and land in the app. No account, no backend.
  // Lands on the lobby (`/app`) rather than `redirectTo` so a guest who hit a
  // sign-in-only deep link doesn't bounce straight back into a locked state.
  function onTryNyrima() {
    if (submitting) return;
    clearError();
    startGuestMode();
    navigate("/app", { replace: true });
  }

  return (
    <div className="ny-auth" data-mode={mode} data-mood={mood}>
      <img
        src={loginPosterUrl}
        alt=""
        className="ny-auth__poster"
        decoding="async"
      />
      <div className="ny-auth__overlay" aria-hidden="true" />
      <div className="ny-auth__petals" aria-hidden="true">
        {Array.from({ length: 9 }, (_, index) => (
          <span key={index} />
        ))}
      </div>

      <main className="ny-auth__frame">
        {/* ── Left: Ny-chan's companion panel ─────────────────────────── */}
        <section className="ny-auth__companion" aria-label="Welcome to Nyrima">
          {/* Zone A — identity row: back + feature badges */}
          <div className="ny-auth__identity">
            <button
              type="button"
              className="ny-auth__home"
              onClick={goBack}
              aria-label="Go back to Nyrima"
            >
              <ArrowLeft size={15} aria-hidden="true" />
              <span>Back to Home</span>
            </button>
            <ul className="ny-auth__badges">
              {featureChips.map((chip) => {
                const Icon = chip.icon;
                return (
                  <li className="ny-auth__badge" key={chip.label}>
                    <Icon size={13} aria-hidden="true" />
                    {chip.label}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Zone B — Nyrima player preview (the product's real visual language) */}
          <PlayerPreview />

          {/* Zone C — mascot dialogue card */}
          <div className="ny-auth__mascot-card">
            <div className="ny-auth__mascot-square" aria-hidden="true">
              <img
                key={moodContent.emotion}
                className="ny-auth__mascot-art"
                src={EMOTION_ART[moodContent.emotion]}
                alt=""
                draggable={false}
              />
            </div>
            <div className="ny-auth__mascot-text" role="status" aria-live="polite">
              <span className="ny-auth__mascot-name">{mascotSpeaker}</span>
              <p className="ny-auth__mascot-lines">
                {moodContent.lines.map((line, index) => (
                  <span key={index}>
                    {line}
                    {index < moodContent.lines.length - 1 ? <br /> : null}
                  </span>
                ))}
              </p>
              {mood === "default" && (
                <span className="ny-auth__mascot-helper">{mascotHelper}</span>
              )}
            </div>
          </div>
        </section>

        {/* ── Right: the auth card (the gate) ─────────────────────────── */}
        <section className="ny-auth__card" aria-label="Nyrima authentication">
          <div className="ny-auth__card-scroll">
            <div className="ny-auth__brand">
              <NyrimaMark size="hero" className="ny-auth__mark" />
              <div className="ny-auth__brand-text">
                <span>Nyrima</span>
                <small>Personal Anime Cinema</small>
              </div>
            </div>

            <header className="ny-auth__hero">
              <h1 className="ny-auth__title">{activeCopy.panelHeading}</h1>
              <p className="ny-auth__lede">{activeCopy.panelBody}</p>
            </header>

            <div className="ny-auth__tabs" role="tablist" aria-label="Auth mode">
              <span className="ny-auth__tabs-thumb" data-mode={mode} aria-hidden="true" />
              <button
                type="button"
                role="tab"
                aria-selected={mode === "signin"}
                className={`ny-auth__tab${mode === "signin" ? " is-active" : ""}`}
                onClick={() => switchMode("signin")}
              >
                Sign in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "signup"}
                className={`ny-auth__tab${mode === "signup" ? " is-active" : ""}`}
                onClick={() => switchMode("signup")}
              >
                Create account
              </button>
            </div>

            <form className="ny-auth__form" onSubmit={onSubmit}>
              {mode === "signup" && (
                <label className="ny-auth__field" htmlFor="display-name">
                  <span className="ny-auth__label">Display name</span>
                  <div className="ny-auth__input-shell">
                    <UserRound size={16} />
                    <input
                      id="display-name"
                      type="text"
                      className="ny-auth__input"
                      placeholder="What should we call you?"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      autoComplete="name"
                    />
                  </div>
                </label>
              )}

              <label className="ny-auth__field" htmlFor="email">
                <span className="ny-auth__label">Email</span>
                <div className="ny-auth__input-shell">
                  <Mail size={16} />
                  <input
                    id="email"
                    type="email"
                    required
                    className="ny-auth__input"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onFocus={() => setFocusField("email")}
                    onBlur={() => setFocusField(null)}
                    autoComplete="email"
                    spellCheck={false}
                  />
                </div>
              </label>

              <label className="ny-auth__field" htmlFor="password">
                <span className="ny-auth__label">Password</span>
                <div className="ny-auth__input-shell">
                  <LockKeyhole size={16} />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    className="ny-auth__input"
                    placeholder={mode === "signup" ? "At least 6 characters" : "Your password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={() => setFocusField("password")}
                    onBlur={() => setFocusField(null)}
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  />
                  <button
                    type="button"
                    className="ny-auth__password-toggle"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowPassword((visible) => !visible)}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>

              <div className="ny-auth__form-options">
                <label className="ny-auth__remember">
                  <input
                    type="checkbox"
                    checked={rememberDevice}
                    onChange={(e) => setRememberDevice(e.target.checked)}
                  />
                  <span>Remember this browser</span>
                </label>
                {mode === "signin" && (
                  <a className="ny-auth__forgot" href="/contact">
                    Forgot password?
                  </a>
                )}
              </div>

              {error && (
                <p className="ny-auth__error" role="alert">
                  {error.message}
                </p>
              )}

              <button type="submit" className="ny-auth__submit" disabled={submitting}>
                {submitting ? "Working…" : activeCopy.submitLabel}
              </button>
            </form>

            <div className="ny-auth__divider">
              <span>or</span>
            </div>

            <button
              type="button"
              className="ny-auth__google"
              onClick={() => void onGoogle()}
              disabled={submitting}
            >
              <GoogleGlyph />
              Continue with Google
            </button>

            {/* ── Guest path — a real, welcoming option (not a debug toggle) ── */}
            <div className="ny-auth__guest-divider">
              <span>{guestCta.eyebrow}</span>
            </div>

            <section className="ny-auth__guest" aria-label={guestCta.title}>
              <div className="ny-auth__guest-text">
                <h2 className="ny-auth__guest-title">
                  <Sparkles size={15} aria-hidden="true" />
                  {guestCta.title}
                </h2>
                <p className="ny-auth__guest-desc">{guestCta.description}</p>
              </div>
              <button
                type="button"
                className="ny-auth__guest-btn"
                onClick={onTryNyrima}
                disabled={submitting}
              >
                {guestCta.button}
              </button>
              <p className="ny-auth__guest-note">{guestCta.note}</p>
            </section>

            <p className="ny-auth__fine">
              We never share your data. By continuing you agree to the{" "}
              {loginLegalLinks.map((link, index) => (
                <span key={link.href}>
                  {index > 0 ? " and " : ""}
                  <a href={link.href}>{link.label}</a>
                </span>
              ))}
              .
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

/**
 * A still preview of the real Nyrima player — the left panel's primary anchor.
 * It is not functional: the controls are decorative (aria-hidden) so keyboard
 * focus never lands on a dead button, while the title/meta stay readable. The
 * poster loads from /videoplayer.jpg with a .png fallback; if neither asset is
 * present yet the glass viewport simply shows its own gradient + play knob, so
 * the block still reads as a player.
 */
const PLAYER_PREVIEW_SOURCES = ["/videoplayer.jpg", "/videoplayer.png"];

function PlayerPreview() {
  const [srcIndex, setSrcIndex] = useState(0);
  const src = PLAYER_PREVIEW_SOURCES[srcIndex];

  return (
    <section className="ny-auth__player" aria-label="Nyrima player preview">
      <header className="ny-auth__player-head">
        <span className="ny-auth__player-now">Now Playing · Nyrima Player</span>
        <h2 className="ny-auth__player-title">Gimai Seikatsu — Episode 01</h2>
        <p className="ny-auth__player-sub">1080p · Multi-audio · Subtitles</p>
      </header>

      <div className="ny-auth__player-view">
        {src && (
          <img
            className="ny-auth__player-img"
            src={src}
            alt=""
            decoding="async"
            onError={() => setSrcIndex((i) => i + 1)}
          />
        )}
        <span className="ny-auth__player-scrim" aria-hidden="true" />
        <span className="ny-auth__player-knob" aria-hidden="true">
          <Play size={20} fill="currentColor" strokeWidth={0} />
        </span>
      </div>

      <div className="ny-auth__player-controls" aria-hidden="true">
        <span className="ny-auth__player-play">
          <Play size={14} fill="currentColor" strokeWidth={0} />
        </span>
        <span className="ny-auth__player-time">
          12:34<i> / 24:00</i>
        </span>
        <span className="ny-auth__player-track">
          <span className="ny-auth__player-fill" />
          <span className="ny-auth__player-thumb" />
        </span>
        <span className="ny-auth__player-icons">
          <Captions size={15} />
          <Volume2 size={15} />
          <Maximize size={15} />
        </span>
      </div>
    </section>
  );
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72A5.4 5.4 0 0 1 3.69 9c0-.6.1-1.18.28-1.72V4.94H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.06l3.01-2.34Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

/**
 * LoginScreen — unified onboarding surface.
 *
 * Replaces the old three-touchpoint flow (SetupAccessDialog for the API key,
 * UserCenter → ApiConfigPanel for the OAuth Client ID, UserCenter → Connect
 * Drive button, NyrimaRootDialog for folder pairing) with a single screen
 * that walks the user through:
 *
 *   1. Connect Drive     — interactive OAuth consent (the app ships an
 *      app-wide Client ID, so this needs no setup for most users)
 *   2. Pair Nyrima folder — paste the Drive folder URL
 *
 * Both steps are visible at once, each rendering a status dot (pending /
 * active / done). A third, collapsed "Advanced" disclosure below holds the
 * BYOK Drive API key + custom OAuth Client ID fields for power users and
 * self-hosted deployments without an app-wide Client ID — it's optional and
 * closed by default since OAuth alone is enough to browse + watch.
 *
 * Once Drive is reachable (OAuth connected, or a BYOK API key saved) and a
 * folder is paired, LandingPage flips out of the onboarding surface.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { NyrimaMark } from "./NyrimaMark";
import { getApiKey, setApiKey } from "../services/api-key";
import {
  getOAuthClientId,
  setOAuthClientId,
  clearOAuthClientId,
} from "../services/oauth-key";
import {
  signOut,
  getOAuthSessionState,
  type OAuthSessionState,
} from "../services/auth";
import { startDriveConnect, DriveConnectError } from "../services/drive-connect";
import { getUserProfile, clearUserProfile } from "../services/user-profile";
import { useNyrimaRootStore } from "../stores/nyrima-root-store";
import { extractFolderId } from "@shared/parse-folder-url";
import { OAUTH_INTERACTIVE_SESSION_HOURS } from "@shared/oauth-session";
import { GOOGLE_CLIENT_ID } from "@/config/googleOAuth";
import type { UserProfile } from "@shared/types";
import "./ConnectDriveScreen.scss";

type StepStatus = "pending" | "active" | "done";

interface Props {
  keyConfigured: boolean;
  rootPaired: boolean;
  rootName: string | null;
  onKeySaved: () => void;
}

export function ConnectDriveScreen({
  keyConfigured,
  rootPaired,
  rootName,
  onKeySaved,
}: Props) {
  // ── Step 1 — credentials ──────────────────────────────────────────────
  const [apiKey, setApiKeyState] = useState("");
  const [oauthClientId, setOAuthClientIdState] = useState("");
  const [step1Status, setStep1Status] = useState<
    "idle" | "validating" | "error"
  >("idle");
  const [step1Message, setStep1Message] = useState<string | null>(null);

  // ── Step 2 — Connect Drive ────────────────────────────────────────────
  const [oauthState, setOAuthState] = useState<OAuthSessionState | null>(null);
  const [oauthExpiresAt, setOAuthExpiresAt] = useState<number | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [oauthMessage, setOAuthMessage] = useState<string | null>(null);

  // ── Step 3 — folder ───────────────────────────────────────────────────
  const setRoot = useNyrimaRootStore((s) => s.setRoot);
  const [folderInput, setFolderInput] = useState("");
  const [folderSubmitting, setFolderSubmitting] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);

  // Guests reach this same screen — frame it as "connect your Drive" (Drive
  // access only) rather than "sign in to your cinema", and make the
  // no-account promise explicit.
  const { status } = useAuth();
  const isGuest = status === "guest";

  // Initial state pull.
  useEffect(() => {
    void getApiKey().then((k) => setApiKeyState(k ?? ""));
    void getOAuthClientId().then((c) => setOAuthClientIdState(c ?? ""));
    void refreshOAuthStatus();
  }, []);

  const refreshOAuthStatus = useCallback(async () => {
    const status = await getOAuthSessionState();
    setOAuthState(status.state);
    setOAuthExpiresAt(status.expiresAt);
    if (status.state === "active") {
      const p = await getUserProfile().catch(() => null);
      if (p) setProfile(p);
    } else {
      setProfile(null);
    }
  }, []);

  // ── Step 1 actions ────────────────────────────────────────────────────
  async function saveCredentials() {
    const trimmedKey = apiKey.trim();
    const trimmedClient = oauthClientId.trim();
    if (!trimmedKey) {
      setStep1Status("error");
      setStep1Message("Paste a Google Drive API key to continue.");
      return;
    }
    setStep1Status("validating");
    setStep1Message(null);
    // Validate against a free, public Drive endpoint. A bad key here will
    // surface as API_KEY_INVALID; anything else we accept and let the
    // user proceed (restricted keys still work for real folders).
    const ok = await validateApiKey(trimmedKey);
    if (!ok.ok) {
      setStep1Status("error");
      setStep1Message(ok.message ?? "Validation failed.");
      return;
    }
    await setApiKey(trimmedKey);
    if (trimmedClient) {
      await setOAuthClientId(trimmedClient);
    } else {
      await clearOAuthClientId();
    }
    setStep1Status("idle");
    setStep1Message(ok.message ? ok.message : "Saved.");
    onKeySaved();
    // Re-probe OAuth state in case the user just pasted a client ID.
    void refreshOAuthStatus();
  }

  // ── Step 2 actions ────────────────────────────────────────────────────
  // Full-page web OAuth redirect to Google's consent screen. Returns to /app
  // via AuthGoogleCallbackPage, which stores the Drive token. On success the
  // page unloads, so we only handle the "not configured" error here.
  async function connectDrive() {
    setConnecting(true);
    setOAuthMessage(null);
    try {
      await startDriveConnect({
        mode: isGuest ? "guest" : "authenticated",
        returnTo: "/app",
      });
    } catch (e) {
      setOAuthMessage(
        e instanceof DriveConnectError ? e.message : "Connect Drive failed.",
      );
      setConnecting(false);
    }
  }

  async function disconnectDrive() {
    await signOut();
    await clearUserProfile();
    setProfile(null);
    await refreshOAuthStatus();
  }

  // ── Step 3 actions ────────────────────────────────────────────────────
  async function pairFolder() {
    const id = extractFolderId(folderInput.trim());
    if (!id) {
      setFolderError("Couldn't find a folder id in that link.");
      return;
    }
    setFolderSubmitting(true);
    setFolderError(null);
    const outcome = await setRoot(id);
    setFolderSubmitting(false);
    if (!outcome.ok) {
      setFolderError(outcome.error.message);
    }
  }

  // ── Step status derivation ────────────────────────────────────────────
  const credentialsSaved = keyConfigured;
  const oauthConnected = oauthState === "active";
  const folderPaired = rootPaired;

  // An OAuth client id is available either app-wide (env) or per-account (BYOK
  // pasted in the Advanced section) — Connect Google Drive works in both cases.
  const hasClientConfig = !!GOOGLE_CLIENT_ID || !!oauthClientId.trim();
  // Drive is usable for folder pairing once EITHER OAuth is connected (Step 1)
  // OR a BYOK API key is set (Advanced) — OAuth alone is enough to browse + watch.
  const driveReady = oauthConnected || credentialsSaved;

  // Step 1 (Connect Drive) is the lead step — active whenever a client id is
  // configured (true for virtually everyone, since the app ships a default)
  // and we're not yet connected.
  const step1: StepStatus = oauthConnected
    ? "done"
    : hasClientConfig
      ? "active"
      : "pending";
  const step2: StepStatus = folderPaired
    ? "done"
    : driveReady
      ? "active"
      : "pending";

  return (
    <section className="ny-login">
      <header
        className="ny-login__hero ny-reveal"
        style={{ "--ny-reveal-delay": "0ms" } as React.CSSProperties}
      >
        <div className="ny-login__mark-wrap">
          <span className="ny-login__portal" aria-hidden="true" />
          <NyrimaMark size="splash" className="ny-login__mark" />
        </div>
        <div className="ny-login__hero-body">
          <span className="ny-login__eyebrow">
            {isGuest
              ? "Personal Cinema - Connect Your Drive"
              : "Personal Cinema - Nyrima Sign In"}
          </span>
          <h1 className="ny-login__title">
            {isGuest ? "Connect your Drive" : "Sign in to your cinema."}
          </h1>
          <p className="ny-login__lede">
            {isGuest
              ? "Nyrima needs your permission to find and play your anime files. No Nyrima account required — your keys stay on this device and Nyrima only ever talks to Google Drive on your behalf."
              : "One click to connect, then pick your folder. Your keys stay on this device; Nyrima only ever talks to Google Drive on your behalf."}
          </p>
        </div>
      </header>

      {/* ─── Step 1 — Connect Drive ────────────────────────────────────── */}
      <Card
        index="01"
        title="Connect your Google account"
        status={step1}
        hint={`Keeps your Nyrima session valid for ${OAUTH_INTERACTIVE_SESSION_HOURS} hours and streams through your personal Drive quota.`}
        revealDelay="60ms"
      >
        {oauthState === "active" && profile ? (
          <div className="ny-login__signed">
            {profile.picture ? (
              <img
                className="ny-login__avatar"
                src={profile.picture}
                alt=""
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="ny-login__avatar ny-login__avatar--mono">
                {(profile.name ?? profile.email ?? "U")[0].toUpperCase()}
              </span>
            )}
            <div className="ny-login__signed-body">
              <span className="ny-login__signed-name">
                {profile.name ?? profile.email ?? "Connected"}
              </span>
              {profile.email && profile.name && (
                <span className="ny-login__signed-email">{profile.email}</span>
              )}
              <span className="ny-login__signed-sub">
                Session valid for {formatRelativeFuture(oauthExpiresAt)} —
                Nyrima refreshes the token in the background.
              </span>
            </div>
            <button
              type="button"
              className="ny-btn ny-btn--ghost"
              onClick={() => void disconnectDrive()}
            >
              Disconnect Drive
            </button>
          </div>
        ) : oauthState === "expired" ? (
          <>
            <p className="ny-login__msg is-warn">
              Your {OAUTH_INTERACTIVE_SESSION_HOURS}-hour Drive session expired.
              Reconnect to refresh.
            </p>
            {oauthMessage && (
              <p className="ny-login__msg is-error">{oauthMessage}</p>
            )}
            <div className="ny-login__actions">
              <button
                type="button"
                className="ny-btn ny-btn--primary"
                onClick={() => void connectDrive()}
                disabled={connecting || !hasClientConfig}
              >
                {connecting ? "Opening Google…" : "Reconnect Google Drive"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="ny-login__field-help">
              {hasClientConfig ? (
                `Click Connect Google Drive — Nyrima sends you to Google's consent screen and back. You'll stay connected for ${OAUTH_INTERACTIVE_SESSION_HOURS} hours.`
              ) : (
                <>
                  OAuth isn't configured for this deployment. Use the
                  Advanced section below to add your own Drive API key, or
                  paste your own OAuth Client ID from{" "}
                  <Link to="/settings">Settings → API credentials</Link>.
                </>
              )}
            </p>
            {oauthMessage && (
              <p className="ny-login__msg is-error">{oauthMessage}</p>
            )}
            <div className="ny-login__actions">
              <button
                type="button"
                className="ny-btn ny-btn--primary"
                onClick={() => void connectDrive()}
                disabled={connecting || !hasClientConfig}
              >
                {connecting ? "Opening Google…" : "Connect Google Drive"}
              </button>
            </div>
            {isGuest && (
              <p className="ny-login__field-help">
                Social features unlock when you sign in.
              </p>
            )}
          </>
        )}
      </Card>

      {/* ─── Step 2 — Pair folder ──────────────────────────────────────── */}
      <Card
        index="02"
        title="Pair your cinema folder"
        status={step2}
        hint="Paste the URL of any Google Drive folder. Its immediate subfolders become your libraries — one per show."
        revealDelay="120ms"
      >
        {folderPaired && rootName ? (
          <p className="ny-login__msg is-ok">
            Paired to "{rootName}". You're all set.
          </p>
        ) : (
          <>
            <Field
              label="Folder URL or ID"
              help={
                <>
                  Tip: right-click any folder on drive.google.com → "Open with
                  Nyrima" to skip this step.
                </>
              }
            >
              <input
                type="text"
                className="ny-login__input"
                placeholder="https://drive.google.com/drive/folders/..."
                value={folderInput}
                onChange={(e) => setFolderInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && driveReady) void pairFolder();
                }}
                disabled={!driveReady || folderSubmitting}
              />
            </Field>
            {folderError && <p className="ny-login__msg is-error">{folderError}</p>}
            <div className="ny-login__actions">
              <button
                type="button"
                className="ny-btn ny-btn--primary"
                onClick={() => void pairFolder()}
                disabled={!driveReady || folderSubmitting}
              >
                {folderSubmitting ? "Pairing…" : "Pair folder"}
              </button>
            </div>
          </>
        )}
      </Card>

      {/* ─── Advanced — BYOK credentials (optional) ─────────────────────── */}
      <details
        className="ny-login__advanced ny-reveal"
        style={{ "--ny-reveal-delay": "180ms" } as React.CSSProperties}
      >
        <summary className="ny-login__advanced-summary">
          Advanced: bring your own Drive API key
        </summary>
        <div className="ny-login__advanced-body">
          <p className="ny-login__field-help">
            Only needed for advanced setups — Connect Google Drive above
            already covers browsing and streaming. A key mainly helps public
            "Anyone with the link" folders stream a bit faster.
          </p>

          <Field
            label="Google Drive API key"
            help={
              <>
                Get one from{" "}
                <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noreferrer"
                >
                  Google Cloud Console
                </a>{" "}
                — click <em>Create credentials → API key</em>.
              </>
            }
          >
            <input
              type="text"
              className="ny-login__input"
              placeholder="AIza..."
              value={apiKey}
              onChange={(e) => setApiKeyState(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>

          <Field
            label="OAuth Client ID"
            help={
              <>
                Same Credentials page →{" "}
                <em>Create credentials → OAuth Client ID → Chrome Extension</em>.
                Only needed to override the app-wide default above.
              </>
            }
          >
            <input
              type="text"
              className="ny-login__input"
              placeholder="1234567890-xxxx.apps.googleusercontent.com"
              value={oauthClientId}
              onChange={(e) => setOAuthClientIdState(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>

          {step1Message && (
            <p
              className={`ny-login__msg${step1Status === "error" ? " is-error" : ""}`}
            >
              {step1Message}
            </p>
          )}

          <div className="ny-login__actions">
            <button
              type="button"
              className="ny-btn ny-btn--primary"
              onClick={() => void saveCredentials()}
              disabled={step1Status === "validating"}
            >
              {step1Status === "validating"
                ? "Validating…"
                : credentialsSaved
                  ? "Update credentials"
                  : "Save & validate"}
            </button>
          </div>
        </div>
      </details>

      <span className="ny-login__engraving" aria-hidden="true">
        Nyrima · Cinema Access
      </span>
    </section>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────

function Card({
  index,
  title,
  hint,
  status,
  revealDelay,
  children,
}: {
  index: string;
  title: string;
  hint: string;
  status: StepStatus;
  revealDelay?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`ny-login__card ny-login__card--${status} ny-reveal`}
      style={
        revealDelay
          ? ({ "--ny-reveal-delay": revealDelay } as React.CSSProperties)
          : undefined
      }
      aria-current={status === "active" ? "step" : undefined}
    >
      <header className="ny-login__card-head">
        <span className={`ny-login__step-dot ny-login__step-dot--${status}`}>
          {status === "done" ? "✓" : index}
        </span>
        <div className="ny-login__card-text">
          <h2 className="ny-login__card-title">{title}</h2>
          <p className="ny-login__card-hint">{hint}</p>
        </div>
      </header>
      <div className="ny-login__card-body">{children}</div>
    </section>
  );
}

function Field({
  label,
  required,
  help,
  children,
}: {
  label: string;
  required?: boolean;
  help?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="ny-login__field">
      <span className="ny-login__field-label">
        {label}
        {required && <span className="ny-login__field-req"> · required</span>}
      </span>
      {children}
      {help && <span className="ny-login__field-help">{help}</span>}
    </label>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

interface KeyValidationResult {
  ok: boolean;
  message?: string;
}

async function validateApiKey(candidate: string): Promise<KeyValidationResult> {
  const url =
    "https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)&key=" +
    encodeURIComponent(candidate);
  try {
    const res = await fetch(url);
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    const msg = (body?.error?.message ?? "").toLowerCase();
    if (msg.includes("api key not valid") || msg.includes("api_key_invalid")) {
      return {
        ok: false,
        message:
          "Google rejected that key. Check the value and that the Drive API is enabled in your Cloud project.",
      };
    }
    return {
      ok: true,
      message: `Google replied ${res.status}; saving anyway — try a real folder next.`,
    };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "Network error while validating the key.",
    };
  }
}

function formatRelativeFuture(epochMs: number | null): string {
  if (!epochMs) return "the rest of the day";
  const diff = epochMs - Date.now();
  if (diff <= 0) return "a moment";
  const h = Math.floor(diff / 3_600_000);
  if (h >= 1) {
    const m = Math.floor((diff - h * 3_600_000) / 60_000);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const m = Math.max(1, Math.floor(diff / 60_000));
  return `${m}m`;
}

/**
 * LoginScreen — unified onboarding surface.
 *
 * Replaces the old three-touchpoint flow (SetupAccessDialog for the API key,
 * UserCenter → ApiConfigPanel for the OAuth Client ID, UserCenter → Connect
 * Drive button, NyrimaRootDialog for folder pairing) with a single screen
 * that walks the user through:
 *
 *   1. Drive credentials — API key (required) and OAuth Client ID (recommended)
 *   2. Connect Drive    — interactive OAuth consent for personal quota
 *   3. Pair Nyrima folder — paste the Drive folder URL
 *
 * All three steps are visible at once. Each step renders a status dot
 * (pending / active / done) so the user can see how far they've gotten
 * without losing context. Step 2 is highlighted as the recommended path
 * but doesn't block completion: an API-key-only setup still works.
 *
 * Once API key + folder are both paired, LandingPage flips out of the
 * onboarding surface; OAuth can be completed (or re-consented after the
 * 24h ceiling) later from the User Center.
 */

import { useCallback, useEffect, useState } from "react";
import { NyrimaMark } from "./NyrimaMark";
import { getApiKey, setApiKey } from "../services/api-key";
import {
  getOAuthClientId,
  setOAuthClientId,
  clearOAuthClientId,
} from "../services/oauth-key";
import {
  tryGetAccessToken,
  signOut,
  getOAuthSessionState,
  type OAuthSessionState,
} from "../services/auth";
import { getUserProfile, clearUserProfile } from "../services/user-profile";
import { useNyrimaRootStore } from "../stores/nyrima-root-store";
import { extractFolderId } from "@shared/parse-folder-url";
import type { UserProfile } from "@shared/types";
import "./LoginScreen.scss";

type StepStatus = "pending" | "active" | "done";

interface Props {
  keyConfigured: boolean;
  rootPaired: boolean;
  rootName: string | null;
  onKeySaved: () => void;
}

export function LoginScreen({
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
  async function connectDrive() {
    if (!oauthClientId.trim()) {
      setOAuthMessage(
        "Paste an OAuth Client ID in Step 1 first, then save.",
      );
      return;
    }
    setConnecting(true);
    setOAuthMessage(null);
    try {
      const token = await tryGetAccessToken(true);
      if (!token) {
        setOAuthMessage(
          "Drive didn't return a token. Double-check the OAuth Client ID and try again.",
        );
        return;
      }
      await refreshOAuthStatus();
    } catch (e) {
      setOAuthMessage(
        e instanceof Error ? e.message : "Connect Drive failed.",
      );
    } finally {
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
  // Active = the next step the user should attend to. We compute these from
  // bottom-up: folder is the final goal, so if folder isn't paired but key
  // is, "active" jumps to folder; OAuth is informational only.
  const step1Done = keyConfigured;
  const step2Done = oauthState === "active";
  const step3Done = rootPaired;

  const step1: StepStatus = step1Done ? "done" : "active";
  const step3: StepStatus = step3Done
    ? "done"
    : step1Done
      ? "active"
      : "pending";
  // Step 2 is "active" once Step 1 is done AND OAuth client ID is present;
  // otherwise it's pending. Done state takes priority.
  const step2: StepStatus = step2Done
    ? "done"
    : step1Done && oauthClientId.trim()
      ? "active"
      : "pending";

  return (
    <section className="ny-login">
      <header className="ny-login__hero">
        <NyrimaMark size="splash" className="ny-login__mark" />
        <div className="ny-login__hero-body">
          <span className="ny-login__eyebrow">
            個人的な映画館 · NYRIMA SIGN IN
          </span>
          <h1 className="ny-login__title">Sign in to your cinema.</h1>
          <p className="ny-login__lede">
            One short setup, three small steps. Your keys stay on this device;
            Nyrima only ever talks to Google Drive on your behalf.
          </p>
        </div>
      </header>

      {/* ─── Step 1 — Credentials ──────────────────────────────────────── */}
      <Card
        index="01"
        title="Pair your Drive credentials"
        status={step1}
        hint="Drive API key is required. OAuth Client ID is recommended — it doubles streaming reliability by routing through your personal quota."
      >
        <Field
          label="Google Drive API key"
          required
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
              Required only for "Connect Drive" in step 2.
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
              : step1Done
                ? "Update credentials"
                : "Save & validate"}
          </button>
        </div>
      </Card>

      {/* ─── Step 2 — Connect Drive ────────────────────────────────────── */}
      <Card
        index="02"
        title="Connect your Google account"
        status={step2}
        hint="Recommended — keeps your Nyrima session valid for 24 hours and lifts the public-API-key rate limits."
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
              Sign out
            </button>
          </div>
        ) : oauthState === "expired" ? (
          <>
            <p className="ny-login__msg is-warn">
              Your 24-hour Drive session expired. Sign in again to refresh.
            </p>
            <div className="ny-login__actions">
              <button
                type="button"
                className="ny-btn ny-btn--primary"
                onClick={() => void connectDrive()}
                disabled={connecting || !oauthClientId.trim()}
              >
                {connecting ? "Opening Google…" : "Sign in again"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="ny-login__field-help">
              {oauthClientId.trim()
                ? "Click Connect Drive to open Google's consent prompt in a popup. You'll be signed in for 24 hours and your token refreshes silently."
                : "Paste an OAuth Client ID in Step 1 first, then save. Skip this step to use API-key-only access (slower, public-quota limited)."}
            </p>
            {oauthMessage && (
              <p className="ny-login__msg is-error">{oauthMessage}</p>
            )}
            <div className="ny-login__actions">
              <button
                type="button"
                className="ny-btn ny-btn--primary"
                onClick={() => void connectDrive()}
                disabled={connecting || !oauthClientId.trim() || !step1Done}
              >
                {connecting ? "Opening Google…" : "Connect Drive"}
              </button>
            </div>
          </>
        )}
      </Card>

      {/* ─── Step 3 — Pair folder ──────────────────────────────────────── */}
      <Card
        index="03"
        title="Pair your cinema folder"
        status={step3}
        hint="Paste the URL of any Google Drive folder. Its immediate subfolders become your libraries — one per show."
      >
        {step3Done && rootName ? (
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
                  if (e.key === "Enter" && step1Done) void pairFolder();
                }}
                disabled={!step1Done || folderSubmitting}
              />
            </Field>
            {folderError && <p className="ny-login__msg is-error">{folderError}</p>}
            <div className="ny-login__actions">
              <button
                type="button"
                className="ny-btn ny-btn--primary"
                onClick={() => void pairFolder()}
                disabled={!step1Done || folderSubmitting}
              >
                {folderSubmitting ? "Pairing…" : "Pair folder"}
              </button>
            </div>
          </>
        )}
      </Card>
    </section>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────

function Card({
  index,
  title,
  hint,
  status,
  children,
}: {
  index: string;
  title: string;
  hint: string;
  status: StepStatus;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`ny-login__card ny-login__card--${status}`}
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

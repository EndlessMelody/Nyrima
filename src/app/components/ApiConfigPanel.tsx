import { useEffect, useState } from "react";
import cn from "classnames";
import { getApiKey, setApiKey, clearApiKey } from "../services/api-key";
import { getOAuthClientId, setOAuthClientId, clearOAuthClientId } from "../services/oauth-key";
import "./ApiConfigPanel.scss";

type Status = "idle" | "validating" | "valid" | "invalid";

export function ApiConfigPanel() {
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [existing, setExisting] = useState<string | null>(null);

  const [oauthClientId, setOAuthClientIdState] = useState("");
  const [oauthExisting, setOAuthExisting] = useState<string | null>(null);

  useEffect(() => {
    void getApiKey().then((stored) => {
      setExisting(stored);
      setKey(stored ?? "");
    });
    void getOAuthClientId().then((stored) => {
      setOAuthExisting(stored);
      setOAuthClientIdState(stored ?? "");
    });
  }, []);

  async function validate(candidate: string): Promise<boolean> {
    const url =
      "https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)&key=" +
      encodeURIComponent(candidate);
    try {
      const res = await fetch(url);
      if (res.ok) return true;
      const body = await res.json().catch(() => ({}));
      const msg = (body?.error?.message ?? "").toLowerCase();
      if (
        msg.includes("api key not valid") ||
        msg.includes("api_key_invalid")
      ) {
        setMessage("Rejected by Google. Check the value and ensure Drive API is enabled.");
        return false;
      }
      setMessage(`Google replied ${res.status}: ${body?.error?.message ?? "unknown"}. Saving anyway.`);
      return true;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Network error validating key.");
      return false;
    }
  }

  async function onSave() {
    const trimmed = key.trim();
    if (!trimmed && existing) {
      await onRemove();
      return;
    }
    if (!trimmed) {
      setMessage("Paste an API key to save.");
      return;
    }

    setStatus("validating");
    setMessage(null);
    const ok = await validate(trimmed);
    if (!ok) {
      setStatus("invalid");
      return;
    }

    await setApiKey(trimmed);

    const oauthTrimmed = oauthClientId.trim();
    if (oauthTrimmed) {
      await setOAuthClientId(oauthTrimmed);
    } else if (oauthExisting) {
      await clearOAuthClientId();
    }

    setExisting(trimmed);
    setOAuthExisting(oauthTrimmed || null);
    setStatus("valid");
    setTimeout(() => {
      setStatus("idle");
    }, 2000);
  }

  async function onRemove() {
    await clearApiKey();
    await clearOAuthClientId();
    setKey("");
    setOAuthClientIdState("");
    setExisting(null);
    setOAuthExisting(null);
    setStatus("idle");
    setMessage("API keys removed.");
  }

  return (
    <div className="dc-api-cfg">
      <div className="dc-api-cfg__section">
        <div className="dc-api-cfg__label">Google Drive API Key</div>
        <p className="dc-api-cfg__desc">
          Required for fast streaming of "Anyone with the link" folders. Get one from{" "}
          <a
            href="https://console.cloud.google.com/apis/credentials"
            target="_blank"
            rel="noreferrer"
          >
            Google Cloud Console
          </a>.
        </p>
        <input
          type="text"
          className="dc-api-cfg__input"
          placeholder="AIza..."
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void onSave()}
        />
      </div>

      <div className="dc-api-cfg__divider" />

      <div className="dc-api-cfg__section">
        <div className="dc-api-cfg__label">Anime metadata</div>
        <p className="dc-api-cfg__desc">
          Posters and series info are fetched from{" "}
          <a href="https://myanimelist.net" target="_blank" rel="noreferrer">
            MyAnimeList
          </a>{" "}
          via the public{" "}
          <a href="https://jikan.moe" target="_blank" rel="noreferrer">
            Jikan
          </a>{" "}
          API. No key required — results are cached locally for 30 days.
        </p>
      </div>

      <div className="dc-api-cfg__divider" />

      <div className="dc-api-cfg__section">
        <div className="dc-api-cfg__label">OAuth Client ID (Optional)</div>
        <p className="dc-api-cfg__desc">
          Required for fetching profile info and bypassing Drive API rate limits (lỗi 403) via Connect Drive.{" "}
          <a
            href="https://console.cloud.google.com/apis/credentials"
            target="_blank"
            rel="noreferrer"
          >
            Create Chrome App Client ID
          </a>.
        </p>
        <input
          type="text"
          className="dc-api-cfg__input"
          placeholder="1234567890-xxxx.apps.googleusercontent.com"
          value={oauthClientId}
          onChange={(e) => setOAuthClientIdState(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void onSave()}
        />
      </div>

      <div className="dc-api-cfg__section">
        {message && (
          <div className={cn("dc-api-cfg__message", { "is-error": status === "invalid" })}>
            {message}
          </div>
        )}
        <div className="dc-api-cfg__actions">
          {existing && (
            <button type="button" className="dc-api-cfg__btn dc-api-cfg__btn--danger" onClick={() => void onRemove()}>
              Remove Keys
            </button>
          )}
          <button
            type="button"
            className="dc-api-cfg__btn dc-api-cfg__btn--primary"
            onClick={() => void onSave()}
            disabled={status === "validating"}
          >
            {status === "validating" ? "Validating..." : status === "valid" ? "Saved ✓" : "Save Keys"}
          </button>
        </div>
      </div>
    </div>
  );
}

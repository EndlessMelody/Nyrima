/**
 * Setup-access dialog for Nyrima.
 *
 * Step-by-step guide that walks the user through:
 *   1. Creating a "Nyrima" folder in Google Drive
 *   2. Sharing it as "Anyone with the link" → Viewer
 *   3. Pairing a Google API key
 *
 * Design intent:
 *  - Clear numbered steps with visual emphasis.
 *  - Inline link that opens the Google Cloud Credentials page in a new tab.
 *  - Validate the key against a cheap public endpoint before persisting,
 *    so a copy/paste mistake surfaces immediately.
 */

import { useEffect, useState } from "react";
import {
  Column,
  Row,
  Heading,
  Text,
  Button,
  Input,
  Dialog,
  Spinner,
} from "@once-ui-system/core/components";
import { getApiKey, setApiKey, clearApiKey } from "../services/api-key";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

type Status = "idle" | "validating" | "valid" | "invalid";

export function SetupAccessDialog({ isOpen, onClose, onSaved }: Props) {
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [existing, setExisting] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setStatus("idle");
    setMessage(null);
    void getApiKey().then((stored) => {
      setExisting(stored);
      setKey(stored ?? "");
    });
  }, [isOpen]);

  async function validate(candidate: string): Promise<boolean> {
    // Hit a tiny public endpoint: list 1 file in a known public folder.
    // If the key is invalid, Google returns 400/403 with API_KEY_INVALID.
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
        setMessage(
          "That key was rejected by Google. Double-check the value and that the Drive API is enabled.",
        );
        return false;
      }
      // 403 with another reason might mean the key is valid but restricted.
      // Treat as "probably valid" so the user can keep going.
      setMessage(
        `Google replied ${res.status}: ${body?.error?.message ?? "unknown"}. Saving anyway — try a real folder next.`,
      );
      return true;
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Network error while validating the key.",
      );
      return false;
    }
  }

  async function onSave() {
    const trimmed = key.trim();
    if (!trimmed) {
      setMessage("Paste an API key, or click Remove to clear the stored one.");
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
    setStatus("valid");
    onSaved?.();
    onClose();
  }

  async function onRemove() {
    await clearApiKey();
    setKey("");
    setExisting(null);
    setStatus("idle");
    setMessage("API key removed.");
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Nyrima — Setup Guide"
      description="Follow these steps to set up your personal cinema on Google Drive."
      style={{ 
        backgroundColor: "var(--page-background)",
      }}
      footer={
        <Row gap="8" wrap>
          <Button variant="tertiary" onClick={onClose}>
            Close
          </Button>
          {existing && (
            <Button variant="tertiary" onClick={onRemove}>
              Remove
            </Button>
          )}
          <Button
            variant="primary"
            onClick={onSave}
            disabled={status === "validating"}
          >
            {status === "validating" ? (
              <Spinner size="xs" />
            ) : existing ? (
              "Update"
            ) : (
              "Save"
            )}
          </Button>
        </Row>
      }
    >
      <Column gap="12" paddingY="8">
        {/* Step 1: Create folder */}
        <Column
          gap="8"
          padding="12"
          radius="m"
          background="surface"
          border="brand-alpha-weak"
        >
          <Text variant="body-strong-s">
            Step 1 — Create your "Nyrima" folder
          </Text>
          <Text variant="body-default-xs" onBackground="neutral-weak">
            1. Go to{" "}
            <a
              href="https://drive.google.com"
              target="_blank"
              rel="noreferrer"
              style={{
                color: "var(--brand-on-background-strong)",
                textDecoration: "underline",
              }}
            >
              Google Drive
            </a>
            .<br />
            2. Click <em>+ New → New folder</em>.<br />
            3. Name it exactly: <strong>Nyrima</strong>
            <br />
            4. Move your video files into this folder.
          </Text>
        </Column>

        {/* Step 2: Share publicly */}
        <Column
          gap="8"
          padding="12"
          radius="m"
          background="surface"
          border="brand-alpha-weak"
        >
          <Text variant="body-strong-s">
            Step 2 — Share the folder publicly
          </Text>
          <Text variant="body-default-xs" onBackground="neutral-weak">
            1. Right-click the <strong>Nyrima</strong> folder → <em>Share</em>.
            <br />
            2. Under "General access", change <em>Restricted</em> to{" "}
            <strong>Anyone with the link</strong>.<br />
            3. Set the role to <strong>Viewer</strong> (so the extension can
            read files inside without letting anyone edit them).
            <br />
            4. Click <em>Done</em>.
          </Text>
        </Column>

        {/* Step 3: API key */}
        <Column
          gap="8"
          padding="12"
          radius="m"
          background="surface"
          border="brand-alpha-weak"
        >
          <Text variant="body-strong-s">Step 3 — Pair a Google API key</Text>
          <Text variant="body-default-xs" onBackground="neutral-weak">
            1. Open{" "}
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noreferrer"
              style={{
                color: "var(--brand-on-background-strong)",
                textDecoration: "underline",
              }}
            >
              Google Cloud Credentials
            </a>
            .<br />
            2. Click <em>Create credentials → API key</em>. Copy the key.
            <br />
            3. (Recommended) Restrict it to the <em>Google Drive API</em>.
            <br />
            4. Paste it below.
          </Text>
        </Column>

        <Input
          id="dc-api-key"
          label="Google API key"
          placeholder="AIza..."
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void onSave();
          }}
        />

        {/* Library posters — manual */}
        <Column
          gap="8"
          padding="12"
          radius="m"
          background="surface"
          border="brand-alpha-weak"
        >
          <Text variant="body-strong-s">Library posters — manual</Text>
          <Text variant="body-default-xs" onBackground="neutral-weak">
            Drop a <code>Poster.jpg</code> or <code>Poster.png</code> into
            each library folder on Drive and Nyrima will use it as the
            cover. Season subfolders inherit their parent show's poster
            when they don't carry their own. No third-party service is
            contacted.
          </Text>
        </Column>

        {message && (
          <Text
            variant="body-default-xs"
            onBackground={
              status === "invalid" ? "danger-medium" : "neutral-weak"
            }
          >
            {message}
          </Text>
        )}

        <Text variant="body-default-xs" onBackground="neutral-weak">
          Your Google key is stored locally (chrome.storage.local) and sent
          only to googleapis.com. Posters come from images you place in
          your own Drive folders — no third-party network calls.
        </Text>
      </Column>
    </Dialog>
  );
}

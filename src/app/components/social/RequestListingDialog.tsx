/**
 * RequestListingDialog — generate a GitHub-issue-ready opt-in snippet.
 *
 * The directory itself is a single JSON file in a public GitHub repo;
 * opt-in is moderated via PR review. This dialog packages the user's
 * identity + bio + tags into a `DirectoryEntry` JSON block they paste
 * into a new issue. The maintainer reviews, merges, and the entry lands
 * in the next directory pull.
 *
 * What we DON'T do: write to the directory programmatically. The PR gate
 * is the spam filter — keeping it manual is the feature, not a bug.
 *
 * Required inputs: handle + folderId (both already known from the user's
 * profile + ensured Shared/ folder). The dialog pre-fills everything and
 * lets the user tweak bio/tags before copying.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Column,
  Row,
  Text,
  Button,
  Dialog,
} from "@once-ui-system/core/components";
import { useSharingStore } from "../../stores/sharing-store";
import { NYRIMA_DIRECTORY_ISSUE_URL } from "@shared/constants";
import type { DirectoryEntry } from "@shared/types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function RequestListingDialog({ isOpen, onClose }: Props) {
  const profile = useSharingStore((s) => s.profile);
  const folders = useSharingStore((s) => s.folders);
  const ensureFolders = useSharingStore((s) => s.ensureFolders);

  const [bio, setBio] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-ensure folders on open so `folderId` is available without
  // requiring the user to bounce through another tab first.
  useEffect(() => {
    if (!isOpen) {
      setCopied(false);
      setError(null);
      return;
    }
    if (folders || !profile) return;
    let cancelled = false;
    void ensureFolders().catch((e) => {
      if (!cancelled) {
        setError(
          e instanceof Error
            ? e.message
            : "Couldn't resolve your Shared/ folder.",
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, folders, profile, ensureFolders]);

  const entry = useMemo<DirectoryEntry | null>(() => {
    if (!profile || !folders) return null;
    const tags = tagsText
      .split(/[,\n]/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 6);
    const e: DirectoryEntry = {
      v: 1,
      handle: profile.handle,
      name: profile.name,
      folderId: folders.root,
      avatarUrl: profile.avatarUrl,
      bio: bio.trim() || undefined,
      tags: tags.length > 0 ? tags : undefined,
      addedAt: new Date().toISOString().slice(0, 10),
    };
    return e;
  }, [profile, folders, bio, tagsText]);

  const snippet = useMemo(() => {
    if (!entry) return "";
    return JSON.stringify(entry, null, 2);
  }, [entry]);

  const issueBody = useMemo(() => {
    if (!entry) return "";
    return [
      `Please add me to the Nyrima directory.`,
      ``,
      "```json",
      JSON.stringify(entry, null, 2),
      "```",
    ].join("\n");
  }, [entry]);

  const issueUrl = useMemo(() => {
    if (!entry) return NYRIMA_DIRECTORY_ISSUE_URL;
    const params = new URLSearchParams({
      title: `Directory listing: @${entry.handle}`,
      body: issueBody,
    });
    return `${NYRIMA_DIRECTORY_ISSUE_URL}?${params.toString()}`;
  }, [entry, issueBody]);

  async function copySnippet() {
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Couldn't copy. Select the snippet manually and copy.");
    }
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Request directory listing"
      description="Paste this JSON snippet into a GitHub issue. Once a maintainer merges it, you'll show up in the Discover rail."
      style={{ backgroundColor: "var(--page-background)" }}
      footer={
        <Row gap="8">
          <Button variant="tertiary" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="tertiary"
            onClick={() => void copySnippet()}
            disabled={!snippet}
          >
            {copied ? "Copied!" : "Copy snippet"}
          </Button>
          <Button
            variant="primary"
            onClick={() => window.open(issueUrl, "_blank", "noopener,noreferrer")}
            disabled={!entry}
          >
            Open GitHub issue
          </Button>
        </Row>
      }
    >
      <Column gap="12" paddingY="8">
        {!profile && (
          <Text
            variant="body-default-s"
            onBackground="neutral-weak"
            style={{ fontFamily: "var(--dc-font-mono)" }}
          >
            Pick a share handle first — your @handle and folder id seed
            the directory entry.
          </Text>
        )}

        {profile && (
          <>
            <FieldRow label="Bio (optional)">
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="A one-line description that helps people decide whether to follow."
                rows={2}
                maxLength={240}
                style={INPUT_STYLE}
              />
            </FieldRow>

            <FieldRow label="Tags (comma-separated, up to 6)">
              <input
                type="text"
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                placeholder="anime, blu-ray, studio-ghibli"
                style={INPUT_STYLE}
              />
            </FieldRow>

            <FieldRow label="JSON snippet (preview)">
              <pre style={PRE_STYLE}>{snippet || "Resolving Shared/ folder…"}</pre>
            </FieldRow>

            <Text
              variant="body-default-xs"
              onBackground="neutral-weak"
              style={{ fontFamily: "var(--dc-font-mono)" }}
            >
              "Open GitHub issue" pre-fills the title + body for you.
              Confirm the snippet, hit Submit, and a maintainer will
              review. No identifying data leaves your browser otherwise.
            </Text>

            {error && (
              <Text
                variant="body-default-xs"
                style={{
                  fontFamily: "var(--dc-font-mono)",
                  color: "var(--danger-on-background-strong, #ff8a8a)",
                }}
              >
                {error}
              </Text>
            )}
          </>
        )}
      </Column>
    </Dialog>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        fontFamily: "var(--dc-font-mono)",
        fontSize: "0.6875rem",
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: "var(--neutral-on-background-medium)",
      }}
    >
      {label}
      {children}
    </label>
  );
}

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  resize: "vertical",
  padding: "10px 12px",
  borderRadius: 8,
  border: "var(--dc-hairline)",
  background: "transparent",
  color: "var(--neutral-on-background-strong)",
  fontFamily: "var(--dc-font-display)",
  fontSize: "0.875rem",
  letterSpacing: 0,
  textTransform: "none",
  lineHeight: 1.4,
};

const PRE_STYLE: React.CSSProperties = {
  margin: 0,
  padding: "10px 12px",
  borderRadius: 8,
  border: "var(--dc-hairline)",
  background: "var(--neutral-alpha-weak)",
  color: "var(--neutral-on-background-strong)",
  fontFamily: "var(--dc-font-mono)",
  fontSize: "0.75rem",
  letterSpacing: 0,
  textTransform: "none",
  lineHeight: 1.45,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  maxHeight: 240,
  overflow: "auto",
};

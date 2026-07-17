/**
 * PublishDialog — choose private/friends/public visibility and apply it.
 *
 * "Friends" and "public" share the same Drive permission today (the post
 * folder goes "Anyone with the link") — the honest distinction, stated in
 * the dialog copy rather than implied, is announcement/discovery reach:
 * friends-tier is surfaced via the follow mechanism and a friends-only
 * discovery-index pointer, public additionally opens up central discovery
 * (Popular/Recent). "Private" never touches Drive permissions or the
 * discovery index — see post-types.ts for the full visibility model.
 *
 * Sharing (friends/public) requires a share handle; drafting never does
 * (PostEditorPage). If none is set yet, the radios are replaced with a
 * prompt into Settings — Private stays available either way since it
 * never needs one. v1 has no `driveVideo` blocks yet, so there's no
 * per-file consent list here — that lands in v1.1 alongside the block.
 */

import { useEffect, useState } from "react";
import { Column, Row, Text, Button, Dialog, Spinner } from "@once-ui-system/core/components";
import type { PostDoc, PostVisibility } from "@shared/post-types";
import { usePostsStore } from "../../stores/posts-store";
import { useSharingStore } from "../../stores/sharing-store";
import { useAccountCenter } from "../../account-center/useAccountCenter";

type DialogVisibility = Extract<PostVisibility, "private" | "friends" | "public">;

interface Props {
  isOpen: boolean;
  onClose: () => void;
  postFolderId: string | null;
  doc: PostDoc;
  onPublished: (next: PostDoc) => void;
}

export function PublishDialog({
  isOpen,
  onClose,
  postFolderId,
  doc,
  onPublished,
}: Props) {
  const publish = usePostsStore((s) => s.publish);
  const makePrivate = usePostsStore((s) => s.makePrivate);
  const profile = useSharingStore((s) => s.profile);
  const accountCenter = useAccountCenter();

  const [visibility, setVisibility] = useState<DialogVisibility>(
    doc.visibility === "public" || doc.visibility === "private"
      ? doc.visibility
      : "friends",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setSubmitting(false);
      setError(null);
      return;
    }
    setVisibility(
      doc.visibility === "public" || doc.visibility === "private"
        ? doc.visibility
        : "friends",
    );
  }, [isOpen, doc.visibility]);

  const isShared = doc.visibility === "friends" || doc.visibility === "public";
  const needsHandle = (visibility === "friends" || visibility === "public") && !profile;

  async function handleSubmit() {
    if (!postFolderId) return;
    if (needsHandle) {
      setError("Pick a share handle before sharing — open Settings to set one up.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const next =
        visibility === "private"
          ? await makePrivate(postFolderId, doc)
          : await publish(postFolderId, doc, visibility);
      onPublished(next);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update visibility.");
    } finally {
      setSubmitting(false);
    }
  }

  function openSharingSettings() {
    accountCenter.open("post-sharing");
    onClose();
  }

  const submitLabel = isShared
    ? visibility === "private"
      ? "Make private"
      : "Update"
    : visibility === "private"
      ? "Keep private"
      : "Publish";

  return (
    <Dialog
      isOpen={isOpen}
      onClose={submitting ? () => undefined : onClose}
      title={isShared ? "Publish settings" : "Publish post"}
      description='Friends/public flip this post’s Drive folder to "Anyone with the link" — anyone who has the URL can open it. Private keeps it off Drive-sharing entirely.'
      style={{ backgroundColor: "var(--page-background)" }}
      footer={
        <Row gap="8">
          <Button variant="tertiary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleSubmit()}
            disabled={submitting || !postFolderId || needsHandle}
          >
            {submitting ? <Spinner size="xs" /> : submitLabel}
          </Button>
        </Row>
      }
    >
      <Column gap="12" paddingY="8">
        <FieldRow label="Who can see this post?">
          <Column gap="8">
            <label style={RADIO_LABEL_STYLE}>
              <input
                type="radio"
                name="visibility"
                checked={visibility === "private"}
                onChange={() => setVisibility("private")}
              />
              Private — only you, kept off Drive-sharing
            </label>
            <label style={RADIO_LABEL_STYLE}>
              <input
                type="radio"
                name="visibility"
                checked={visibility === "friends"}
                onChange={() => setVisibility("friends")}
              />
              Friends — announced to people who follow you
            </label>
            <label style={RADIO_LABEL_STYLE}>
              <input
                type="radio"
                name="visibility"
                checked={visibility === "public"}
                onChange={() => setVisibility("public")}
              />
              Public — same link access, flagged as a public post
            </label>
          </Column>
        </FieldRow>

        {needsHandle && (
          <Column gap="8">
            <Text variant="body-default-xs" onBackground="neutral-weak">
              Pick a share handle before sharing with friends or publicly.
            </Text>
            <Button variant="tertiary" onClick={openSharingSettings}>
              Open Settings
            </Button>
          </Column>
        )}

        {!postFolderId && (
          <Text variant="body-default-xs" onBackground="neutral-weak">
            Your draft is still being created — try again in a moment.
          </Text>
        )}

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
      </Column>
    </Dialog>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
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

const RADIO_LABEL_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontFamily: "var(--dc-font-display)",
  fontSize: "0.8125rem",
  textTransform: "none",
  letterSpacing: 0,
  color: "var(--neutral-on-background-strong)",
};

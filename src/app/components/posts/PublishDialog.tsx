/**
 * PublishDialog — choose friends/public visibility and flip a post live,
 * or pull it back to a draft.
 *
 * "Friends" and "public" share the same Drive permission today (the post
 * folder goes "Anyone with the link") — the honest distinction, stated in
 * the dialog copy rather than implied, is announcement reach: friends-tier
 * only ever gets surfaced via the follow mechanism, public additionally
 * flags itself for a future central discovery surface. v1 has no
 * `driveVideo` blocks yet, so there's no per-file consent list here —
 * that lands in v1.1 alongside the block itself.
 */

import { useEffect, useState } from "react";
import { Column, Row, Text, Button, Dialog, Spinner } from "@once-ui-system/core/components";
import type { PostDoc } from "@shared/post-types";
import { usePostsStore } from "../../stores/posts-store";
import type { PublishedVisibility } from "../../services/posts";

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
  const unpublish = usePostsStore((s) => s.unpublish);

  const [visibility, setVisibility] = useState<PublishedVisibility>(
    doc.visibility === "public" ? "public" : "friends",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setSubmitting(false);
      setError(null);
      return;
    }
    setVisibility(doc.visibility === "public" ? "public" : "friends");
  }, [isOpen, doc.visibility]);

  const isPublished = doc.visibility === "friends" || doc.visibility === "public";

  async function handlePublish() {
    if (!postFolderId) return;
    setSubmitting(true);
    setError(null);
    try {
      const next = await publish(postFolderId, doc, visibility);
      onPublished(next);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't publish.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUnpublish() {
    if (!postFolderId) return;
    setSubmitting(true);
    setError(null);
    try {
      const next = await unpublish(postFolderId, doc);
      onPublished(next);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't unpublish.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={submitting ? () => undefined : onClose}
      title={isPublished ? "Publish settings" : "Publish post"}
      description='Publishing flips this post’s Drive folder to "Anyone with the link" — anyone who has the URL can open it, follower or not.'
      style={{ backgroundColor: "var(--page-background)" }}
      footer={
        <Row gap="8">
          <Button variant="tertiary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          {isPublished && (
            <Button
              variant="tertiary"
              onClick={() => void handleUnpublish()}
              disabled={submitting}
            >
              {submitting ? <Spinner size="xs" /> : "Unpublish"}
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => void handlePublish()}
            disabled={submitting || !postFolderId}
          >
            {submitting ? (
              <Spinner size="xs" />
            ) : isPublished ? (
              "Update"
            ) : (
              "Publish"
            )}
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

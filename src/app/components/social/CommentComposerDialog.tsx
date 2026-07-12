/**
 * CommentComposerDialog — write a comment on someone else's share.
 *
 * Mounts inline from InboxList. The dialog captures the share owner's
 * folder id + shareId from the row that opened it; the writer's identity
 * + folder is resolved from `useSharingStore` so we don't have to thread
 * it through props.
 *
 * Why a dialog (not an inline row expander) for v1: the comment author
 * lives at the bottom of a long list, and editing inline causes layout
 * shift that makes "Tab through unread, comment, mark read" awkward. A
 * dialog keeps the row stable and gives the textarea full attention.
 *
 * Success state: closes immediately after the optimistic insert lands —
 * the social store has already prepended the comment to `myComments`, so
 * the user sees feedback when they switch to Activity. We surface inline
 * errors instead of toasts so the user can correct without re-opening.
 */

import { useEffect, useState } from "react";
import {
  Column,
  Row,
  Text,
  Button,
  Dialog,
  Spinner,
} from "@once-ui-system/core/components";
import { useSharingStore } from "../../stores/sharing-store";
import { useSocialStore } from "../../stores/social-store";
import { MAX_SHARE_COMMENT_CHARS } from "@shared/constants";
import { isSupabaseConfigured } from "@/lib/supabase";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** What we're commenting on. */
  target: {
    /** Share owner's Drive folder id. */
    sharedFolderId: string;
    /** Specific share id (`ShareEntry.id`). */
    shareId: string;
    /** Display title for the dialog header. */
    title?: string;
    /** Author handle for the dialog header. */
    authorHandle: string;
  } | null;
}

export function CommentComposerDialog({ isOpen, onClose, target }: Props) {
  const profile = useSharingStore((s) => s.profile);
  const postComment = useSocialStore((s) => s.postComment);

  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setText("");
      setError(null);
      setSubmitting(false);
    }
  }, [isOpen]);

  async function submit() {
    if (!target) return;
    if (!profile) {
      setError("Pick a share handle in the topbar first.");
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      setError("Write something first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await postComment({
        sharedFolderId: target.sharedFolderId,
        shareId: target.shareId,
        text: trimmed,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't post comment.");
    } finally {
      setSubmitting(false);
    }
  }

  const left = MAX_SHARE_COMMENT_CHARS - text.length;
  const overflow = left < 0;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={submitting ? () => undefined : onClose}
      title="Comment"
      description={
        target
          ? `Replying to @${target.authorHandle} on “${target.title ?? "their share"}”.`
          : ""
      }
      style={{ backgroundColor: "var(--page-background)" }}
      footer={
        <Row gap="8">
          <Button variant="tertiary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={submitting || !target || overflow || text.trim().length === 0}
          >
            {submitting ? <Spinner size="xs" /> : "Post"}
          </Button>
        </Row>
      }
    >
      <Column gap="12" paddingY="8">
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
          Your comment
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Plain text — visible to anyone who opens the share owner's shelf."
            rows={5}
            maxLength={MAX_SHARE_COMMENT_CHARS + 200}
            disabled={submitting}
            autoFocus
            style={{
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
            }}
          />
          <span
            style={{
              alignSelf: "flex-end",
              fontSize: "0.625rem",
              color: overflow
                ? "var(--danger-on-background-strong)"
                : "var(--neutral-on-background-weak)",
            }}
          >
            {left} chars left
          </span>
        </label>

        {profile && (
          <Text
            variant="body-default-xs"
            onBackground="neutral-weak"
            style={{ fontFamily: "var(--dc-font-mono)" }}
          >
            Posting as @{profile.handle}.{" "}
            {isSupabaseConfigured()
              ? "Saved to Nyrima and visible to anyone who opens this share."
              : "Your comment lands in your own Shared/comments.jsonl, not theirs."}
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

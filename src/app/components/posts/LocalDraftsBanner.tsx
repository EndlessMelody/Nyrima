/**
 * LocalDraftsBanner — surfaces posts that were written but never pushed to
 * Drive (see PostEditorPage's local-first drafting model). Shown on the
 * Posts feed since that's the natural place a user returns to after
 * stepping away from an unfinished post — the content already autosaved
 * locally the whole time, so nothing here is at risk until the user
 * explicitly discards it.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Column, Row, Text, Button, Spinner } from "@once-ui-system/core/components";
import {
  deleteLocalDraft,
  listLocalDrafts,
  postDraftHasContent,
  promoteLocalDraftToDrive,
  toLocalDraftRouteId,
  type LocalPostDraft,
} from "../../services/posts";

export function LocalDraftsBanner() {
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<LocalPostDraft[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  useEffect(() => {
    void listLocalDrafts().then((all) =>
      setDrafts(all.filter((entry) => postDraftHasContent(entry.doc))),
    );
  }, []);

  async function handleSaveToDrive(entry: LocalPostDraft) {
    setBusyId(entry.localId);
    setRowError(null);
    try {
      const { folderId } = await promoteLocalDraftToDrive(entry);
      setDrafts((d) => d.filter((x) => x.localId !== entry.localId));
      navigate(`/posts/edit/${folderId}`);
    } catch (e) {
      setRowError(e instanceof Error ? e.message : "Couldn't save to Drive.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDiscard(entry: LocalPostDraft) {
    setBusyId(entry.localId);
    setRowError(null);
    try {
      await deleteLocalDraft(entry.localId);
      setDrafts((d) => d.filter((x) => x.localId !== entry.localId));
    } finally {
      setBusyId(null);
    }
  }

  if (drafts.length === 0) return null;

  return (
    <Column
      gap="8"
      className="ny-posts-feed-page__local-drafts"
      style={{
        border: "1px solid var(--neutral-border-medium)",
        borderRadius: "var(--radius-l, 12px)",
        padding: "12px 16px",
        marginBottom: "16px",
      }}
    >
      <Text variant="body-default-xs" onBackground="neutral-weak" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {drafts.length === 1 ? "Unsaved draft" : `${drafts.length} unsaved drafts`}
      </Text>
      {drafts.map((entry) => (
        <Row key={entry.localId} gap="12" vertical="center" horizontal="between">
          <Text variant="body-default-s">{entry.doc.title || "Untitled post"}</Text>
          <Row gap="8">
            <Button
              variant="tertiary"
              onClick={() => navigate(`/posts/edit/${toLocalDraftRouteId(entry.localId)}`)}
              disabled={busyId === entry.localId}
            >
              Continue
            </Button>
            <Button
              variant="tertiary"
              onClick={() => void handleSaveToDrive(entry)}
              disabled={busyId === entry.localId}
            >
              {busyId === entry.localId ? <Spinner size="xs" /> : "Save to Drive"}
            </Button>
            <Button
              variant="tertiary"
              onClick={() => void handleDiscard(entry)}
              disabled={busyId === entry.localId}
            >
              Discard
            </Button>
          </Row>
        </Row>
      ))}
      {rowError && (
        <Text
          variant="body-default-xs"
          style={{
            fontFamily: "var(--dc-font-mono)",
            color: "var(--danger-on-background-strong, #ff8a8a)",
          }}
        >
          {rowError}
        </Text>
      )}
    </Column>
  );
}

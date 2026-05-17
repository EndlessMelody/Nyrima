/**
 * NyrimaRootDialog — pair the extension with the user's root cinema folder.
 *
 * Replaces the generic "Open a folder" dialog. As of 2026-05-17 we no longer
 * require the folder be literally named "Nyrima" — any Drive folder works,
 * and its immediate child folders become the lobby's libraries. On a fresh
 * pick, wipes any data tied to the previously-paired account so leftover
 * libraries from earlier API keys can't bleed into the new lobby.
 */

import { useEffect, useState } from "react";
import {
  Column,
  Row,
  Text,
  Button,
  Input,
  Dialog,
  Spinner,
} from "@once-ui-system/core/components";
import { useNyrimaRootStore } from "../stores/nyrima-root-store";
import { extractFolderId } from "@shared/parse-folder-url";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export function NyrimaRootDialog({ isOpen, onClose, onSaved }: Props) {
  const root = useNyrimaRootStore((s) => s.root);
  const setRoot = useNyrimaRootStore((s) => s.setRoot);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setInput("");
    setError(null);
    setSubmitting(false);
  }, [isOpen]);

  async function onSubmit() {
    const id = extractFolderId(input.trim());
    if (!id) {
      setError("Couldn't find a folder id in that input.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const outcome = await setRoot(id);
    setSubmitting(false);
    if (outcome.ok) {
      onSaved?.();
      onClose();
      return;
    }
    setError(outcome.error.message);
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={root ? "Change cinema folder" : "Pair your cinema folder"}
      description={
        root
          ? `Currently paired to "${root.name}". Pick a different Drive folder to switch — this wipes the previous library data.`
          : `Paste the URL of any Google Drive folder. Its immediate subfolders become your libraries (one per show).`
      }
      style={{ backgroundColor: "var(--page-background)" }}
      footer={
        <Row gap="8">
          <Button variant="tertiary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSubmit} disabled={submitting}>
            {submitting ? <Spinner size="xs" /> : root ? "Switch" : "Pair"}
          </Button>
        </Row>
      }
    >
      <Column gap="8" paddingY="8">
        <Input
          id="nyrima-folder-url"
          label="Folder URL or ID"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="https://drive.google.com/drive/folders/..."
          autoFocus
          disabled={submitting}
          onKeyDown={(e) => {
            if (e.key === "Enter") void onSubmit();
          }}
        />
        {error && (
          <Text variant="body-default-xs" onBackground="danger-medium">
            {error}
          </Text>
        )}
        <Text variant="body-default-xs" onBackground="neutral-weak">
          Tip: right-click any folder on drive.google.com and choose “Open with
          Nyrima”.
        </Text>
      </Column>
    </Dialog>
  );
}

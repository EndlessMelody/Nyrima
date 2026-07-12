/**
 * DriveFilePicker — browse the author's own Drive to pick an image for a
 * `driveImage` block.
 *
 * Starts at the Nyrima root, lets the user navigate into subfolders via a
 * breadcrumb trail, and lists images alongside folders in each listing.
 * Picking a file calls `onPick` with the raw `DriveFile` (the caller
 * decides what to persist — usually just `file.id` as the block's
 * `fileId` prop) and closes the dialog.
 *
 * v1 scope is images only (`driveImage` is the only media block); the
 * mimeType filter is the one thing to loosen when `driveVideo`/`driveAudio`
 * land in v1.1.
 */

import { useEffect, useState } from "react";
import { Column, Row, Text, Button, Dialog } from "@once-ui-system/core/components";
import { isFolder, listFolder } from "../../services/drive-api";
import { getNyrimaRoot } from "../../services/storage";
import type { DriveFile } from "@shared/types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onPick: (file: DriveFile) => void;
}

interface Crumb {
  id: string;
  name: string;
}

export function DriveFilePicker({ isOpen, onClose, onPick }: Props) {
  const [breadcrumb, setBreadcrumb] = useState<Crumb[]>([]);
  const [entries, setEntries] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setBreadcrumb([]);
      setEntries([]);
      setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const root = await getNyrimaRoot();
        if (!root) throw new Error("Pair your Nyrima root folder first.");
        if (cancelled) return;
        setBreadcrumb([{ id: root.id, name: root.name }]);
        await loadListing(root.id);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Couldn't open Drive.");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  async function loadListing(folderId: string) {
    setLoading(true);
    setError(null);
    try {
      const { files } = await listFolder(folderId, { pageSize: 200 });
      const visible = files.filter(
        (f) => isFolder(f) || (f.mimeType?.startsWith("image/") ?? false),
      );
      setEntries(visible);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't list that folder.");
    } finally {
      setLoading(false);
    }
  }

  function openFolder(folder: DriveFile) {
    setBreadcrumb((prev) => [...prev, { id: folder.id, name: folder.name }]);
    void loadListing(folder.id);
  }

  function jumpToCrumb(index: number) {
    setBreadcrumb((prev) => prev.slice(0, index + 1));
    void loadListing(breadcrumb[index].id);
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Choose an image"
      description="Pick a picture from your own Drive library."
      style={{ backgroundColor: "var(--page-background)" }}
      footer={
        <Row gap="8">
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
        </Row>
      }
    >
      <Column gap="12" paddingY="8">
        <Row gap="4" wrap style={{ fontFamily: "var(--dc-font-mono)", fontSize: "0.6875rem" }}>
          {breadcrumb.map((crumb, i) => (
            <Row key={crumb.id} gap="4" vertical="center">
              {i > 0 && <span style={{ opacity: 0.5 }}>/</span>}
              <button
                type="button"
                onClick={() => jumpToCrumb(i)}
                disabled={i === breadcrumb.length - 1}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: i === breadcrumb.length - 1 ? "default" : "pointer",
                  color:
                    i === breadcrumb.length - 1
                      ? "var(--neutral-on-background-strong)"
                      : "var(--neutral-on-background-weak)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  fontFamily: "inherit",
                }}
              >
                {crumb.name}
              </button>
            </Row>
          ))}
        </Row>

        <div style={LIST_STYLE}>
          {loading && (
            <Text variant="body-default-xs" onBackground="neutral-weak">
              Loading…
            </Text>
          )}
          {!loading && entries.length === 0 && !error && (
            <Text variant="body-default-xs" onBackground="neutral-weak">
              Nothing here.
            </Text>
          )}
          {!loading &&
            entries.map((entry) =>
              isFolder(entry) ? (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => openFolder(entry)}
                  style={ROW_BUTTON_STYLE}
                >
                  <span aria-hidden="true">📁</span>
                  <span style={{ flex: 1, textAlign: "left" }}>{entry.name}</span>
                </button>
              ) : (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onPick(entry)}
                  style={ROW_BUTTON_STYLE}
                >
                  {entry.thumbnailLink ? (
                    <img
                      src={entry.thumbnailLink}
                      alt=""
                      loading="lazy"
                      style={{
                        width: 32,
                        height: 32,
                        objectFit: "cover",
                        borderRadius: 4,
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <span aria-hidden="true">🖼️</span>
                  )}
                  <span style={{ flex: 1, textAlign: "left" }}>{entry.name}</span>
                </button>
              ),
            )}
        </div>

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

const LIST_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  maxHeight: 320,
  overflowY: "auto",
  border: "var(--dc-hairline)",
  borderRadius: 8,
  padding: 6,
};

const ROW_BUTTON_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "8px 10px",
  borderRadius: 6,
  border: "none",
  background: "transparent",
  color: "var(--neutral-on-background-strong)",
  fontFamily: "var(--dc-font-display)",
  fontSize: "0.8125rem",
  cursor: "pointer",
  textAlign: "left",
};

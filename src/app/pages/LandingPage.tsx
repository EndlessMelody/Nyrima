/**
 * Landing page — Cinematic global lobby.
 *
 * Sections:
 *   - Setup banner (restyled)
 *   - Hero with featured video from most-recent folder
 *   - Continue Watching (cross-folder)
 *   - Folder list (pinned + recent)
 */

import { useEffect, useMemo, useState } from "react";
import {
  Column,
  Row,
  Text,
  Button,
  Input,
  Dialog,
} from "@once-ui-system/core/components";
import { useRecentStore } from "../stores/recent-store";
import { usePlaybackPositions } from "../hooks/usePlaybackPositions";
import { FolderCard } from "../components/FolderCard";
import { LobbyHero } from "../components/LobbyHero";
import { ContinueWatchingRow } from "../components/ContinueWatchingRow";
import { SetupAccessDialog } from "../components/SetupAccessDialog";
import { WelcomeBlock } from "../components/WelcomeBlock";
import { extractFolderId } from "@shared/parse-folder-url";
import { useNavigate } from "react-router-dom";
import { hasApiKey } from "../services/api-key";
import { listFolderAll, isVideoFile } from "../services/drive-api";
import { resolvePoster } from "../services/poster-resolver";
import type { DriveFile, MovieMetadata } from "@shared/types";
import "./LandingPage.scss";

export function LandingPage() {
  const { folders, load } = useRecentStore();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(() => {
    if (typeof window !== "undefined") {
      return new URLSearchParams(window.location.search).get("setup") === "1";
    }
    return false;
  });
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null);
  const [positions] = usePlaybackPositions();
  const [featured, setFeatured] = useState<DriveFile | null>(null);
  const [featuredMeta, setFeaturedMeta] = useState<MovieMetadata | null>(null);
  const [featuredFolderId, setFeaturedFolderId] = useState<string>("");
  const navigate = useNavigate();

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const has = await hasApiKey();
      if (!cancelled) setKeyConfigured(has);
    }
    void refresh();
    const onChanged = (
      changes: { [k: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area === "local" && "dc.apiKey" in changes) void refresh();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  // Load featured video from the most recent folder.
  useEffect(() => {
    if (folders.length === 0) return;
    let cancelled = false;
    const mostRecent = folders[0];
    void (async () => {
      try {
        const files = await listFolderAll(mostRecent.id);
        const videos = files.filter(isVideoFile);
        if (videos.length === 0) return;
        const pick =
          videos[Math.floor(Math.random() * Math.min(videos.length, 30))];
        if (!cancelled) {
          setFeatured(pick);
          setFeaturedFolderId(mostRecent.id);
          const meta = await resolvePoster(pick);
          if (!cancelled) setFeaturedMeta(meta);
        }
      } catch {
        // ignore — hero just won't render
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [folders]);

  const pinned = folders.filter((f) => f.pinned);
  const others = folders.filter((f) => !f.pinned);

  const handleCloseSetup = () => {
    setSetupOpen(false);
    // Chỉ dọn dẹp URL sau khi popup đã được đóng
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("setup") === "1") {
        params.delete("setup");
        const next = params.toString();
        const url = window.location.pathname + (next ? `?${next}` : "") + window.location.hash;
        window.history.replaceState({}, "", url);
      }
    }
  };

  function onSubmit() {
    const id = extractFolderId(input.trim());
    if (!id) {
      setError("Could not find a folder id in that input.");
      return;
    }
    setOpen(false);
    setInput("");
    setError(null);
    navigate(`/library/${encodeURIComponent(id)}`);
  }

  // Build DriveFile stubs from playback positions for ContinueWatchingRow.
  const continueFiles = useMemo<DriveFile[]>(
    () =>
      Object.values(positions)
        .filter((p) => p.name && p.folderId)
        .map(
          (p) =>
            ({
              id: p.fileId,
              name: p.name!,
              mimeType: p.mimeType || "video/mp4",
              modifiedTime: p.updatedAt
                ? new Date(p.updatedAt).toISOString()
                : undefined,
            }) as DriveFile,
        ),
    [positions],
  );

  return (
    <div className="ny-landing">
      <WelcomeBlock
        keyConfigured={keyConfigured}
        onOpenFolder={() => setOpen(true)}
        onOpenSetup={() => setSetupOpen(true)}
      />

      {featured && (
        <LobbyHero
          file={featured}
          meta={featuredMeta}
          folderId={featuredFolderId}
        />
      )}

      <ContinueWatchingRow videos={continueFiles} positions={positions} />

      {pinned.length > 0 && (
        <section className="ny-landing__section">
          <h3 className="ny-landing__section-heading">Pinned</h3>
          <div className="ny-folder-grid">
            {pinned.map((f) => (
              <FolderCard key={f.id} folder={f} />
            ))}
          </div>
        </section>
      )}

      <section className="ny-landing__section">
        <h3 className="ny-landing__section-heading">Recent</h3>
        {others.length === 0 ? (
          <EmptyState onAdd={() => setOpen(true)} />
        ) : (
          <div className="ny-folder-grid">
            {others.map((f) => (
              <FolderCard key={f.id} folder={f} />
            ))}
          </div>
        )}
      </section>

      <SetupAccessDialog
        isOpen={setupOpen}
        onClose={handleCloseSetup}
        onSaved={() => setKeyConfigured(true)}
      />

      <Dialog
        isOpen={open}
        onClose={() => {
          setOpen(false);
          setError(null);
        }}
        title="Open a Drive folder"
        description="Paste a Google Drive folder URL or its ID."
        footer={
          <Row gap="8">
            <Button variant="tertiary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={onSubmit}>
              Open
            </Button>
          </Row>
        }
      >
        <Column gap="8" paddingY="8">
          <Input
            id="folder-url"
            label="Folder URL or ID"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/..."
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") onSubmit();
            }}
          />
          {error && (
            <Text variant="body-default-xs" onBackground="danger-medium">
              {error}
            </Text>
          )}
          <Text variant="body-default-xs" onBackground="neutral-weak">
            Tip: right-click any folder on drive.google.com and choose "Open
            with Nyrima".
          </Text>
        </Column>
      </Dialog>
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="ny-landing__empty">
      <span className="dc-tracker">NO ENTRIES</span>
      <p className="ny-landing__empty-title">No libraries yet</p>
      <p className="ny-landing__empty-sub">
        Open your "Nyrima" folder from Drive to start your archive.
      </p>
      <button type="button" className="ny-btn ny-btn--primary" onClick={onAdd}>
        Open a folder
      </button>
    </div>
  );
}

/**
 * LocalFolderPanel — connect/manage a persisted local media folder for the
 * `/library/local-folder` page. Mirrors the Drive "Sources" lifecycle:
 * connect (directory picker) -> indexed counts -> rescan/disconnect, with a
 * re-grant step for the `needs-permission` boot state (most browsers don't
 * remember File System Access read grants across sessions).
 *
 * Two extra entry points work in (almost) every state, including
 * `unsupported`:
 * - "Open a file" (quick-open) plays/reads/listens to a single file for this
 *   session without indexing a folder — falls back to a plain
 *   `<input type="file">` on Firefox/Safari.
 * - "Pick a folder for this session" (webkitdirectory) is the Firefox/Safari
 *   substitute for the directory picker: it indexes a `FileList` in memory,
 *   nothing is persisted, so it must be re-picked every reload.
 */

import { useRef, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  FileSearch,
  FolderInput,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
  Unplug,
} from "lucide-react";
import { VIDEO_EXTENSIONS } from "@shared/constants";
import { LOCAL_ROOT_FOLDER_ID } from "@shared/local-id";
import { useLocalLibraryStore } from "../../services/local-library/local-library-store";
import { buildLocalFileDriveFile } from "../../services/local-library/local-source";
import { pickLocalFile, type QuickOpenAccept } from "../../services/local-library/quick-open";
import {
  LIGHT_NOVEL_EXTENSIONS,
  MEDIA_LIBRARY_KINDS,
  MUSIC_EXTENSIONS,
  getMediaFolderName,
  getSupportedMediaKind,
} from "../../services/media-library-source";
import { LibraryStatePanel } from "./LibraryStates";

const LOCAL_KINDS = MEDIA_LIBRARY_KINDS.filter((kind) => kind !== "manga");

function dotExtensions(extensions: readonly string[]): `.${string}`[] {
  return extensions.map((ext) => `.${ext}` as `.${string}`);
}

const QUICK_OPEN_TYPES: QuickOpenAccept[] = [
  {
    description: "Movies, light novels, and music",
    accept: {
      "video/*": dotExtensions(VIDEO_EXTENSIONS),
      "audio/*": dotExtensions(MUSIC_EXTENSIONS),
      "application/epub+zip": dotExtensions(LIGHT_NOVEL_EXTENSIONS),
    },
  },
];

export function LocalFolderPanel() {
  const status = useLocalLibraryStore((s) => s.status);
  const rootName = useLocalLibraryStore((s) => s.rootName);
  const scans = useLocalLibraryStore((s) => s.scans);
  const error = useLocalLibraryStore((s) => s.error);
  const isVirtualRoot = useLocalLibraryStore((s) => s.isVirtualRoot);
  const connect = useLocalLibraryStore((s) => s.connect);
  const reconnect = useLocalLibraryStore((s) => s.reconnect);
  const rescan = useLocalLibraryStore((s) => s.rescan);
  const disconnect = useLocalLibraryStore((s) => s.disconnect);
  const connectVirtualDirectory = useLocalLibraryStore((s) => s.connectVirtualDirectory);

  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [quickOpenError, setQuickOpenError] = useState<string | null>(null);
  const dirInputRef = useRef<HTMLInputElement | null>(null);

  const run = (action: () => Promise<void>) => () => {
    setBusy(true);
    setQuickOpenError(null);
    void action().finally(() => setBusy(false));
  };

  async function handleQuickOpen(): Promise<void> {
    const picked = await pickLocalFile(QUICK_OPEN_TYPES);
    if (!picked) return;
    // Classification only — `inferLocalMimeType` (via `buildLocalFileDriveFile`)
    // handles extensions browsers report with an empty `File.type` (.mkv, .flac).
    const probe = buildLocalFileDriveFile(picked.file.name, picked.file);
    switch (getSupportedMediaKind(probe)) {
      case "movies":
        navigate(`/play/${LOCAL_ROOT_FOLDER_ID}/${picked.localId}`);
        return;
      case "light-novel":
        navigate(`/read/${LOCAL_ROOT_FOLDER_ID}/${picked.localId}`);
        return;
      case "music":
        navigate(`/music/player/${picked.localId}`, {
          state: {
            track: {
              id: picked.localId,
              title: picked.file.name,
              source: "local",
              autoPlay: true,
            },
          },
        });
        return;
      default:
        setQuickOpenError(
          `"${picked.file.name}" isn't a movie, light novel, or music file Nyrima can open.`,
        );
    }
  }

  function handleDirectoryFiles(e: ChangeEvent<HTMLInputElement>): void {
    const { files } = e.target;
    e.target.value = "";
    if (!files || files.length === 0) return;
    run(() => connectVirtualDirectory(files))();
  }

  function setDirInput(el: HTMLInputElement | null): void {
    dirInputRef.current = el;
    el?.setAttribute("webkitdirectory", "");
  }

  const directoryFallbackInput = (
    <input
      ref={setDirInput}
      type="file"
      multiple
      style={{ display: "none" }}
      onChange={handleDirectoryFiles}
    />
  );

  const quickOpenButton = (
    <button type="button" className="ny-btn" disabled={busy} onClick={run(handleQuickOpen)}>
      <FileSearch aria-hidden="true" /> Open a file
    </button>
  );

  const pickFolderButton = (
    <button
      type="button"
      className="ny-btn"
      disabled={busy}
      onClick={() => {
        setQuickOpenError(null);
        dirInputRef.current?.click();
      }}
    >
      <FolderInput aria-hidden="true" /> Pick a folder for this session
    </button>
  );

  const quickOpenNotice = quickOpenError ? (
    <p className="local-folder-panel__notice" role="alert">
      {quickOpenError}
    </p>
  ) : null;

  if (status === "unsupported") {
    return (
      <>
        <LibraryStatePanel
          icon={<AlertTriangle />}
          tracker="Local source"
          title="Local folders aren't supported in this browser"
          message="Persistent local folders need the File System Access API (Chrome, Edge, or another Chromium-based browser). You can still open a single file, or pick a folder for this session — Google Drive remains available everywhere."
          tone="warning"
          action={
            <>
              {quickOpenButton}
              {pickFolderButton}
            </>
          }
        />
        {quickOpenNotice}
        {directoryFallbackInput}
      </>
    );
  }

  if (status === "disconnected") {
    return (
      <>
        <LibraryStatePanel
          icon={<FolderOpen />}
          tracker="Local source"
          title="Connect a local folder"
          message="Pick a folder containing Movies, Light Novel, and Music subfolders. Nyrima remembers the folder and re-checks access each time you open the app."
          action={
            <>
              <button type="button" className="ny-btn ny-btn--primary" disabled={busy} onClick={run(connect)}>
                <FolderOpen aria-hidden="true" /> Choose folder
              </button>
              {quickOpenButton}
            </>
          }
        />
        {quickOpenNotice}
      </>
    );
  }

  if (status === "needs-permission") {
    return (
      <>
        <LibraryStatePanel
          icon={<HardDrive />}
          tracker="Local source"
          title="Local library paused"
          message={`Nyrima remembers "${rootName || "your folder"}" but needs permission again to read it this session.`}
          tone="accent"
          action={
            <>
              <button type="button" className="ny-btn ny-btn--primary" disabled={busy} onClick={run(reconnect)}>
                <RefreshCw aria-hidden="true" /> Re-grant access
              </button>
              {quickOpenButton}
            </>
          }
        />
        {quickOpenNotice}
      </>
    );
  }

  if (status === "indexing") {
    return (
      <LibraryStatePanel
        icon={<Loader2 className="lib-spin" />}
        tracker="Local source"
        title="Indexing local folder..."
        message={`Scanning "${rootName || "your folder"}" for movies, light novels, and music.`}
        tone="accent"
      />
    );
  }

  if (status === "error") {
    return (
      <>
        <LibraryStatePanel
          icon={<AlertTriangle />}
          tracker="Local source"
          title="Couldn't read the local folder"
          message={error ?? "Something went wrong while indexing your local folder."}
          tone="warning"
          action={
            <>
              <button type="button" className="ny-btn ny-btn--primary" disabled={busy} onClick={run(rescan)}>
                <RefreshCw aria-hidden="true" /> Try again
              </button>
              {quickOpenButton}
            </>
          }
        />
        {quickOpenNotice}
      </>
    );
  }

  return (
    <section className="lib-panel local-folder-panel">
      <header className="lib-panel__head">
        <span className="lib-panel__icon" aria-hidden="true">
          <HardDrive />
        </span>
        <h3>{rootName || "Local folder"}</h3>
      </header>
      <ul className="local-folder-panel__stats">
        {LOCAL_KINDS.map((kind) => {
          const count = scans[kind]?.files.length ?? 0;
          return (
            <li key={kind} className="local-folder-panel__stat">
              <span className="local-folder-panel__stat-value">{count.toLocaleString()}</span>
              <span className="local-folder-panel__stat-label">{getMediaFolderName(kind)}</span>
            </li>
          );
        })}
      </ul>
      <div className="local-folder-panel__actions">
        <button type="button" className="ny-btn" disabled={busy} onClick={run(rescan)}>
          <RefreshCw aria-hidden="true" /> Rescan
        </button>
        {isVirtualRoot ? (
          <button
            type="button"
            className="ny-btn"
            disabled={busy}
            onClick={() => {
              setQuickOpenError(null);
              dirInputRef.current?.click();
            }}
          >
            <FolderInput aria-hidden="true" /> Change folder
          </button>
        ) : (
          <button type="button" className="ny-btn" disabled={busy} onClick={run(connect)}>
            <FolderOpen aria-hidden="true" /> Change folder
          </button>
        )}
        {quickOpenButton}
        <button type="button" className="ny-btn ny-btn--ghost" disabled={busy} onClick={run(disconnect)}>
          <Unplug aria-hidden="true" /> Disconnect
        </button>
      </div>
      {quickOpenNotice}
      {isVirtualRoot && directoryFallbackInput}
    </section>
  );
}

export function localFolderTotalLabel(
  status: ReturnType<typeof useLocalLibraryStore.getState>["status"],
  scans: ReturnType<typeof useLocalLibraryStore.getState>["scans"],
): string {
  switch (status) {
    case "ready": {
      const total = LOCAL_KINDS.reduce((sum, kind) => sum + (scans[kind]?.files.length ?? 0), 0);
      return `${total.toLocaleString()} indexed`;
    }
    case "needs-permission":
      return "Needs permission";
    case "indexing":
      return "Indexing...";
    case "error":
      return "Error";
    case "unsupported":
      return "Not supported";
    default:
      return "Not connected";
  }
}

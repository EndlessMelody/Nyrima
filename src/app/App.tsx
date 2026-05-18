import { Suspense, lazy, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { LandingPage } from "./pages/LandingPage";
import { LibraryPage } from "./pages/LibraryPage";
import { SocialPage } from "./pages/SocialPage";
import { AppShell } from "./components/AppShell";
import { DriveDebugPanel } from "./components/DriveDebugPanel";
import { SharingHost } from "./components/SharingHost";
import { useDevModeStore } from "./services/drive/dev-mode";

// Player pulls in EBML, MSE controller, JASSUB (libass), and the MKV
// subtitle pipeline — none of which the lobby needs. Splitting it out keeps
// the lobby cold-start lean; the chunk downloads the first time the user
// clicks Play.
const PlayerPage = lazy(() =>
  import("./pages/PlayerPage").then((m) => ({ default: m.PlayerPage })),
);

export function App() {
  const loadDevMode = useDevModeStore((s) => s.load);
  useEffect(() => {
    void loadDevMode();
  }, [loadDevMode]);

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/library/:folderId" element={<LibraryPage />} />
        <Route path="/social" element={<SocialPage />} />
        <Route path="/social/:tab" element={<SocialPage />} />
        <Route
          path="/play/:folderId/:fileId"
          element={
            <Suspense fallback={<PlayerChunkFallback />}>
              <PlayerPage />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <DriveDebugPanel />
      <SharingHost />
    </AppShell>
  );
}

// Minimal fallback that doesn't depend on PlayerPage's CSS bundle (which is
// itself part of the lazy chunk and isn't on the page yet). Visible only
// during the chunk download — typically a single frame on a warm cache.
function PlayerChunkFallback() {
  return (
    <div
      style={{
        padding: "32px",
        opacity: 0.7,
        fontFamily: "var(--font-mono, monospace)",
        fontSize: "12px",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      Loading player…
    </div>
  );
}

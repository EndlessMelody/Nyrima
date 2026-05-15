import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { LandingPage } from "./pages/LandingPage";
import { LibraryPage } from "./pages/LibraryPage";
import { PlayerPage } from "./pages/PlayerPage";
import { AppShell } from "./components/AppShell";
import { DriveDebugPanel } from "./components/DriveDebugPanel";
import { useDevModeStore } from "./services/drive/dev-mode";

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
        <Route path="/play/:folderId/:fileId" element={<PlayerPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <DriveDebugPanel />
    </AppShell>
  );
}

import { Routes, Route, Navigate } from "react-router-dom";
import { LandingPage } from "./pages/LandingPage";
import { LibraryPage } from "./pages/LibraryPage";
import { PlayerPage } from "./pages/PlayerPage";
import { AppShell } from "./components/AppShell";

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/library/:folderId" element={<LibraryPage />} />
        <Route path="/play/:folderId/:fileId" element={<PlayerPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

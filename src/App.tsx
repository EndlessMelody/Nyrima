/**
 * Web app route tree.
 *
 * Public surface (no auth):
 *   /                → marketing landing (the former promo site)
 *   /login           → account sign-in / sign-up
 *   /auth/callback   → OAuth redirect target (Drive popup today; account later)
 *   /terms, /privacy → legal pages (reuse the landing's combined legal doc)
 *   /faq, /contact, /guide → landing sub-pages (real routes, not URL hashes)
 *
 * Authenticated app (gated by RequireAuth, wrapped in AppShell):
 *   /app                       → lobby / dashboard
 *   /library                   → unified "All Library" hub
 *   /library/movies            → Movies library
 *   /library/manga             → Manga library
 *   /library/light-novel       → Light Novel library
 *   /library/music             → Music library
 *   /music/player[/:trackId]   → dedicated Music player
 *   /library/favorites[...]    → safe quick-access placeholders
 *   /library/:folderId         → a library's contents
 *   /play/:folderId/:fileId    → the player (lazy-loaded)
 *   /read/:folderId/:fileId    → the EPUB / Light Novel reader (lazy-loaded)
 *   /u/:handle                 → profile dashboard ("me" = your own)
 *   /social[...]               → social hub
 *   /posts                     → posts feed (Following / My posts)
 *   /posts/new, /posts/edit/:folderId → post editor (lazy-loaded, BlockNote)
 *   /posts/view/:folderId      → read-only post view (lazy-loaded)
 *   /settings, /account        → redirect into the Account Center overlay
 *                                 (?settings=<section> on top of any route)
 */

import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Routes, Route, Navigate, useLocation, type Location } from "react-router-dom";
import type { PublicSiteProps } from "./landing/PublicSite";
import { LoginPage } from "./pages/LoginPage";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { AuthGoogleCallbackPage } from "./pages/AuthGoogleCallbackPage";
import { RequireAuth } from "./auth/RequireAuth";
import { AppShell } from "./app/components/AppShell";
import { LibraryGridSkeleton } from "./app/components/LibraryGridSkeleton";
import { LobbyPage } from "./app/pages/LobbyPage";
import { DriveDebugPanel } from "./app/components/DriveDebugPanel";
import { SharingHost } from "./app/components/SharingHost";
import { ShortcutsOverlayHost } from "./app/components/ShortcutsOverlay";
import { AccountCenterHost } from "./app/account-center/AccountCenterHost";
import { useSettingsStore } from "./app/stores/settings-store";
import { useDevModeStore } from "./app/services/drive/dev-mode";
import { runMalPosterMigration } from "./app/services/mal-poster-migration";
import { useLocalLibraryStore } from "./app/services/local-library/local-library-store";
import { LocalAccessGate } from "./app/components/LocalAccessGate";
import { useAuth } from "./auth/AuthProvider";
import { useProfileStatsStore } from "./app/stores/profile-stats-store";
import { isSupabaseConfigured } from "./lib/supabase";

// The marketing site pulls in Three.js (animated background), the
// visual-novel landing flow, and its own animation director — none of which
// the authenticated app needs. Split it out so `/app` never pays for it.
const PublicSite = lazy(() =>
  import("./landing/PublicSite").then((m) => ({ default: m.PublicSite })),
);

// Library pages pull in the media-library scanner, folder-poster resolution,
// and the library-hub component tree — split out so the marketing site and
// player routes don't pay for them either.
const AllLibraryPage = lazy(() =>
  import("./app/pages/AllLibraryPage").then((m) => ({ default: m.AllLibraryPage })),
);
const MediaLibraryPage = lazy(() =>
  import("./app/pages/MediaLibraryPage").then((m) => ({ default: m.MediaLibraryPage })),
);
const LibraryUtilityPage = lazy(() =>
  import("./app/pages/LibraryUtilityPage").then((m) => ({ default: m.LibraryUtilityPage })),
);
const LibraryPage = lazy(() =>
  import("./app/pages/LibraryPage").then((m) => ({ default: m.LibraryPage })),
);

// The Social hub pulls in the sharing/social stores and Drive-native
// inbox/shelf views — only needed once the user opens /social.
const SocialPage = lazy(() =>
  import("./app/pages/SocialPage").then((m) => ({ default: m.SocialPage })),
);

// The profile dashboard pulls in the heatmap/badges/social-api surface —
// only needed once the user opens someone's (or their own) `/u/:handle`.
const ProfileDashboardPage = lazy(() =>
  import("./app/pages/ProfileDashboardPage").then((m) => ({ default: m.ProfileDashboardPage })),
);

// Posts feed is a thin list of cards — cheap, but still split out so it
// doesn't ride along with routes that don't need the posts store.
const PostsFeedPage = lazy(() =>
  import("./app/pages/PostsFeedPage").then((m) => ({ default: m.PostsFeedPage })),
);
// The post editor pulls in BlockNote (ProseMirror + Mantine) — by far the
// heaviest chunk in the posts feature. Split separately from the feed/view
// pages so reading a post (or browsing the feed) never pays for the editor.
const PostEditorPage = lazy(() =>
  import("./app/pages/PostEditorPage").then((m) => ({ default: m.PostEditorPage })),
);
// The reader is intentionally BlockNote-free (see PostRenderer's header
// comment) — its own chunk stays light even though it lives next to the
// editor route.
const PostViewPage = lazy(() =>
  import("./app/pages/PostViewPage").then((m) => ({ default: m.PostViewPage })),
);

// Player pulls in EBML, MSE controller, JASSUB (libass), and the MKV subtitle
// pipeline — none of which the lobby needs. Split it out to keep cold-start lean.
const PlayerPage = lazy(() =>
  import("./app/pages/PlayerPage").then((m) => ({ default: m.PlayerPage })),
);

// The EPUB reader pulls in the in-browser unzip + parser; lazy-load it so the
// rest of the app never pays for the reading engine until a book is opened.
const ReaderPage = lazy(() =>
  import("./app/pages/reader/ReaderPage").then((m) => ({ default: m.ReaderPage })),
);

// The music player pulls in the queue/EQ engine (`useMusicEngine`,
// `audio-graph`'s 10-band Web Audio chain, embedded-art/lyrics extraction) —
// none of which the lobby or other libraries need.
const MusicPlayerPage = lazy(() =>
  import("./app/pages/MusicPlayerPage").then((m) => ({ default: m.MusicPlayerPage })),
);

export function App() {
  const location = useLocation();
  const transitionLocation = useViewTransitionLocation(location);

  return (
    <Routes location={transitionLocation}>
      {/* ── Public ─────────────────────────────────────────────────── */}
      <Route path="/" element={<PublicSiteRoute />} />
      <Route path="/login" element={<LoginPage />} />
      {/* Account (Supabase) OAuth return. */}
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      {/* Google DRIVE OAuth return (Drive-access-only; guest + authenticated). */}
      <Route path="/auth/google/callback" element={<AuthGoogleCallbackPage />} />
      <Route path="/terms" element={<PublicSiteRoute forcedView="terms" termsTab="terms" />} />
      <Route path="/privacy" element={<PublicSiteRoute forcedView="terms" termsTab="privacy" />} />
      <Route path="/faq" element={<PublicSiteRoute forcedView="qa" />} />
      <Route path="/contact" element={<PublicSiteRoute forcedView="contact" />} />
      <Route path="/guide" element={<PublicSiteRoute forcedView="download" />} />

      {/* ── Authenticated app ──────────────────────────────────────── */}
      <Route path="/app" element={<Protected><LobbyPage /></Protected>} />
      {/* Unified "All Library" hub (aggregates every content kind). */}
      <Route path="/library" element={<Protected><LibraryRoute><AllLibraryPage /></LibraryRoute></Protected>} />
      <Route path="/library/movies" element={<Protected><LibraryRoute><MediaLibraryPage kind="movies" /></LibraryRoute></Protected>} />
      <Route path="/library/manga" element={<Protected><LibraryRoute><MediaLibraryPage kind="manga" /></LibraryRoute></Protected>} />
      <Route path="/library/light-novel" element={<Protected><LibraryRoute><MediaLibraryPage kind="light-novel" /></LibraryRoute></Protected>} />
      <Route path="/library/music" element={<Protected><LibraryRoute><MediaLibraryPage kind="music" /></LibraryRoute></Protected>} />
      <Route
        path="/music/player"
        element={
          <Protected>
            <LocalAccessGate>
              <Suspense fallback={<ChunkFallback label="Loading music player…" />}>
                <MusicPlayerPage />
              </Suspense>
            </LocalAccessGate>
          </Protected>
        }
      />
      <Route
        path="/music/player/:trackId"
        element={
          <Protected>
            <LocalAccessGate>
              <Suspense fallback={<ChunkFallback label="Loading music player…" />}>
                <MusicPlayerPage />
              </Suspense>
            </LocalAccessGate>
          </Protected>
        }
      />
      <Route path="/library/favorites" element={<Protected><LibraryRoute><LibraryUtilityPage kind="favorites" /></LibraryRoute></Protected>} />
      <Route path="/library/continue" element={<Protected><LibraryRoute><LibraryUtilityPage kind="continue" /></LibraryRoute></Protected>} />
      <Route path="/library/history" element={<Protected><LibraryRoute><LibraryUtilityPage kind="history" /></LibraryRoute></Protected>} />
      <Route path="/library/downloads" element={<Protected><LibraryRoute><LibraryUtilityPage kind="downloads" /></LibraryRoute></Protected>} />
      <Route path="/library/local-folder" element={<Protected><LibraryRoute><LibraryUtilityPage kind="local-folder" /></LibraryRoute></Protected>} />
      <Route path="/library/:folderId" element={<Protected><LibraryRoute><LibraryPage /></LibraryRoute></Protected>} />
      <Route
        path="/play/:folderId/:fileId"
        element={
          <Protected>
            <LocalAccessGate>
              <Suspense fallback={<PlayerChunkFallback />}>
                <PlayerPage />
              </Suspense>
            </LocalAccessGate>
          </Protected>
        }
      />
      {/* Light Novel / EPUB reader. */}
      <Route
        path="/read/:folderId/:fileId"
        element={
          <Protected>
            <LocalAccessGate>
              <Suspense fallback={<ChunkFallback label="Opening reader…" />}>
                <ReaderPage />
              </Suspense>
            </LocalAccessGate>
          </Protected>
        }
      />
      <Route path="/u/:handle" element={<Protected><Suspense fallback={<ChunkFallback label="Loading profile…" />}><ProfileDashboardPage /></Suspense></Protected>} />
      <Route path="/social" element={<Protected><Suspense fallback={<ChunkFallback label="Loading social…" />}><SocialPage /></Suspense></Protected>} />
      <Route path="/social/shelf/:folderId" element={<Protected><Suspense fallback={<ChunkFallback label="Loading social…" />}><SocialPage /></Suspense></Protected>} />
      <Route path="/social/:tab" element={<Protected><Suspense fallback={<ChunkFallback label="Loading social…" />}><SocialPage /></Suspense></Protected>} />
      <Route path="/posts" element={<Protected><Suspense fallback={<ChunkFallback label="Loading posts…" />}><PostsFeedPage /></Suspense></Protected>} />
      <Route path="/posts/new" element={<Protected><Suspense fallback={<ChunkFallback label="Loading editor…" />}><PostEditorPage /></Suspense></Protected>} />
      <Route path="/posts/edit/:folderId" element={<Protected><Suspense fallback={<ChunkFallback label="Loading editor…" />}><PostEditorPage /></Suspense></Protected>} />
      <Route path="/posts/view/:folderId" element={<Protected><Suspense fallback={<ChunkFallback label="Loading post…" />}><PostViewPage /></Suspense></Protected>} />
      {/* Legacy settings/account pages — now sections of the Account Center
          overlay. Redirect keeps old links working; `/app` is the backdrop. */}
      <Route path="/settings" element={<Navigate to="/app?settings=appearance" replace />} />
      <Route path="/account" element={<Navigate to="/app?settings=my-account" replace />} />

      {/* Legacy hash-router deep links (/#/library/...) and unknown paths. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/**
 * Defers rendering the new route until inside `document.startViewTransition()`,
 * producing a cross-fade between pages. Progressive enhancement: falls back to
 * rendering the new location immediately when the API is unavailable, when the
 * pathname hasn't changed (query/hash-only navigation), or when the user
 * prefers reduced motion.
 */
function useViewTransitionLocation(location: Location): Location {
  const [displayLocation, setDisplayLocation] = useState(location);

  useEffect(() => {
    if (location.pathname === displayLocation.pathname) {
      setDisplayLocation(location);
      return;
    }

    const reducedMotion =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      useSettingsStore.getState().settings.reducedMotion;
    if (typeof document.startViewTransition !== "function" || reducedMotion) {
      setDisplayLocation(location);
      return;
    }

    document.startViewTransition(() => {
      flushSync(() => setDisplayLocation(location));
    });
  }, [location, displayLocation]);

  return displayLocation;
}

/** Lazy-loaded marketing site, wrapped in its own Suspense boundary. */
function PublicSiteRoute(props: PublicSiteProps) {
  return (
    <Suspense fallback={<ChunkFallback label="Loading…" />}>
      <PublicSite {...props} />
    </Suspense>
  );
}

/** Lazy-loaded library pages, wrapped in their own Suspense boundary. */
function LibraryRoute({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div style={{ padding: "32px" }}>
          <LibraryGridSkeleton count={10} />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

/**
 * Wraps a protected page in the auth guard + the persistent app chrome, and
 * runs the app's one-shot boot work (dev-mode load + legacy MAL poster
 * migration) once the user is in the authenticated app.
 */
function Protected({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AppShell>
        <AppBootstrap />
        {children}
        <DriveDebugPanel />
        <SharingHost />
        <AccountCenterHost />
        <ShortcutsOverlayHost />
      </AppShell>
    </RequireAuth>
  );
}

function AppBootstrap() {
  const loadDevMode = useDevModeStore((s) => s.load);
  useEffect(() => {
    void loadDevMode();
    void runMalPosterMigration();
    void useLocalLibraryStore.getState().load();
  }, [loadDevMode]);

  const { status, account } = useAuth();
  useEffect(() => {
    if (status !== "authenticated" || !account || !isSupabaseConfigured()) return;
    return useProfileStatsStore.getState().startAutoSync(account.id);
  }, [status, account]);

  return null;
}

function PlayerChunkFallback() {
  return <ChunkFallback label="Loading player…" />;
}

function ChunkFallback({ label }: { label: string }) {
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
      {label}
    </div>
  );
}

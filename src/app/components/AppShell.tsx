/**
 * AppShell — thin wrapper around every protected route.
 *
 * Every page now owns its full chrome: the lobby-style pages compose
 * `LobbyShell` + `LobbySidebar` + `LobbyTopbar` (see `LobbyChrome.tsx`)
 * directly, and the player/reader/music-player routes run full-bleed. AppShell
 * itself renders no header/footer — it only carries the cross-route
 * bootstrapping that used to live alongside the old topbar:
 *   - the pink/cyan app palette (`data-brand` / `data-accent`)
 *   - the social follows/inbox sync, which feeds the Social button badge
 *     wherever `LobbyTopbar` is mounted
 */

import { useEffect, type ReactNode } from "react";
import { useSocialStore } from "../stores/social-store";
import "./AppShell.scss";

export function AppShell({ children }: { children: ReactNode }) {
  useEffect(() => {
    const html = document.documentElement;
    const prevBrand = html.getAttribute("data-brand");
    const prevAccent = html.getAttribute("data-accent");
    html.setAttribute("data-brand", "pink");
    html.setAttribute("data-accent", "cyan");
    return () => {
      if (prevBrand) html.setAttribute("data-brand", prevBrand);
      if (prevAccent) html.setAttribute("data-accent", prevAccent);
    };
  }, []);

  // Social follows/inbox sync — feeds the Social button badge everywhere
  // `LobbyTopbar` is mounted. Zero-cost subscription when nothing's followed.
  const loadFollows = useSocialStore((s) => s.loadFollows);
  const syncInbox = useSocialStore((s) => s.syncInbox);
  useEffect(() => {
    void loadFollows().then(() => {
      const { followedUsers } = useSocialStore.getState();
      if (followedUsers.length > 0) void syncInbox();
    });
  }, [loadFollows, syncInbox]);

  return (
    <div className="dc-shell dc-shell--lobby">
      <main className="dc-lobby-page">{children}</main>
    </div>
  );
}

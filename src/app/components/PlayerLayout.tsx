/**
 * PlayerLayout — two-column wrapper for the player page.
 *
 * At ≥1080px: aside (sidebar) on the right.
 * At <1080px: sidebar moves below the player.
 */

import { type ReactNode } from "react";
import "./PlayerLayout.scss";

interface Props {
  player: ReactNode;
  sidebar: ReactNode;
}

export function PlayerLayout({ player, sidebar }: Props) {
  return (
    <div className="ny-player-layout">
      <div className="ny-player-layout__main">{player}</div>
      <aside className="ny-player-layout__aside">{sidebar}</aside>
    </div>
  );
}

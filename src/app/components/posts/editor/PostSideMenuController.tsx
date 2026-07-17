/**
 * Wraps BlockNote's own SideMenuExtension show/hide signal with a grace
 * period before actually unmounting the toolbar.
 *
 * `@blocknote/react`'s built-in `SideMenuController` renders/unmounts
 * `PostSideMenu` the instant the extension's `state.show` flips to
 * false. That flip comes from raw mouse-coordinate -> block resolution
 * in `SideMenuView` (`@blocknote/core`), which can momentarily fail to
 * resolve a block while the cursor is moving from the block's text
 * toward this toolbar (a real gap for a fast or diagonal mouse path) —
 * once that happens the toolbar is already unmounted before the cursor
 * arrives, so no fix inside `PostSideMenu` itself (freeze-on-hover,
 * positioning offsets) can help: there's nothing left to hover.
 *
 * Instead of reflecting `show` directly, this component keeps showing
 * the last known block for `HIDE_DELAY_MS` after `show` goes false. If
 * hovering resumes within that window — a genuine re-hover, or
 * `PostSideMenu`'s own freeze-on-mouseenter — the pending hide is
 * cancelled. `state.block` itself is untouched by the show/hide toggle
 * (see `SideMenuView.updateStateFromMousePos` in `@blocknote/core`), so
 * it's still the correct block throughout the grace period.
 */

import { useEffect, useRef, useState } from "react";
import { BlockPopover, useExtensionState } from "@blocknote/react";
import { SideMenuExtension } from "@blocknote/core/extensions";
import { offset } from "@floating-ui/react";
import { PostSideMenu } from "./PostSideMenu";

const HIDE_DELAY_MS = 1000;

export function PostSideMenuController() {
  const state = useExtensionState(SideMenuExtension, {
    selector: (s) => (s ? { show: s.show, blockId: s.block.id } : undefined),
  });
  const [visibleBlockId, setVisibleBlockId] = useState<string | undefined>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }

    if (state?.show) {
      setVisibleBlockId(state.blockId);
      return;
    }

    hideTimer.current = setTimeout(() => {
      setVisibleBlockId(undefined);
      hideTimer.current = null;
    }, HIDE_DELAY_MS);

    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [state?.show, state?.blockId]);

  return (
    <BlockPopover
      blockId={visibleBlockId}
      useFloatingOptions={{
        // floating-ui's `open` defaults to `false` when omitted — without
        // this, the popover never mounts at all (isMounted stays false),
        // regardless of `blockId`/hover state.
        open: visibleBlockId !== undefined,
        placement: "left-start",
        middleware: [offset(6)],
      }}
    >
      {visibleBlockId && <PostSideMenu />}
    </BlockPopover>
  );
}

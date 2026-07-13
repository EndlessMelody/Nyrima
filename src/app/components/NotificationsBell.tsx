/**
 * NotificationsBell — topbar dropdown for friend requests + comments on the
 * user's own shares. Distinct from the adjacent Social button, which badges
 * unread share entries from people the user follows.
 *
 * Focus/dismiss model mirrors UserChip exactly: capture-phase outside-click
 * + Escape close, so the two dropdowns behave identically.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Check, X } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { useNotificationsStore } from "../stores/notifications-store";
import "./NotificationsBell.scss";

export function NotificationsBell() {
  const { status, account } = useAuth();
  const myUserId = account?.id;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const items = useNotificationsStore((s) => s.items);
  const loaded = useNotificationsStore((s) => s.loaded);
  const locked = useNotificationsStore((s) => s.locked);
  const unreadCount = useNotificationsStore((s) => s.unreadCount);
  const refresh = useNotificationsStore((s) => s.refresh);
  const markAllSeen = useNotificationsStore((s) => s.markAllSeen);
  const respondToRequest = useNotificationsStore((s) => s.respondToRequest);

  useEffect(() => {
    if (status !== "authenticated" || !myUserId || loaded) return;
    void refresh(myUserId);
  }, [status, myUserId, loaded, refresh]);

  useEffect(() => {
    if (open && myUserId) void refresh(myUserId);
  }, [open, myUserId, refresh]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  const handleMarkAllSeen = useCallback(() => {
    if (myUserId) markAllSeen(myUserId);
  }, [myUserId, markAllSeen]);

  const handleRespond = useCallback(
    (friendshipId: string, action: "accepted" | "blocked") => {
      if (myUserId) void respondToRequest(myUserId, friendshipId, action);
    },
    [myUserId, respondToRequest],
  );

  return (
    <div className="ny-notif-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="ny-command-bar__icon"
        onClick={toggle}
        aria-label="Notifications"
        aria-expanded={open}
        title="Notifications"
      >
        <Bell />
        {unreadCount > 0 && <span className="ny-command-bar__dot" />}
      </button>

      {open && (
        <div ref={panelRef} className="ny-notif-panel" role="dialog" aria-label="Notifications">
          {status !== "authenticated" || locked ? (
            <div className="ny-notif-panel__empty">Sign in to see notifications.</div>
          ) : items.length === 0 ? (
            <div className="ny-notif-panel__empty">You're all caught up.</div>
          ) : (
            <ul className="ny-notif-panel__list">
              {items.map((item) => (
                <li key={item.id} className="ny-notif-row">
                  {item.kind === "friend-request" ? (
                    <>
                      <span className="ny-notif-row__text">
                        <strong>{item.from?.displayName ?? item.from?.handle ?? "Someone"}</strong>{" "}
                        sent you a friend request
                      </span>
                      <div className="ny-notif-row__actions">
                        <button
                          type="button"
                          className="ny-notif-row__btn ny-notif-row__btn--accept"
                          onClick={() => handleRespond(item.friendshipId, "accepted")}
                          aria-label="Accept"
                        >
                          <Check />
                        </button>
                        <button
                          type="button"
                          className="ny-notif-row__btn ny-notif-row__btn--decline"
                          onClick={() => handleRespond(item.friendshipId, "blocked")}
                          aria-label="Decline"
                        >
                          <X />
                        </button>
                      </div>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="ny-notif-row__link"
                      onClick={() => {
                        setOpen(false);
                        navigate("/social/activity");
                      }}
                    >
                      <span className="ny-notif-row__text">
                        <strong>
                          {item.comment.author?.displayName ?? item.comment.author?.handle ?? "Someone"}
                        </strong>{" "}
                        commented: {item.comment.body}
                      </span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="ny-notif-panel__footer">
            <button type="button" className="ny-notif-panel__footer-btn" onClick={handleMarkAllSeen}>
              Mark all read
            </button>
            <button
              type="button"
              className="ny-notif-panel__footer-btn"
              onClick={() => {
                setOpen(false);
                navigate("/social");
              }}
            >
              Open Social
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

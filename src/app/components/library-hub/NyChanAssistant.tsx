/**
 * NyChanAssistant — a draggable, fantasy-styled library guide.
 *
 * A docked Ny-chan bubble can be dragged anywhere inside the viewport; its
 * position is remembered for the session and re-clamped on resize (snapping
 * back to a safe lower-right on small screens). A short drag never opens the
 * chat — only a real click does — and opening the panel keeps the bubble where
 * the user left it. The panel anchors to whichever side of the bubble has room.
 *
 * Search is real: Ny-chan only ever returns indexed library content (Drive
 * libraries + watch history), grouped by media type, with clickable open
 * actions. Anything that touches an unconnected source answers honestly.
 */

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as RPointerEvent, MouseEvent as RMouseEvent } from "react";
import { Send, Sparkles, X } from "lucide-react";
import cn from "classnames";
import { CATEGORY_META } from "./types";
import type { LibraryCategoryKey, SearchResult } from "./types";

interface ChatMessage {
  id: string;
  role: "ny" | "user";
  text: string;
  groups?: Array<{
    type: LibraryCategoryKey;
    label: string;
    results: SearchResult[];
  }>;
}

export interface NyChanContext {
  driveConnected: boolean;
  libraryCount: number;
  latestAnime?: SearchResult;
  latestContinue?: SearchResult;
}

let __nyId = 0;
const nextId = () => `ny-${++__nyId}`;

const BUBBLE = 60;
const MARGIN = 12;
const TOPBAR_SAFE = 72;
const SMALL_SCREEN = 540;
const POS_KEY = "nychan.pos";

interface Pos {
  x: number;
  y: number;
}

function viewport(): { w: number; h: number } {
  if (typeof window === "undefined") return { w: 1280, h: 800 };
  return { w: window.innerWidth, h: window.innerHeight };
}

function clampPos({ x, y }: Pos): Pos {
  const { w, h } = viewport();
  const maxX = Math.max(MARGIN, w - BUBBLE - MARGIN);
  const maxY = Math.max(TOPBAR_SAFE, h - BUBBLE - MARGIN);
  return {
    x: Math.min(Math.max(x, MARGIN), maxX),
    y: Math.min(Math.max(y, TOPBAR_SAFE), maxY),
  };
}

function lowerRight(): Pos {
  const { w, h } = viewport();
  return clampPos({ x: w - BUBBLE - 22, y: h - BUBBLE - 22 });
}

function initialPos(): Pos {
  if (typeof window !== "undefined") {
    try {
      const raw = sessionStorage.getItem(POS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p?.x === "number" && typeof p?.y === "number") {
          return clampPos(p);
        }
      }
    } catch {
      /* ignore */
    }
  }
  return lowerRight();
}

export function NyChanAssistant({
  avatarSrc = "/ny_chan/happy.png",
  search,
  context,
  onOpen,
  onShowAnime,
  quickActions = QUICK_ACTIONS,
}: {
  avatarSrc?: string;
  search: (query: string) => SearchResult[];
  context: NyChanContext;
  onOpen: (result: SearchResult) => void;
  onShowAnime: () => void;
  quickActions?: QuickAction[];
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [pos, setPos] = useState<Pos>(initialPos);
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: nextId(),
      role: "ny",
      text:
        "Hi! I'm Ny-chan. Ask me to find something in your library, like a title, my latest movie, or continue watching.",
    },
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  // Keep the conversation pinned to the latest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  // Persist position for the session.
  useEffect(() => {
    try {
      sessionStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch {
      /* ignore */
    }
  }, [pos]);

  // Re-clamp on resize; snap home on small screens so it never strands.
  useEffect(() => {
    const onResize = () => {
      setPos((p) => (viewport().w < SMALL_SCREEN ? lowerRight() : clampPos(p)));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // --- Drag handlers (pointer) ---------------------------------------------
  const onPointerDown = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: RPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) > 4) d.moved = true;
    if (d.moved) setPos(clampPos({ x: d.ox + dx, y: d.oy + dy }));
  };
  const onPointerUp = (e: RPointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (d?.moved) suppressClick.current = true; // a drag must not toggle chat
  };
  const onBubbleClick = (e: RMouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      e.preventDefault();
      return;
    }
    setOpen((v) => !v);
  };

  // --- Chat engine ---------------------------------------------------------
  const push = (msg: Omit<ChatMessage, "id">) =>
    setMessages((m) => [...m, { ...msg, id: nextId() }]);

  const groupResults = (results: SearchResult[]) => {
    const byType = new Map<LibraryCategoryKey, SearchResult[]>();
    for (const r of results) {
      const arr = byType.get(r.type) ?? [];
      arr.push(r);
      byType.set(r.type, arr);
    }
    return [...byType.entries()].map(([type, rs]) => ({
      type,
      label: CATEGORY_META[type].name,
      results: rs.slice(0, 5),
    }));
  };

  const answer = (query: string) => {
    const results = search(query);
    if (results.length === 0) {
      push({
        role: "ny",
        text: `I couldn't find anything matching “${query}” in your library yet. Try another title, or connect more sources.`,
      });
      return;
    }
    const groups = groupResults(results);
    const text =
      groups.length > 1
        ? `I found matches for “${query}” across ${groups.length} types — which would you like to open?`
        : `Here's what I found for “${query}”:`;
    push({ role: "ny", text, groups });
  };

  const submit = (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    push({ role: "user", text: q });
    setInput("");
    answer(q);
  };

  const runQuick = (action: QuickAction) => {
    push({ role: "user", text: action.label });
    if (action.query != null) {
      if (action.query.trim()) answer(action.query);
      else push({ role: "ny", text: "Tell me what title to search for and I'll check the indexed library only." });
      return;
    }
    switch (action.id) {
      case "latest-anime":
        if (!context.driveConnected) {
          push({ role: "ny", text: "Connect Google Drive and I'll surface your latest movie right away." });
        } else if (context.latestAnime) {
          push({
            role: "ny",
            text: "Your most recently updated library:",
            groups: [{ type: context.latestAnime.type, label: CATEGORY_META[context.latestAnime.type].name, results: [context.latestAnime] }],
          });
        } else {
          push({ role: "ny", text: "I don't see any indexed movie files yet." });
        }
        break;
      case "continue":
        if (context.latestContinue) {
          push({
            role: "ny",
            text: "Let's pick up where you left off:",
            groups: [
              {
                type: context.latestContinue.type,
                label: CATEGORY_META[context.latestContinue.type].name,
                results: [context.latestContinue],
              },
            ],
          });
        } else {
          push({ role: "ny", text: "You don't have anything in progress right now — start something and it'll show up here." });
        }
        break;
      case "browse-anime":
        if (!context.driveConnected || context.libraryCount === 0) {
          push({ role: "ny", text: "There aren't any indexed movie files to browse yet." });
        } else {
          onShowAnime();
          push({ role: "ny", text: `Filtering the grid to your indexed movies.` });
        }
        break;
      case "find-gimai":
        answer("Gimai Seikatsu");
        break;
      case "music":
        push({ role: "ny", text: "Music results come from indexed audio files inside Nyrima/Music." });
        break;
      default:
        push({ role: "ny", text: "That shortcut needs indexed source data before I can show results." });
        break;
    }
  };

  // Anchor the panel toward the side of the bubble with the most room.
  const { w, h } = viewport();
  const centerX = pos.x + BUBBLE / 2;
  const centerY = pos.y + BUBBLE / 2;
  const openUp = centerY > h / 2;
  const alignRight = centerX > w / 2;

  return (
    <div
      className={cn("nychan", {
        "is-open": open,
        "is-up": openUp,
        "is-down": !openUp,
        "is-right": alignRight,
        "is-left": !alignRight,
      })}
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
    >
      {open && (
        <section className="nychan__panel" role="dialog" aria-label="Ny-chan library assistant">
          <header className="nychan__head">
            <span className="nychan__avatar" aria-hidden="true">
              <img src={avatarSrc} alt="" />
            </span>
            <span className="nychan__id">
              <span className="nychan__name">Ny-chan</span>
              <span className="nychan__role">Library guide</span>
            </span>
            <button
              type="button"
              className="nychan__close ny-focusable"
              onClick={() => setOpen(false)}
              aria-label="Minimize Ny-chan"
            >
              <X aria-hidden="true" />
            </button>
          </header>

          <div className="nychan__scroll" ref={scrollRef}>
            {messages.map((m) => (
              <div key={m.id} className={cn("nychan__msg", `nychan__msg--${m.role}`)}>
                {m.role === "ny" && (
                  <span className="nychan__msg-avatar" aria-hidden="true">
                    <img src={avatarSrc} alt="" />
                  </span>
                )}
                <div className="nychan__bubble">
                  <p>{m.text}</p>
                  {m.groups && (
                    <div className="nychan__results">
                      {m.groups.map((g) => (
                        <div key={g.type} className="nychan__group">
                          {(m.groups?.length ?? 0) > 1 && (
                            <span className="nychan__group-label" data-cat={g.type}>
                              {g.label}
                            </span>
                          )}
                          {g.results.map((r) => (
                            <button
                              key={r.key}
                              type="button"
                              className="nychan__result ny-focusable"
                              data-cat={r.type}
                              onClick={() => onOpen(r)}
                            >
                              <span className="nychan__result-title">{r.title}</span>
                              {r.subtitle && (
                                <span className="nychan__result-sub">{r.subtitle}</span>
                              )}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="nychan__quick" role="group" aria-label="Suggestions">
            {QUICK_ACTIONS.map((a) => (
              <button
                key={a.id}
                type="button"
                className="nychan__chip ny-focusable"
                onClick={() => runQuick(a)}
              >
                {a.label}
              </button>
            ))}
          </div>

          <form
            className="nychan__input"
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Ny-chan to find something…"
              aria-label="Message Ny-chan"
            />
            <button type="submit" className="nychan__send ny-focusable" aria-label="Send">
              <Send aria-hidden="true" />
            </button>
          </form>
        </section>
      )}

      <button
        type="button"
        className="nychan__bubble-btn ny-focusable"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={onBubbleClick}
        aria-label={open ? "Close Ny-chan" : "Open Ny-chan assistant (drag to move)"}
        aria-expanded={open}
      >
        <span className="nychan__bubble-glow" aria-hidden="true" />
        <img src={avatarSrc} alt="" draggable={false} />
        {!open && (
          <span className="nychan__bubble-spark" aria-hidden="true">
            <Sparkles />
          </span>
        )}
      </button>
    </div>
  );
}

type QuickActionId =
  | "latest-anime"
  | "continue"
  | "browse-anime"
  | "find-gimai"
  | "music"
  | string;

interface QuickAction {
  id: QuickActionId;
  label: string;
  query?: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  { id: "latest-anime", label: "Find my latest movie" },
  { id: "continue", label: "Continue watching" },
  { id: "browse-anime", label: "Show movies" },
  { id: "find-gimai", label: "Find Gimai Seikatsu" },
  { id: "music", label: "Open last played music" },
];

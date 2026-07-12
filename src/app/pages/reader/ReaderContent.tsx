/**
 * ReaderContent — the reading canvas.
 *
 * Owns the scroll element and (in paged mode) the column-paging transform. It
 * is deliberately quiet: a centered, width-constrained prose column, a small
 * centered chapter header, one bookmark affordance top-right, and a slim
 * progress readout bottom-right. Everything else is chrome the sidebar owns.
 *
 * The page drives it through an imperative handle (next/prev page, scroll to a
 * ratio/fragment) because page navigation has to coordinate with chapter
 * boundaries that only the page knows about.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Trash2 } from "lucide-react";
import type { ReaderPrefs } from "../../services/reader/reader-prefs";
import { fontStack, HIGHLIGHT_COLORS } from "../../services/reader/reader-prefs";
import type { ReaderHighlight } from "../../services/reader/reader-storage";
import {
  applyHighlights,
  clearHighlights,
  getSelectionOffsets,
  type SelectionOffsets,
} from "./highlight-dom";

const FOCUS_SELECTOR = "p, h1, h2, h3, h4, h5, h6, blockquote, li";

export interface ReaderContentHandle {
  /** Advance one page; returns false when already at the chapter end. */
  nextPage: () => boolean;
  /** Go back one page; returns false when already at the chapter start. */
  prevPage: () => boolean;
  scrollToRatio: (ratio: number) => void;
  scrollToFragment: (id: string) => void;
  scrollToTop: () => void;
  scrollToBottom: () => void;
  getProseElement: () => HTMLElement | null;
  /** Index of the first block element currently in view (for TTS start). */
  getActiveBlockIndex: (blocks: HTMLElement[]) => number;
}

interface ReaderContentProps {
  html: string;
  prefs: ReaderPrefs;
  bookTitle: string;
  chapterLabel: string;
  metaLine: string;
  percent: number;
  loading: boolean;
  /** Image-only pages (cover/inserts) render without the chapter header so the
   *  illustration reads as part of the book, not a ghost titled section. */
  hideHeader: boolean;
  /** Highlights for the current chapter (offset-anchored). */
  highlights: ReaderHighlight[];
  onCreateHighlight: (payload: { start: number; end: number; text: string; color: string }) => void;
  onUpdateHighlight: (id: string, patch: Partial<Pick<ReaderHighlight, "color" | "note">>) => void;
  onRemoveHighlight: (id: string) => void;
  onScrollRatio: (ratio: number) => void;
  onInternalLink: (href: string, fragment: string | undefined) => void;
  /** Notified after a chapter's HTML mounts so the page can restore position. */
  onChapterMounted: () => void;
}

export const ReaderContent = forwardRef<ReaderContentHandle, ReaderContentProps>(
  function ReaderContent(props, ref) {
    const {
      html,
      prefs,
      bookTitle,
      chapterLabel,
      metaLine,
      percent,
      loading,
      hideHeader,
      highlights,
      onCreateHighlight,
      onUpdateHighlight,
      onRemoveHighlight,
      onScrollRatio,
      onInternalLink,
      onChapterMounted,
    } = props;

    const canvasRef = useRef<HTMLDivElement>(null);
    const proseRef = useRef<HTMLDivElement>(null);
    const paged = prefs.mode === "paged";
    const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
    const [lightboxZoom, setLightboxZoom] = useState(false);
    // Highlight selection toolbar + per-mark editor popover.
    const [selUi, setSelUi] = useState<{ x: number; y: number; offsets: SelectionOffsets } | null>(null);
    const [editId, setEditId] = useState<string | null>(null);
    const [editPos, setEditPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

    const [pageIndex, setPageIndex] = useState(0);
    const [pageCount, setPageCount] = useState(1);
    const pageIndexRef = useRef(0);
    const pageCountRef = useRef(1);
    pageIndexRef.current = pageIndex;
    pageCountRef.current = pageCount;

    // --- Paged layout measurement -----------------------------------------
    const measurePages = useCallback(() => {
      const prose = proseRef.current;
      const canvas = canvasRef.current;
      if (!prose || !canvas || !paged) return;
      const colWidth = prose.clientWidth;
      const gap = parseFloat(getComputedStyle(prose).columnGap || "0") || 0;
      const total = prose.scrollWidth;
      const count = Math.max(1, Math.round((total + gap) / (colWidth + gap)));
      pageCountRef.current = count;
      setPageCount(count);
      const clamped = Math.min(pageIndexRef.current, count - 1);
      setPageIndex(clamped);
      applyPageTransform(clamped, colWidth, gap);
    }, [paged]);

    const applyPageTransform = (index: number, colWidth: number, gap: number) => {
      const prose = proseRef.current;
      if (!prose) return;
      prose.style.transform = `translateX(${-index * (colWidth + gap)}px)`;
    };

    const goToPage = useCallback(
      (index: number) => {
        const prose = proseRef.current;
        if (!prose) return;
        const colWidth = prose.clientWidth;
        const gap = parseFloat(getComputedStyle(prose).columnGap || "0") || 0;
        const clamped = Math.max(0, Math.min(index, pageCountRef.current - 1));
        setPageIndex(clamped);
        pageIndexRef.current = clamped;
        applyPageTransform(clamped, colWidth, gap);
        const denom = Math.max(1, pageCountRef.current - 1);
        onScrollRatio(clamped / denom);
      },
      [onScrollRatio],
    );

    // Re-measure paged layout when content, typography, or size changes.
    useLayoutEffect(() => {
      if (!paged) return;
      // Reset transform before measuring a fresh chapter.
      if (proseRef.current) proseRef.current.style.transform = "translateX(0)";
      pageIndexRef.current = 0;
      setPageIndex(0);
      const raf = requestAnimationFrame(() => measurePages());
      return () => cancelAnimationFrame(raf);
    }, [html, paged, prefs.fontSize, prefs.lineHeight, prefs.pageWidth, prefs.margin, prefs.fontFamily, prefs.paragraphSpacing, measurePages]);

    useEffect(() => {
      if (!paged) return;
      const ro = new ResizeObserver(() => measurePages());
      if (canvasRef.current) ro.observe(canvasRef.current);
      return () => ro.disconnect();
    }, [paged, measurePages]);

    // Late-loading images shift layout — recount pages when one finishes.
    useEffect(() => {
      const prose = proseRef.current;
      if (!prose) return;
      const onLoad = (e: Event) => {
        if ((e.target as HTMLElement)?.tagName === "IMG" && paged) measurePages();
      };
      prose.addEventListener("load", onLoad, true);
      return () => prose.removeEventListener("load", onLoad, true);
    }, [paged, measurePages, html]);

    // --- Scroll-mode progress reporting -----------------------------------
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas || paged) return;
      let raf = 0;
      const onScroll = () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          const denom = canvas.scrollHeight - canvas.clientHeight;
          onScrollRatio(denom > 0 ? canvas.scrollTop / denom : 0);
        });
      };
      canvas.addEventListener("scroll", onScroll, { passive: true });
      return () => {
        canvas.removeEventListener("scroll", onScroll);
        cancelAnimationFrame(raf);
      };
    }, [paged, onScrollRatio, html]);

    // Notify the page once a chapter's markup is in the DOM (restore hook).
    // Skip the initial empty render so a pending resume target isn't consumed
    // before the real chapter HTML mounts.
    useLayoutEffect(() => {
      if (!html) return;
      onChapterMounted();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [html]);

    // --- Internal link interception + image lightbox ----------------------
    useEffect(() => {
      const prose = proseRef.current;
      if (!prose) return;
      const onClick = (e: MouseEvent) => {
        const el = e.target as HTMLElement;
        // Tapping an existing highlight opens its editor.
        const mark = el?.closest?.("mark.reader-hl");
        if (mark) {
          const id = mark.getAttribute("data-hl-id");
          if (id) {
            e.preventDefault();
            setSelUi(null);
            setEditPos({ x: e.clientX, y: e.clientY });
            setEditId(id);
            return;
          }
        }
        // Tapping an illustration opens the fullscreen viewer.
        const img = el?.closest?.("img") as HTMLImageElement | null;
        if (img && img.src) {
          e.preventDefault();
          setLightboxZoom(false);
          setLightboxSrc(img.src);
          return;
        }
        const anchor = el?.closest?.("a[data-epub-href], a[data-epub-fragment]");
        if (!anchor) return;
        const href = anchor.getAttribute("data-epub-href") ?? "";
        const fragment = anchor.getAttribute("data-epub-fragment") ?? undefined;
        if (!href && !fragment) return;
        e.preventDefault();
        onInternalLink(href, fragment);
      };
      prose.addEventListener("click", onClick);
      return () => prose.removeEventListener("click", onClick);
    }, [onInternalLink, html]);

    // --- Focus mode: spotlight the paragraph nearest the viewport centre ---
    useEffect(() => {
      const canvas = canvasRef.current;
      const prose = proseRef.current;
      if (!canvas || !prose) return;
      if (!prefs.focusMode) {
        prose
          .querySelectorAll(".reader-focus-on")
          .forEach((el) => el.classList.remove("reader-focus-on"));
        return;
      }
      let raf = 0;
      let active: Element | null = null;
      const update = () => {
        const blocks = prose.querySelectorAll<HTMLElement>(FOCUS_SELECTOR);
        if (blocks.length === 0) return;
        const mid = canvas.getBoundingClientRect().top + canvas.clientHeight / 2;
        let best: HTMLElement | null = null;
        let bestDist = Infinity;
        for (const b of blocks) {
          const r = b.getBoundingClientRect();
          const dist = Math.abs(r.top + r.height / 2 - mid);
          if (dist < bestDist) {
            bestDist = dist;
            best = b;
          }
        }
        if (best && best !== active) {
          active?.classList.remove("reader-focus-on");
          best.classList.add("reader-focus-on");
          active = best;
        }
      };
      const onScroll = () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(update);
      };
      update();
      canvas.addEventListener("scroll", onScroll, { passive: true });
      return () => {
        canvas.removeEventListener("scroll", onScroll);
        cancelAnimationFrame(raf);
        active?.classList.remove("reader-focus-on");
      };
    }, [prefs.focusMode, html, paged]);

    // Close the lightbox on Escape (taking priority over the page handler).
    useEffect(() => {
      if (!lightboxSrc) return;
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          setLightboxSrc(null);
        }
      };
      window.addEventListener("keydown", onKey, true);
      return () => window.removeEventListener("keydown", onKey, true);
    }, [lightboxSrc]);

    // --- Highlights: paint marks for the current chapter ------------------
    useLayoutEffect(() => {
      const prose = proseRef.current;
      if (!prose) return;
      clearHighlights(prose);
      if (highlights.length > 0) {
        applyHighlights(
          prose,
          highlights.map((h) => ({ id: h.id, start: h.start, end: h.end, color: h.color })),
        );
      }
    }, [html, highlights]);

    // Surface the highlight toolbar after a text selection inside the prose.
    useEffect(() => {
      const prose = proseRef.current;
      if (!prose) return;
      const onUp = () => {
        window.setTimeout(() => {
          const offsets = getSelectionOffsets(prose);
          const sel = window.getSelection();
          const rect = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).getBoundingClientRect() : null;
          if (!offsets || !rect || rect.width === 0) {
            setSelUi(null);
            return;
          }
          setSelUi({ x: rect.left + rect.width / 2, y: rect.top, offsets });
        }, 0);
      };
      prose.addEventListener("mouseup", onUp);
      return () => prose.removeEventListener("mouseup", onUp);
    }, [html]);

    // Dismiss the toolbar / editor on outside click, scroll, or Escape.
    useEffect(() => {
      if (!selUi && !editId) return;
      const close = () => {
        setSelUi(null);
        setEditId(null);
      };
      const onDown = (e: MouseEvent) => {
        const t = e.target as HTMLElement;
        if (t.closest?.(".reader-hl-pop") || t.closest?.("mark.reader-hl")) return;
        close();
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      };
      const canvas = canvasRef.current;
      window.addEventListener("mousedown", onDown, true);
      window.addEventListener("keydown", onKey, true);
      canvas?.addEventListener("scroll", close, { passive: true });
      return () => {
        window.removeEventListener("mousedown", onDown, true);
        window.removeEventListener("keydown", onKey, true);
        canvas?.removeEventListener("scroll", close);
      };
    }, [selUi, editId]);

    // --- Imperative handle -------------------------------------------------
    useImperativeHandle(
      ref,
      (): ReaderContentHandle => ({
        nextPage: () => {
          if (paged) {
            if (pageIndexRef.current >= pageCountRef.current - 1) return false;
            goToPage(pageIndexRef.current + 1);
            return true;
          }
          const canvas = canvasRef.current;
          if (!canvas) return false;
          const max = canvas.scrollHeight - canvas.clientHeight;
          if (canvas.scrollTop >= max - 2) return false;
          canvas.scrollBy({ top: canvas.clientHeight * 0.9, behavior: "smooth" });
          return true;
        },
        prevPage: () => {
          if (paged) {
            if (pageIndexRef.current <= 0) return false;
            goToPage(pageIndexRef.current - 1);
            return true;
          }
          const canvas = canvasRef.current;
          if (!canvas) return false;
          if (canvas.scrollTop <= 2) return false;
          canvas.scrollBy({ top: -canvas.clientHeight * 0.9, behavior: "smooth" });
          return true;
        },
        scrollToRatio: (ratio) => {
          if (paged) {
            const target = Math.round(ratio * Math.max(0, pageCountRef.current - 1));
            goToPage(target);
            return;
          }
          const canvas = canvasRef.current;
          if (!canvas) return;
          const denom = canvas.scrollHeight - canvas.clientHeight;
          canvas.scrollTop = denom > 0 ? ratio * denom : 0;
        },
        scrollToFragment: (id) => {
          const prose = proseRef.current;
          const canvas = canvasRef.current;
          if (!prose || !canvas) return;
          const el =
            prose.querySelector(`#${cssEscape(id)}`) ??
            prose.querySelector(`[name="${cssEscape(id)}"]`);
          if (!el) return;
          if (paged) {
            const rect = (el as HTMLElement).getBoundingClientRect();
            const proseRect = prose.getBoundingClientRect();
            const x = rect.left - proseRect.left + Math.abs(currentTranslate(prose));
            const colWidth = prose.clientWidth;
            const gap = parseFloat(getComputedStyle(prose).columnGap || "0") || 0;
            goToPage(Math.round(x / (colWidth + gap)));
          } else {
            (el as HTMLElement).scrollIntoView({ block: "start" });
          }
        },
        scrollToTop: () => {
          if (paged) goToPage(0);
          else if (canvasRef.current) canvasRef.current.scrollTop = 0;
        },
        scrollToBottom: () => {
          if (paged) goToPage(pageCountRef.current - 1);
          else if (canvasRef.current)
            canvasRef.current.scrollTop = canvasRef.current.scrollHeight;
        },
        getProseElement: () => proseRef.current,
        getActiveBlockIndex: (blocks) => {
          const canvas = canvasRef.current;
          if (!canvas || blocks.length === 0) return 0;
          const canvasRect = canvas.getBoundingClientRect();
          for (let i = 0; i < blocks.length; i++) {
            const r = blocks[i]!.getBoundingClientRect();
            if (paged) {
              if (r.left >= canvasRect.left - 4) return i;
            } else if (r.bottom >= canvasRect.top + 8) {
              return i;
            }
          }
          return 0;
        },
      }),
      [paged, goToPage],
    );

    const columnStyle: CSSProperties = {
      ["--reader-font" as string]: fontStack(prefs.fontFamily),
      ["--reader-size" as string]: `${prefs.fontSize}px`,
      ["--reader-weight" as string]: String(prefs.fontWeight),
      ["--reader-leading" as string]: String(prefs.lineHeight),
      ["--reader-para-gap" as string]: `${prefs.paragraphSpacing}em`,
      ["--reader-width" as string]: `${prefs.pageWidth}px`,
      ["--reader-pad" as string]: `${prefs.margin}px`,
      textAlign: prefs.justify ? "justify" : "left",
    };

    return (
      <div
        className="reader-canvas"
        data-mode={prefs.mode}
        ref={canvasRef}
      >
        <article className="reader-column" style={columnStyle}>
          {!hideHeader && (
            <header className="reader-chapter-head">
              <p className="reader-chapter-head__book">{bookTitle}</p>
              <h1 className="reader-chapter-head__title">{chapterLabel}</h1>
              {metaLine && <p className="reader-chapter-head__meta">{metaLine}</p>}
              <span className="reader-chapter-head__rule" aria-hidden />
            </header>
          )}

          <div
            ref={proseRef}
            className={`reader-prose${loading ? " is-loading" : ""}`}
            data-para={prefs.paragraphStyle}
            data-focus={prefs.focusMode ? "1" : "0"}
            // The HTML is sanitized in epub-parser.sanitizeAndRewire (scripts,
            // styles, event handlers, and color/font inline styles stripped;
            // images rewired to in-memory blob URLs) before it ever reaches
            // this prop.
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </article>

        <div className="reader-progress-readout" aria-hidden>
          {percent}%
        </div>

        {lightboxSrc && (
          <div
            className="reader-lightbox"
            role="dialog"
            aria-label="Illustration"
            onClick={() => setLightboxSrc(null)}
          >
            <img
              src={lightboxSrc}
              alt=""
              className={`reader-lightbox__img${lightboxZoom ? " is-zoomed" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setLightboxZoom((z) => !z);
              }}
            />
            <span className="reader-lightbox__hint" aria-hidden>
              Click to {lightboxZoom ? "fit" : "zoom"} · Esc to close
            </span>
          </div>
        )}

        {selUi && (
          <div
            className="reader-hl-pop reader-hl-tools"
            style={{ left: selUi.x, top: selUi.y }}
          >
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                className="reader-hl-dot"
                style={{ background: c.value }}
                aria-label={`Highlight ${c.label}`}
                title={`Highlight ${c.label}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onCreateHighlight({
                    start: selUi.offsets.start,
                    end: selUi.offsets.end,
                    text: selUi.offsets.text,
                    color: c.id,
                  });
                  window.getSelection()?.removeAllRanges();
                  setSelUi(null);
                }}
              />
            ))}
          </div>
        )}

        {editId &&
          (() => {
            const hl = highlights.find((h) => h.id === editId);
            if (!hl) return null;
            return (
              <HighlightEditor
                key={hl.id}
                highlight={hl}
                x={editPos.x}
                y={editPos.y}
                onColor={(color) => onUpdateHighlight(hl.id, { color })}
                onNote={(note) => onUpdateHighlight(hl.id, { note })}
                onDelete={() => {
                  onRemoveHighlight(hl.id);
                  setEditId(null);
                }}
              />
            );
          })()}
      </div>
    );
  },
);

function HighlightEditor({
  highlight,
  x,
  y,
  onColor,
  onNote,
  onDelete,
}: {
  highlight: ReaderHighlight;
  x: number;
  y: number;
  onColor: (color: string) => void;
  onNote: (note: string) => void;
  onDelete: () => void;
}) {
  const [note, setNote] = useState(highlight.note ?? "");
  return (
    <div className="reader-hl-pop reader-hl-editor" style={{ left: x, top: y }}>
      <div className="reader-hl-colors">
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`reader-hl-dot${highlight.color === c.id ? " is-active" : ""}`}
            style={{ background: c.value }}
            aria-label={c.label}
            title={c.label}
            onClick={() => onColor(c.id)}
          />
        ))}
        <button type="button" className="reader-hl-del" onClick={onDelete} aria-label="Delete highlight" title="Delete">
          <Trash2 aria-hidden />
        </button>
      </div>
      <textarea
        className="reader-hl-note"
        placeholder="Add a note…"
        rows={3}
        value={note}
        autoFocus
        onChange={(e) => {
          setNote(e.target.value);
          onNote(e.target.value);
        }}
      />
    </div>
  );
}

function currentTranslate(el: HTMLElement): number {
  const t = el.style.transform.match(/translateX\((-?[\d.]+)px\)/);
  return t ? parseFloat(t[1]!) : 0;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

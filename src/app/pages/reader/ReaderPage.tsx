/**
 * ReaderPage — the Light Novel / EPUB reading experience.
 *
 * Two columns: a calm left tool rail (ReaderSidebar) and the reading canvas
 * (ReaderContent). This component is the orchestrator — it loads the book,
 * renders chapters, owns navigation/progress/persistence, and wires the
 * sidebar tools (typography, TTS, bookmarks, TOC, search) plus a keyboard-first
 * shortcut layer. It deliberately avoids the app's heavy player chrome; the
 * route renders full-bleed (see AppShell's immersive branch).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2, TriangleAlert } from "lucide-react";
import { isDriveId } from "@shared/drive-id";
import { isLocalId } from "@shared/local-id";
import { loadBookFromDrive, loadBookFromLocal, type EpubBook } from "../../services/epub";
import {
  clamp,
  readerTheme,
  type ReaderPrefs,
} from "../../services/reader/reader-prefs";
import {
  getBookmarks,
  getHighlights,
  getReaderProgress,
  saveBookmarks,
  saveHighlights,
  saveReaderProgress,
  type ReaderBookmark,
  type ReaderHighlight,
} from "../../services/reader/reader-storage";
import { resolveReaderAction } from "../../services/reader/reader-shortcuts";
import { useReaderPrefsStore } from "../../stores/reader-prefs-store";
import { useTextToSpeech } from "../../hooks/useTextToSpeech";
import { ReaderSidebar, type SearchHit, type SectionId } from "./ReaderSidebar";
import { ReaderContent, type ReaderContentHandle } from "./ReaderContent";
import { ReaderShortcutsModal } from "./ReaderShortcutsModal";
import "./reader-fonts";
import "./ReaderPage.scss";

const BLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6, blockquote, li";
const PROGRESS_SAVE_DELAY = 700;
const MAX_SEARCH_RESULTS = 120;

interface RestoreTarget {
  ratio?: number;
  fragment?: string;
  atBottom?: boolean;
}

export function ReaderPage() {
  const params = useParams();
  const navigate = useNavigate();
  const fileId = params.fileId ?? "";
  const folderId = params.folderId ?? "";
  const validId = isDriveId(fileId) || isLocalId(fileId);

  const prefs = useReaderPrefsStore((s) => s.prefs);
  const patchPrefs = useReaderPrefsStore((s) => s.patch);
  const resetPrefs = useReaderPrefsStore((s) => s.reset);
  const loadPrefs = useReaderPrefsStore((s) => s.load);

  const tts = useTextToSpeech();

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [book, setBook] = useState<EpubBook | null>(null);
  const [fileName, setFileName] = useState("");
  const [chapterIndex, setChapterIndex] = useState(0);
  const [chapterHtml, setChapterHtml] = useState("");
  const [chapterLoading, setChapterLoading] = useState(false);
  const [percent, setPercent] = useState(0);

  // At most one tool panel open at a time; none on first display so the page
  // starts quiet (per product direction).
  const [openSection, setOpenSection] = useState<SectionId | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Chrome (rail + progress) fades out while the reader is idle so the page is
  // pure text; any mouse/key activity brings it back.
  const [chromeIdle, setChromeIdle] = useState(false);
  const [bookmarks, setBookmarks] = useState<ReaderBookmark[]>([]);
  const [highlights, setHighlights] = useState<ReaderHighlight[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [reading, setReading] = useState(false);

  const bookRef = useRef<EpubBook | null>(null);
  const contentRef = useRef<ReaderContentHandle>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<RestoreTarget | null>(null);
  const chapterIndexRef = useRef(0);
  const scrollRatioRef = useRef(0);
  const progressTimerRef = useRef<number>(0);
  const ttsBlocksRef = useRef<HTMLElement[]>([]);
  const ttsActiveElRef = useRef<HTMLElement | null>(null);
  const ttsContinueRef = useRef(false);

  chapterIndexRef.current = chapterIndex;

  const theme = readerTheme(prefs.theme);

  // --- Boot: prefs + book -------------------------------------------------
  useEffect(() => {
    void loadPrefs();
  }, [loadPrefs]);

  useEffect(() => {
    if (!validId) {
      setStatus("error");
      setErrorMsg("This book link is invalid.");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setChapterHtml("");
    // No AbortController here on purpose. The Drive download is de-duplicated by
    // file id (see drive-api `inflight`); under React 18 StrictMode the effect
    // mounts twice, and aborting the first mount's request would poison the
    // shared in-flight promise the surviving mount is awaiting — the reader
    // would then fail to open in dev. We instead let the download finish (it
    // caches for instant reopen) and use the `cancelled` flag to ignore a
    // result that arrives after unmount.
    void (async () => {
      try {
        const progress = await getReaderProgress(fileId);
        const loaded = isLocalId(fileId)
          ? await loadBookFromLocal(fileId)
          : await loadBookFromDrive(fileId);
        if (cancelled) {
          loaded.book.dispose();
          return;
        }
        bookRef.current = loaded.book;
        setBook(loaded.book);
        setFileName(loaded.fileName);
        const marks = await getBookmarks(fileId);
        if (cancelled) return;
        setBookmarks(marks);
        const hls = await getHighlights(fileId);
        if (cancelled) return;
        setHighlights(hls);
        const startChapter = clamp(
          progress?.chapterIndex ?? 0,
          0,
          Math.max(0, loaded.book.chapters.length - 1),
        );
        restoreRef.current = { ratio: progress?.scrollRatio ?? 0 };
        scrollRatioRef.current = progress?.scrollRatio ?? 0;
        setPercent(progress?.percent ?? 0);
        setChapterIndex(startChapter);
        chapterIndexRef.current = startChapter;
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(e instanceof Error ? e.message : "Could not open this book.");
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(progressTimerRef.current);
      if (tts.supported) tts.stop();
      bookRef.current?.dispose();
      bookRef.current = null;
    };
    // tts intentionally excluded — stop() is stable and we only want this on id change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, validId]);

  // --- Render the current chapter ----------------------------------------
  useEffect(() => {
    const current = bookRef.current;
    if (!current || status !== "ready") return;
    let cancelled = false;
    setChapterLoading(true);
    clearTtsHighlight();
    void (async () => {
      const html = await current.renderChapter(chapterIndex);
      if (cancelled) return;
      setChapterHtml(html);
      setChapterLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [chapterIndex, status]);

  // --- Progress reporting -------------------------------------------------
  const scheduleProgressSave = useCallback(() => {
    window.clearTimeout(progressTimerRef.current);
    progressTimerRef.current = window.setTimeout(() => {
      const current = bookRef.current;
      if (!current) return;
      void saveReaderProgress({
        fileId,
        chapterIndex: chapterIndexRef.current,
        scrollRatio: scrollRatioRef.current,
        percent,
        title: current.title || fileName,
        folderId: folderId || undefined,
      });
    }, PROGRESS_SAVE_DELAY);
  }, [fileId, folderId, fileName, percent]);

  const handleScrollRatio = useCallback(
    (ratio: number) => {
      scrollRatioRef.current = clamp(ratio, 0, 1);
      const total = bookRef.current?.chapters.length ?? 1;
      const pct = Math.round(((chapterIndexRef.current + clamp(ratio, 0, 1)) / total) * 100);
      setPercent(clamp(pct, 0, 100));
      scheduleProgressSave();
    },
    [scheduleProgressSave],
  );

  // --- Restore position once a chapter mounts ----------------------------
  const refreshTtsBlocks = useCallback(() => {
    const prose = contentRef.current?.getProseElement();
    if (!prose) {
      ttsBlocksRef.current = [];
      return;
    }
    ttsBlocksRef.current = Array.from(
      prose.querySelectorAll<HTMLElement>(BLOCK_SELECTOR),
    ).filter((el) => (el.textContent ?? "").trim().length > 0);
  }, []);

  const handleChapterMounted = useCallback(() => {
    const target = restoreRef.current;
    restoreRef.current = null;
    const content = contentRef.current;
    refreshTtsBlocks();
    requestAnimationFrame(() => {
      if (!content) return;
      if (target?.fragment) content.scrollToFragment(target.fragment);
      else if (target?.atBottom) content.scrollToBottom();
      else content.scrollToRatio(target?.ratio ?? 0);
    });
    if (ttsContinueRef.current) {
      ttsContinueRef.current = false;
      requestAnimationFrame(() => startReadingFrom(0));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTtsBlocks]);

  // --- Chapter / page navigation -----------------------------------------
  const jumpToChapter = useCallback(
    (index: number, fragment?: string) => {
      const current = bookRef.current;
      if (!current) return;
      const clamped = clamp(index, 0, current.chapters.length - 1);
      if (clamped === chapterIndexRef.current) {
        if (fragment) contentRef.current?.scrollToFragment(fragment);
        else contentRef.current?.scrollToTop();
        return;
      }
      restoreRef.current = fragment ? { fragment } : { ratio: 0 };
      setChapterIndex(clamped);
    },
    [],
  );

  const goNextChapter = useCallback(() => {
    const current = bookRef.current;
    if (!current) return;
    if (chapterIndexRef.current >= current.chapters.length - 1) return;
    restoreRef.current = { ratio: 0 };
    setChapterIndex(chapterIndexRef.current + 1);
  }, []);

  const goPrevChapter = useCallback((toBottom = false) => {
    if (chapterIndexRef.current <= 0) return;
    restoreRef.current = toBottom ? { atBottom: true } : { ratio: 0 };
    setChapterIndex(chapterIndexRef.current - 1);
  }, []);

  const nextPage = useCallback(() => {
    if (!contentRef.current?.nextPage()) goNextChapter();
  }, [goNextChapter]);

  const prevPage = useCallback(() => {
    if (!contentRef.current?.prevPage()) goPrevChapter(true);
  }, [goPrevChapter]);

  // --- Text to speech -----------------------------------------------------
  const clearTtsHighlight = () => {
    if (ttsActiveElRef.current) {
      ttsActiveElRef.current.classList.remove("reader-tts-active");
      ttsActiveElRef.current = null;
    }
  };

  const startReadingFrom = useCallback(
    (startIndex: number) => {
      refreshTtsBlocks();
      const blocks = ttsBlocksRef.current;
      if (blocks.length === 0) return;
      const texts = blocks.map((b) => b.textContent ?? "");
      setReading(true);
      tts.start(
        texts,
        startIndex,
        (i) => {
          clearTtsHighlight();
          const el = blocks[i];
          if (el) {
            el.classList.add("reader-tts-active");
            ttsActiveElRef.current = el;
            el.scrollIntoView({ block: "center", behavior: "smooth" });
          }
        },
        () => {
          clearTtsHighlight();
          // Auto-continue into the next chapter when one exists.
          const current = bookRef.current;
          if (current && chapterIndexRef.current < current.chapters.length - 1) {
            ttsContinueRef.current = true;
            goNextChapter();
          } else {
            setReading(false);
          }
        },
      );
    },
    [tts, refreshTtsBlocks, goNextChapter],
  );

  const startReadingFromCurrent = useCallback(() => {
    refreshTtsBlocks();
    const blocks = ttsBlocksRef.current;
    const start = contentRef.current?.getActiveBlockIndex(blocks) ?? 0;
    startReadingFrom(start);
  }, [refreshTtsBlocks, startReadingFrom]);

  const toggleReading = useCallback(() => {
    if (reading && !tts.paused) {
      tts.pause();
    } else if (reading && tts.paused) {
      tts.resume();
    } else {
      startReadingFromCurrent();
    }
  }, [reading, tts, startReadingFromCurrent]);

  const stopReading = useCallback(() => {
    tts.stop();
    setReading(false);
    clearTtsHighlight();
  }, [tts]);

  // Keep local `reading` in sync if speech ends on its own.
  useEffect(() => {
    if (!tts.speaking && reading && !tts.paused) {
      // The onDone handler manages chapter hand-off; only clear when truly idle.
      const id = window.setTimeout(() => {
        if (!window.speechSynthesis?.speaking && !ttsContinueRef.current) {
          setReading(false);
          clearTtsHighlight();
        }
      }, 250);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [tts.speaking, tts.paused, reading]);

  // --- Bookmarks ----------------------------------------------------------
  const currentExcerpt = useCallback((): string => {
    const blocks = ttsBlocksRef.current.length
      ? ttsBlocksRef.current
      : Array.from(
          contentRef.current?.getProseElement()?.querySelectorAll<HTMLElement>(BLOCK_SELECTOR) ?? [],
        );
    const idx = contentRef.current?.getActiveBlockIndex(blocks) ?? 0;
    const text = (blocks[idx]?.textContent ?? "").trim();
    return text.slice(0, 90) || "Saved position";
  }, []);

  const isBookmarkedHere = useMemo(
    () =>
      bookmarks.some(
        (b) =>
          b.chapterIndex === chapterIndex &&
          Math.abs(b.scrollRatio - scrollRatioRef.current) < 0.06,
      ),
    // scrollRatioRef is a ref; percent changes track scrolling so re-evaluate on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookmarks, chapterIndex, percent],
  );

  const persistBookmarks = useCallback(
    (next: ReaderBookmark[]) => {
      setBookmarks(next);
      void saveBookmarks(fileId, next);
    },
    [fileId],
  );

  const toggleBookmarkHere = useCallback(() => {
    const current = bookRef.current;
    if (!current) return;
    const existing = bookmarks.find(
      (b) =>
        b.chapterIndex === chapterIndexRef.current &&
        Math.abs(b.scrollRatio - scrollRatioRef.current) < 0.06,
    );
    if (existing) {
      persistBookmarks(bookmarks.filter((b) => b.id !== existing.id));
      return;
    }
    const mark: ReaderBookmark = {
      id: makeId(),
      chapterIndex: chapterIndexRef.current,
      scrollRatio: scrollRatioRef.current,
      chapterLabel: current.chapters[chapterIndexRef.current]?.label ?? "Bookmark",
      excerpt: currentExcerpt(),
      createdAt: Date.now(),
    };
    persistBookmarks(
      [...bookmarks, mark].sort(
        (a, b) => a.chapterIndex - b.chapterIndex || a.scrollRatio - b.scrollRatio,
      ),
    );
  }, [bookmarks, persistBookmarks, currentExcerpt]);

  const jumpToBookmark = useCallback(
    (mark: ReaderBookmark) => {
      if (mark.chapterIndex === chapterIndexRef.current) {
        contentRef.current?.scrollToRatio(mark.scrollRatio);
        return;
      }
      restoreRef.current = { ratio: mark.scrollRatio };
      setChapterIndex(clamp(mark.chapterIndex, 0, (bookRef.current?.chapters.length ?? 1) - 1));
    },
    [],
  );

  // --- Highlights + notes -------------------------------------------------
  const persistHighlights = useCallback(
    (next: ReaderHighlight[]) => {
      setHighlights(next);
      void saveHighlights(fileId, next);
    },
    [fileId],
  );

  const chapterHighlights = useMemo(
    () => highlights.filter((h) => h.chapterIndex === chapterIndex),
    [highlights, chapterIndex],
  );

  const createHighlight = useCallback(
    (payload: { start: number; end: number; text: string; color: string }) => {
      const hl: ReaderHighlight = {
        id: makeId(),
        chapterIndex: chapterIndexRef.current,
        start: payload.start,
        end: payload.end,
        color: payload.color,
        text: payload.text.slice(0, 280),
        createdAt: Date.now(),
      };
      persistHighlights([...highlights, hl]);
    },
    [highlights, persistHighlights],
  );

  const updateHighlight = useCallback(
    (id: string, patch: Partial<Pick<ReaderHighlight, "color" | "note">>) => {
      persistHighlights(highlights.map((h) => (h.id === id ? { ...h, ...patch } : h)));
    },
    [highlights, persistHighlights],
  );

  const removeHighlight = useCallback(
    (id: string) => persistHighlights(highlights.filter((h) => h.id !== id)),
    [highlights, persistHighlights],
  );

  const jumpToHighlight = useCallback((hl: ReaderHighlight) => {
    const current = bookRef.current;
    const chapter = current?.chapters[hl.chapterIndex];
    const ratio = chapter && chapter.text.length > 0 ? hl.start / chapter.text.length : 0;
    if (hl.chapterIndex === chapterIndexRef.current) {
      contentRef.current?.scrollToRatio(ratio);
      return;
    }
    restoreRef.current = { ratio };
    setChapterIndex(hl.chapterIndex);
  }, []);

  // --- Search -------------------------------------------------------------
  useEffect(() => {
    const current = bookRef.current;
    const q = searchQuery.trim().toLowerCase();
    if (!current || q.length < 2) {
      setSearchResults([]);
      return;
    }
    const id = window.setTimeout(() => {
      const hits: SearchHit[] = [];
      for (const chapter of current.chapters) {
        const haystack = chapter.text.toLowerCase();
        let from = 0;
        while (hits.length < MAX_SEARCH_RESULTS) {
          const at = haystack.indexOf(q, from);
          if (at < 0) break;
          hits.push({
            chapterIndex: chapter.index,
            chapterLabel: chapter.label,
            snippet: buildSnippet(chapter.text, at, q.length),
            offset: at,
          });
          from = at + q.length;
        }
        if (hits.length >= MAX_SEARCH_RESULTS) break;
      }
      setSearchResults(hits);
    }, 220);
    return () => window.clearTimeout(id);
  }, [searchQuery, book]);

  const jumpToResult = useCallback((hit: SearchHit) => {
    const current = bookRef.current;
    if (!current) return;
    const chapter = current.chapters[hit.chapterIndex];
    const ratio = chapter && chapter.text.length > 0 ? hit.offset / chapter.text.length : 0;
    if (hit.chapterIndex === chapterIndexRef.current) {
      contentRef.current?.scrollToRatio(ratio);
      return;
    }
    restoreRef.current = { ratio };
    setChapterIndex(hit.chapterIndex);
  }, []);

  // Book-level seek — clicking the footer progress bar jumps to that fraction
  // of the whole book (chapter + offset within it).
  const seekToFraction = useCallback((fraction: number) => {
    const total = bookRef.current?.chapters.length ?? 0;
    if (total === 0) return;
    const f = clamp(fraction, 0, 0.999);
    const chapterFloat = f * total;
    const idx = clamp(Math.floor(chapterFloat), 0, total - 1);
    const within = clamp(chapterFloat - idx, 0, 1);
    if (idx === chapterIndexRef.current) {
      contentRef.current?.scrollToRatio(within);
    } else {
      restoreRef.current = { ratio: within };
      setChapterIndex(idx);
    }
  }, []);

  // --- Section helpers ----------------------------------------------------
  const toggleSection = useCallback((id: SectionId) => {
    setOpenSection((prev) => (prev === id ? null : id));
  }, []);

  const focusSearch = useCallback(() => {
    setOpenSection("search");
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, []);

  // --- Keyboard shortcuts -------------------------------------------------
  useEffect(() => {
    if (status !== "ready") return;
    const onKey = (e: KeyboardEvent) => {
      const action = resolveReaderAction(e);
      if (!action) return;
      const target = e.target as HTMLElement | null;
      const inField =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if (inField) {
        // While typing, only honour Escape and the explicit Ctrl/Cmd+F chord.
        if (action === "escape") {
          (target as HTMLElement).blur();
          return;
        }
        if (action === "search" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          focusSearch();
        }
        return;
      }

      switch (action) {
        case "next-page":
          e.preventDefault();
          nextPage();
          break;
        case "prev-page":
          e.preventDefault();
          prevPage();
          break;
        case "next-chapter":
          e.preventDefault();
          goNextChapter();
          break;
        case "prev-chapter":
          e.preventDefault();
          goPrevChapter();
          break;
        case "font-increase":
          e.preventDefault();
          patchPrefs({ fontSize: prefs.fontSize + 1 });
          break;
        case "font-decrease":
          e.preventDefault();
          patchPrefs({ fontSize: prefs.fontSize - 1 });
          break;
        case "toggle-theme":
          e.preventDefault();
          patchPrefs({ theme: cycleTheme(prefs.theme) });
          break;
        case "toggle-toc":
          e.preventDefault();
          toggleSection("contents");
          break;
        case "toggle-bookmark":
          e.preventDefault();
          toggleBookmarkHere();
          break;
        case "search":
          e.preventDefault();
          focusSearch();
          break;
        case "toggle-tts":
          e.preventDefault();
          if (reading) stopReading();
          else startReadingFromCurrent();
          break;
        case "help":
          e.preventDefault();
          setShortcutsOpen((v) => !v);
          break;
        case "escape":
          handleEscape();
          break;
      }
    };

    const handleEscape = () => {
      if (shortcutsOpen) {
        setShortcutsOpen(false);
        return;
      }
      if (openSection) {
        setOpenSection(null);
        return;
      }
      if (reading) {
        stopReading();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    status,
    prefs.fontSize,
    prefs.theme,
    reading,
    shortcutsOpen,
    openSection,
    nextPage,
    prevPage,
    goNextChapter,
    goPrevChapter,
    patchPrefs,
    toggleSection,
    toggleBookmarkHere,
    focusSearch,
    startReadingFromCurrent,
    stopReading,
  ]);

  // Idle detection for auto-hiding the chrome.
  useEffect(() => {
    if (status !== "ready") return;
    let timer = 0;
    const wake = () => {
      setChromeIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setChromeIdle(true), 2600);
    };
    wake();
    window.addEventListener("mousemove", wake, { passive: true });
    window.addEventListener("keydown", wake);
    window.addEventListener("wheel", wake, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("keydown", wake);
      window.removeEventListener("wheel", wake);
    };
  }, [status]);

  // Keep the chrome up whenever a panel/modal is open.
  const chromeHidden = chromeIdle && !openSection && !shortcutsOpen;

  const onBack = useCallback(() => {
    if (folderId) navigate(`/library/light-novel`);
    else navigate(-1);
  }, [folderId, navigate]);

  // --- Render -------------------------------------------------------------
  const rootStyle: CSSProperties = {
    ["--reader-page" as string]: theme.page,
    ["--reader-text" as string]: theme.text,
    ["--reader-muted" as string]: theme.muted,
    ["--reader-border" as string]: theme.border,
    ["--reader-accent" as string]: theme.accent,
    ["--reader-dim" as string]: String(1 - prefs.brightness),
  };
  const withTransition = (content: ReactNode) => content;

  if (status === "error") {
    return withTransition(
      <div className="reader-root reader-root--state" data-theme={prefs.theme} style={rootStyle}>
        <div className="reader-state">
          <TriangleAlert className="reader-state__icon" aria-hidden />
          <h1>Couldn't open this book</h1>
          <p>{errorMsg}</p>
          <button type="button" className="reader-state__btn" onClick={() => navigate("/library/light-novel")}>
            Back to Light Novels
          </button>
        </div>
      </div>,
    );
  }

  if (status === "loading" || !book) {
    return withTransition(
      <div className="reader-root reader-root--state" data-theme={prefs.theme} style={rootStyle}>
        <div className="reader-state">
          <Loader2 className="reader-state__icon reader-state__icon--spin" aria-hidden />
          <h1>Opening your book…</h1>
          <p>Fetching and parsing the EPUB.</p>
        </div>
      </div>,
    );
  }

  const chapter = book.chapters[chapterIndex];
  const totalChapters = book.chapters.length;
  // Estimate time left in this chapter from the unread fraction (≈250 wpm).
  const minutesLeft = chapter
    ? Math.max(1, Math.round((chapter.wordCount * (1 - scrollRatioRef.current)) / 250))
    : 0;
  const metaLine = chapter
    ? `${chapter.wordCount.toLocaleString()} words · ~${minutesLeft} min left · ${percent}% read`
    : `${percent}% read`;
  const chapterPosition = `${chapterIndex + 1} / ${totalChapters}`;
  // Image-only pages (cover, color inserts) render without the chapter header
  // so the illustration sits in the book rather than under a ghost title.
  const imageOnly = !!chapter && chapter.wordCount === 0;

  return withTransition(
    <div
      className="reader-root"
      data-theme={prefs.theme}
      data-dark={theme.dark ? "1" : "0"}
      data-dim-images={theme.dark && prefs.dimImages ? "1" : "0"}
      data-chrome-hidden={chromeHidden ? "1" : "0"}
      style={rootStyle}
    >
      <ReaderSidebar
        bookTitle={book.title || fileName}
        author={book.author}
        language={book.language}
        prefs={prefs}
        patchPrefs={patchPrefs}
        resetPrefs={resetPrefs}
        openSection={openSection}
        onToggleSection={toggleSection}
        chapters={book.chapters}
        toc={book.toc}
        chapterIndex={chapterIndex}
        onJumpToChapter={jumpToChapter}
        onPrevChapter={() => goPrevChapter()}
        onNextChapter={goNextChapter}
        hasPrevChapter={chapterIndex > 0}
        hasNextChapter={chapterIndex < totalChapters - 1}
        bookmarks={bookmarks}
        onAddBookmark={toggleBookmarkHere}
        onRemoveBookmark={(id) => persistBookmarks(bookmarks.filter((b) => b.id !== id))}
        onJumpToBookmark={jumpToBookmark}
        isBookmarkedHere={isBookmarkedHere}
        highlights={highlights}
        onJumpToHighlight={jumpToHighlight}
        onRemoveHighlight={removeHighlight}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        searchResults={searchResults}
        searchInputRef={searchInputRef}
        onJumpToResult={jumpToResult}
        tts={tts}
        reading={reading}
        onToggleReading={toggleReading}
        progressPercent={percent}
        chapterPosition={chapterPosition}
        onSeekToFraction={seekToFraction}
        onBack={onBack}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />

      <main className="reader-main">
        <ReaderContent
          ref={contentRef}
          html={chapterHtml}
          prefs={prefs}
          bookTitle={book.title || fileName}
          chapterLabel={chapter?.label ?? ""}
          metaLine={metaLine}
          percent={percent}
          loading={chapterLoading}
          hideHeader={imageOnly}
          highlights={chapterHighlights}
          onCreateHighlight={createHighlight}
          onUpdateHighlight={updateHighlight}
          onRemoveHighlight={removeHighlight}
          onScrollRatio={handleScrollRatio}
          onInternalLink={(href, fragment) => {
            const target = bookRef.current?.resolveHref(
              href || (fragment ? `#${fragment}` : ""),
              chapterIndexRef.current,
            );
            if (target) jumpToChapter(target.chapterIndex, target.fragment);
          }}
          onChapterMounted={handleChapterMounted}
        />

        {prefs.brightness < 1 && <div className="reader-dim" aria-hidden />}

        {/* Full-width reading progress at the very bottom; click to seek. */}
        <button
          type="button"
          className="reader-progress-rail"
          aria-label="Seek through the book"
          title="Jump to position in book"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            if (rect.width > 0) seekToFraction((e.clientX - rect.left) / rect.width);
          }}
        >
          <span style={{ width: `${percent}%` }} />
        </button>
      </main>

      {shortcutsOpen && <ReaderShortcutsModal onClose={() => setShortcutsOpen(false)} />}
    </div>,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cycleTheme(current: ReaderPrefs["theme"]): ReaderPrefs["theme"] {
  const order: ReaderPrefs["theme"][] = [
    "dark",
    "midnight",
    "slate",
    "cream",
    "light",
    "sepia",
  ];
  const idx = order.indexOf(current);
  return order[(idx + 1) % order.length]!;
}

function buildSnippet(text: string, at: number, len: number): string {
  const start = Math.max(0, at - 32);
  const end = Math.min(text.length, at + len + 48);
  const before = escapeHtml((start > 0 ? "…" : "") + text.slice(start, at));
  const match = escapeHtml(text.slice(at, at + len));
  const after = escapeHtml(text.slice(at + len, end) + (end < text.length ? "…" : ""));
  return `${before}<mark>${match}</mark>${after}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `bm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

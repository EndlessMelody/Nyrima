/**
 * ReaderSidebar — a floating right tool rail + a left-opening panel.
 *
 * The reading canvas owns the full width. A slim, glassy Nyrima rail floats on
 * the right edge with icon toggles; activating one slides its controls in as a
 * panel to the *left* of the rail, over the page. Nothing is open on first
 * display, and only one panel shows at a time, so the page starts quiet and the
 * text is always the hero.
 */

import type { ReactNode, RefObject } from "react";
import {
  Bookmark,
  Highlighter,
  Home,
  Info,
  Keyboard,
  ListTree,
  Pause,
  Play,
  RotateCcw,
  Search,
  SkipBack,
  SkipForward,
  Square,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { Segmented, Slider, Stepper, ToggleRow } from "./ReaderControls";
import {
  BRIGHTNESS_RANGE,
  DARK_THEME_IDS,
  FONT_CATALOG,
  FONT_SIZE_RANGE,
  FONT_WEIGHTS,
  LIGHT_THEME_IDS,
  LINE_HEIGHT_RANGE,
  MARGIN_RANGE,
  PAGE_WIDTH_RANGE,
  PARAGRAPH_SPACING_RANGE,
  readerTheme,
  READER_THEMES,
  HIGHLIGHT_COLORS,
  type ReaderFontWeight,
  type ReaderParagraphStyle,
  type ReaderPrefs,
  type ReaderThemeId,
} from "../../services/reader/reader-prefs";
import type { EpubChapter, EpubTocItem } from "../../services/epub";
import type { ReaderBookmark, ReaderHighlight } from "../../services/reader/reader-storage";
import type { TtsController } from "../../hooks/useTextToSpeech";

export type SectionId =
  | "appearance"
  | "tts"
  | "contents"
  | "search"
  | "bookmarks"
  | "highlights"
  | "info";

export interface SearchHit {
  chapterIndex: number;
  chapterLabel: string;
  snippet: string;
  offset: number;
}

interface ReaderSidebarProps {
  bookTitle: string;
  author?: string;
  language?: string;
  prefs: ReaderPrefs;
  patchPrefs: (p: Partial<ReaderPrefs>) => void;
  resetPrefs: () => void;

  openSection: SectionId | null;
  onToggleSection: (id: SectionId) => void;

  chapters: EpubChapter[];
  toc: EpubTocItem[];
  chapterIndex: number;
  onJumpToChapter: (index: number, fragment?: string) => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  hasPrevChapter: boolean;
  hasNextChapter: boolean;

  bookmarks: ReaderBookmark[];
  onAddBookmark: () => void;
  onRemoveBookmark: (id: string) => void;
  onJumpToBookmark: (bookmark: ReaderBookmark) => void;
  isBookmarkedHere: boolean;

  highlights: ReaderHighlight[];
  onJumpToHighlight: (highlight: ReaderHighlight) => void;
  onRemoveHighlight: (id: string) => void;

  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  searchResults: SearchHit[];
  searchInputRef: RefObject<HTMLInputElement>;
  onJumpToResult: (hit: SearchHit) => void;

  tts: TtsController;
  reading: boolean;
  onToggleReading: () => void;

  progressPercent: number;
  chapterPosition: string;
  onSeekToFraction: (fraction: number) => void;
  onBack: () => void;
  onOpenShortcuts: () => void;
}

const TOOLS: Array<{ id: SectionId; label: string; icon: ReactNode }> = [
  { id: "appearance", label: "Appearance", icon: <span className="reader-railR__aa">Aa</span> },
  { id: "tts", label: "Read aloud", icon: <Volume2 aria-hidden /> },
  { id: "contents", label: "Contents", icon: <ListTree aria-hidden /> },
  { id: "search", label: "Search", icon: <Search aria-hidden /> },
  { id: "bookmarks", label: "Bookmarks", icon: <Bookmark aria-hidden /> },
  { id: "highlights", label: "Highlights", icon: <Highlighter aria-hidden /> },
  { id: "info", label: "Book info", icon: <Info aria-hidden /> },
];

const PANEL_TITLES: Record<SectionId, string> = {
  appearance: "Appearance",
  tts: "Read aloud",
  contents: "Contents",
  search: "Search",
  bookmarks: "Bookmarks",
  highlights: "Highlights",
  info: "Book info",
};

export function ReaderSidebar(props: ReaderSidebarProps) {
  const { openSection, onToggleSection, onBack, onPrevChapter, onNextChapter, hasPrevChapter, hasNextChapter, reading } =
    props;

  return (
    <>
      <nav className="reader-railR" aria-label="Reader tools">
        <span className="reader-railR__brand" aria-hidden title="Nyrima Reader">
          N
        </span>

        <button
          type="button"
          className="reader-railR__btn"
          onClick={onPrevChapter}
          disabled={!hasPrevChapter}
          aria-label="Previous chapter"
          title="Previous chapter"
        >
          <SkipBack aria-hidden />
        </button>
        <button
          type="button"
          className="reader-railR__btn"
          onClick={onBack}
          aria-label="Back to library"
          title="Back to library"
        >
          <Home aria-hidden />
        </button>

        <span className="reader-railR__divider" aria-hidden />

        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className={`reader-railR__btn${openSection === tool.id ? " is-active" : ""}${
              tool.id === "tts" && reading ? " is-live" : ""
            }`}
            onClick={() => onToggleSection(tool.id)}
            aria-label={tool.label}
            aria-pressed={openSection === tool.id}
            title={tool.label}
          >
            {tool.icon}
          </button>
        ))}

        <span className="reader-railR__divider" aria-hidden />

        <button
          type="button"
          className="reader-railR__btn"
          onClick={onNextChapter}
          disabled={!hasNextChapter}
          aria-label="Next chapter"
          title="Next chapter"
        >
          <SkipForward aria-hidden />
        </button>
      </nav>

      {openSection && (
        <div className="reader-panel" role="dialog" aria-label={PANEL_TITLES[openSection]}>
          <header className="reader-panel__head">
            <h2>{PANEL_TITLES[openSection]}</h2>
            <button
              type="button"
              className="reader-panel__close"
              onClick={() => onToggleSection(openSection)}
              aria-label="Close"
            >
              <X aria-hidden />
            </button>
          </header>
          <div className="reader-panel__body">{renderPanelBody(openSection, props)}</div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Panel bodies
// ---------------------------------------------------------------------------

function renderPanelBody(section: SectionId, props: ReaderSidebarProps): ReactNode {
  switch (section) {
    case "appearance":
      return <AppearanceBody {...props} />;
    case "tts":
      return <TtsBody {...props} />;
    case "contents":
      return <ContentsBody {...props} />;
    case "search":
      return <SearchBody {...props} />;
    case "bookmarks":
      return <BookmarksBody {...props} />;
    case "highlights":
      return <HighlightsBody {...props} />;
    case "info":
      return <InfoBody {...props} />;
  }
}

function AppearanceBody({ prefs, patchPrefs }: ReaderSidebarProps) {
  const renderSwatch = (id: ReaderThemeId) => {
    const t = READER_THEMES.find((x) => x.id === id);
    if (!t) return null;
    return (
      <button
        key={t.id}
        type="button"
        className={`reader-swatch${prefs.theme === t.id ? " is-active" : ""}`}
        style={{ background: t.page, color: t.text }}
        onClick={() => patchPrefs({ theme: t.id })}
        aria-pressed={prefs.theme === t.id}
        title={t.label}
      >
        <span className="reader-swatch__a">Aa</span>
        <span className="reader-swatch__label">{t.label}</span>
      </button>
    );
  };
  const activeIsDark = readerTheme(prefs.theme).dark;

  return (
    <>
      <div className="reader-field">
        <span className="reader-field__label">Theme</span>
        <div className="reader-theme-group">
          <span className="reader-theme-group__tag">Dark</span>
          <div className="reader-themes" role="group" aria-label="Dark themes">
            {DARK_THEME_IDS.map(renderSwatch)}
          </div>
        </div>
        <div className="reader-theme-group">
          <span className="reader-theme-group__tag">Light</span>
          <div className="reader-themes" role="group" aria-label="Light themes">
            {LIGHT_THEME_IDS.map(renderSwatch)}
          </div>
        </div>
      </div>

      <div className="reader-field">
        <span className="reader-field__label">Font family</span>
        <div className="reader-fontgrid" role="group" aria-label="Font family">
          {FONT_CATALOG.map((font) => (
            <button
              key={font.id}
              type="button"
              className={`reader-fontchip${prefs.fontFamily === font.id ? " is-active" : ""}`}
              style={{ fontFamily: font.stack }}
              onClick={() => patchPrefs({ fontFamily: font.id })}
              aria-pressed={prefs.fontFamily === font.id}
            >
              {font.label}
            </button>
          ))}
        </div>
      </div>

      <Segmented<string>
        label="Font weight"
        value={String(prefs.fontWeight)}
        options={FONT_WEIGHTS.map((w) => ({ value: String(w.value), label: w.label }))}
        onChange={(next) => patchPrefs({ fontWeight: Number(next) as ReaderFontWeight })}
      />

      <Stepper
        label="Font size"
        value={`${prefs.fontSize}px`}
        canDecrease={prefs.fontSize > FONT_SIZE_RANGE.min}
        canIncrease={prefs.fontSize < FONT_SIZE_RANGE.max}
        onDecrease={() => patchPrefs({ fontSize: prefs.fontSize - FONT_SIZE_RANGE.step })}
        onIncrease={() => patchPrefs({ fontSize: prefs.fontSize + FONT_SIZE_RANGE.step })}
      />
      <Stepper
        label="Line height"
        value={prefs.lineHeight.toFixed(2)}
        canDecrease={prefs.lineHeight > LINE_HEIGHT_RANGE.min}
        canIncrease={prefs.lineHeight < LINE_HEIGHT_RANGE.max}
        onDecrease={() => patchPrefs({ lineHeight: round(prefs.lineHeight - LINE_HEIGHT_RANGE.step) })}
        onIncrease={() => patchPrefs({ lineHeight: round(prefs.lineHeight + LINE_HEIGHT_RANGE.step) })}
      />
      <Stepper
        label="Paragraph spacing"
        value={`${prefs.paragraphSpacing.toFixed(1)}em`}
        canDecrease={prefs.paragraphSpacing > PARAGRAPH_SPACING_RANGE.min}
        canIncrease={prefs.paragraphSpacing < PARAGRAPH_SPACING_RANGE.max}
        onDecrease={() => patchPrefs({ paragraphSpacing: round(prefs.paragraphSpacing - PARAGRAPH_SPACING_RANGE.step) })}
        onIncrease={() => patchPrefs({ paragraphSpacing: round(prefs.paragraphSpacing + PARAGRAPH_SPACING_RANGE.step) })}
      />
      <Stepper
        label="Page width"
        value={`${prefs.pageWidth}px`}
        canDecrease={prefs.pageWidth > PAGE_WIDTH_RANGE.min}
        canIncrease={prefs.pageWidth < PAGE_WIDTH_RANGE.max}
        onDecrease={() => patchPrefs({ pageWidth: prefs.pageWidth - PAGE_WIDTH_RANGE.step })}
        onIncrease={() => patchPrefs({ pageWidth: prefs.pageWidth + PAGE_WIDTH_RANGE.step })}
      />
      <Stepper
        label="Margins"
        value={`${prefs.margin}px`}
        canDecrease={prefs.margin > MARGIN_RANGE.min}
        canIncrease={prefs.margin < MARGIN_RANGE.max}
        onDecrease={() => patchPrefs({ margin: prefs.margin - MARGIN_RANGE.step })}
        onIncrease={() => patchPrefs({ margin: prefs.margin + MARGIN_RANGE.step })}
      />

      <Segmented<ReaderParagraphStyle>
        label="Paragraph style"
        value={prefs.paragraphStyle}
        options={[
          { value: "spaced", label: "Spaced" },
          { value: "indented", label: "Indented" },
        ]}
        onChange={(next) => patchPrefs({ paragraphStyle: next })}
      />

      <ToggleRow label="Justify text" checked={prefs.justify} onChange={(next) => patchPrefs({ justify: next })} />

      <ToggleRow
        label="Focus mode"
        checked={prefs.focusMode}
        onChange={(next) => patchPrefs({ focusMode: next })}
      />

      {activeIsDark && (
        <ToggleRow
          label="Dim illustrations"
          checked={prefs.dimImages}
          onChange={(next) => patchPrefs({ dimImages: next })}
        />
      )}

      <Slider
        label="Comfort"
        value={prefs.brightness}
        min={BRIGHTNESS_RANGE.min}
        max={BRIGHTNESS_RANGE.max}
        step={BRIGHTNESS_RANGE.step}
        display={`${Math.round(prefs.brightness * 100)}%`}
        onChange={(next) => patchPrefs({ brightness: next })}
      />

      <Segmented
        label="Reading mode"
        value={prefs.mode}
        options={[
          { value: "scroll", label: "Scroll" },
          { value: "paged", label: "Paged" },
        ]}
        onChange={(next) => patchPrefs({ mode: next })}
      />
    </>
  );
}

function TtsBody({ tts, reading, onToggleReading }: ReaderSidebarProps) {
  if (!tts.supported) {
    return <p className="reader-note">Text-to-speech isn't available in this browser.</p>;
  }
  return (
    <>
      <div className="reader-tts-controls">
        <button type="button" className="reader-tts-btn reader-tts-btn--primary" onClick={onToggleReading}>
          {reading && !tts.paused ? <Pause aria-hidden /> : <Play aria-hidden />}
          <span>{reading && !tts.paused ? "Pause" : reading ? "Resume" : "Play"}</span>
        </button>
        <button type="button" className="reader-tts-btn" onClick={tts.stop} disabled={!reading} aria-label="Stop reading">
          <Square aria-hidden />
        </button>
      </div>
      <div className="reader-field">
        <span className="reader-field__label">Voice</span>
        <select
          className="reader-select"
          value={tts.voiceURI ?? ""}
          onChange={(e) => tts.setVoiceURI(e.target.value)}
        >
          {tts.voices.length === 0 && <option value="">System default</option>}
          {tts.voices.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name} ({v.lang})
            </option>
          ))}
        </select>
      </div>
      <Slider
        label="Speed"
        value={tts.rate}
        min={0.5}
        max={2}
        step={0.1}
        display={`${tts.rate.toFixed(1)}×`}
        onChange={(next) => tts.setRate(next)}
      />
    </>
  );
}

function ContentsBody({ toc, chapters, chapterIndex, onJumpToChapter }: ReaderSidebarProps) {
  const tocItems: EpubTocItem[] =
    toc.length > 0 ? toc : chapters.map((c) => ({ label: c.label, chapterIndex: c.index, depth: 0 }));
  return (
    <ul className="reader-toc">
      {tocItems.map((item, i) => (
        <li key={`${item.chapterIndex}-${i}`}>
          <button
            type="button"
            className={`reader-toc__row${item.chapterIndex === chapterIndex ? " is-current" : ""}`}
            style={{ paddingLeft: `${10 + item.depth * 14}px` }}
            onClick={() => onJumpToChapter(item.chapterIndex, item.fragment)}
            disabled={item.chapterIndex < 0}
          >
            {item.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

function SearchBody({
  searchQuery,
  onSearchQueryChange,
  searchResults,
  searchInputRef,
  onJumpToResult,
}: ReaderSidebarProps) {
  return (
    <>
      <div className="reader-searchbox">
        <Search aria-hidden />
        <input
          ref={searchInputRef}
          type="search"
          className="reader-searchbox__input"
          placeholder="Search this book…"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
        />
      </div>
      {searchQuery.trim().length >= 2 && (
        <p className="reader-note reader-note--count">
          {searchResults.length === 0
            ? "No matches."
            : `${searchResults.length} match${searchResults.length === 1 ? "" : "es"}`}
        </p>
      )}
      <ul className="reader-list">
        {searchResults.map((hit, i) => (
          <li key={`${hit.chapterIndex}-${hit.offset}-${i}`} className="reader-list__row">
            <button type="button" className="reader-list__main" onClick={() => onJumpToResult(hit)}>
              <span className="reader-list__title">{hit.chapterLabel}</span>
              <span className="reader-list__sub" dangerouslySetInnerHTML={{ __html: hit.snippet }} />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function BookmarksBody({
  bookmarks,
  onAddBookmark,
  onRemoveBookmark,
  onJumpToBookmark,
  isBookmarkedHere,
}: ReaderSidebarProps) {
  return (
    <>
      <button type="button" className="reader-action-btn" onClick={onAddBookmark}>
        <Bookmark aria-hidden />
        {isBookmarkedHere ? "Remove bookmark here" : "Bookmark this spot"}
      </button>
      {bookmarks.length === 0 ? (
        <p className="reader-note">No bookmarks yet. Press B to mark your place.</p>
      ) : (
        <ul className="reader-list">
          {bookmarks.map((b) => (
            <li key={b.id} className="reader-list__row">
              <button type="button" className="reader-list__main" onClick={() => onJumpToBookmark(b)}>
                <span className="reader-list__title">{b.chapterLabel}</span>
                <span className="reader-list__sub">{b.excerpt}</span>
              </button>
              <button
                type="button"
                className="reader-list__remove"
                onClick={() => onRemoveBookmark(b.id)}
                aria-label="Remove bookmark"
              >
                <Trash2 aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function HighlightsBody({ highlights, onJumpToHighlight, onRemoveHighlight }: ReaderSidebarProps) {
  if (highlights.length === 0) {
    return <p className="reader-note">No highlights yet. Select text in the page to highlight it.</p>;
  }
  return (
    <ul className="reader-list">
      {highlights.map((h) => {
        const color = HIGHLIGHT_COLORS.find((c) => c.id === h.color)?.value ?? "#f4c64a";
        return (
          <li key={h.id} className="reader-list__row">
            <button type="button" className="reader-list__main" onClick={() => onJumpToHighlight(h)}>
              <span className="reader-list__title reader-hl-quote">
                <span className="reader-hl-dot reader-hl-dot--sm" style={{ background: color }} aria-hidden />
                “{h.text}”
              </span>
              {h.note && <span className="reader-list__sub">{h.note}</span>}
            </button>
            <button
              type="button"
              className="reader-list__remove"
              onClick={() => onRemoveHighlight(h.id)}
              aria-label="Remove highlight"
            >
              <Trash2 aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function InfoBody({
  bookTitle,
  author,
  language,
  chapters,
  chapterPosition,
  progressPercent,
  onSeekToFraction,
  onOpenShortcuts,
  resetPrefs,
}: ReaderSidebarProps) {
  return (
    <>
      <div className="reader-info">
        <h3 className="reader-info__title">{bookTitle}</h3>
        {author && <p className="reader-info__meta">{author}</p>}
        <dl className="reader-info__stats">
          <div>
            <dt>Chapter</dt>
            <dd>{chapterPosition}</dd>
          </div>
          <div>
            <dt>Chapters</dt>
            <dd>{chapters.length}</dd>
          </div>
          {language && (
            <div>
              <dt>Language</dt>
              <dd>{language}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="reader-field">
        <span className="reader-field__label">
          Progress
          <span className="reader-slider__value">{progressPercent}%</span>
        </span>
        <button
          type="button"
          className="reader-seekbar"
          title="Jump to position in book"
          aria-label="Seek through the book"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            if (rect.width > 0) onSeekToFraction((e.clientX - rect.left) / rect.width);
          }}
        >
          <span style={{ width: `${progressPercent}%` }} />
        </button>
      </div>

      <div className="reader-info__actions">
        <button type="button" className="reader-foot-btn" onClick={onOpenShortcuts}>
          <Keyboard aria-hidden /> Shortcuts
        </button>
        <button type="button" className="reader-foot-btn" onClick={resetPrefs}>
          <RotateCcw aria-hidden /> Reset
        </button>
      </div>
    </>
  );
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

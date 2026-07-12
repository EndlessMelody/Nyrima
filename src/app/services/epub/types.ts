/** Shared types for the EPUB engine + reader. */

export interface EpubChapter {
  /** Manifest item id. */
  id: string;
  /** Normalized full path of the chapter document within the archive. */
  href: string;
  /** Zero-based position in the reading order (spine). */
  index: number;
  /** Display label, resolved from the TOC when possible. */
  label: string;
  /** Plain-text content — powers search, word count, and TTS. */
  text: string;
  /** Estimated word count (latin words + CJK characters). */
  wordCount: number;
}

export interface EpubTocItem {
  label: string;
  /** Spine index this entry points at, or -1 when unresolved. */
  chapterIndex: number;
  /** Optional in-document anchor. */
  fragment?: string;
  /** Nesting depth (0 = top level) for indentation. */
  depth: number;
}

export interface EpubBook {
  title: string;
  author?: string;
  language?: string;
  chapters: EpubChapter[];
  toc: EpubTocItem[];
  /** Object URL of the cover image, when the EPUB declares one. */
  coverUrl?: string;
  totalWordCount: number;
  /** Render-ready, sanitized HTML for a spine chapter (lazy, memoized). */
  renderChapter(index: number): Promise<string>;
  /** Resolve an internal href (with optional #fragment) to a spine target. */
  resolveHref(href: string, fromChapterIndex: number): EpubHrefTarget | null;
  /** Release every object URL minted for this book. */
  dispose(): void;
}

export interface EpubHrefTarget {
  chapterIndex: number;
  fragment?: string;
}

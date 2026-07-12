/**
 * Character-offset highlighting for rendered chapters.
 *
 * Highlights are anchored to start/end character offsets within a chapter's
 * rendered text (the same text `Range.toString()` / `textContent` produce), so
 * they survive reloads and re-renders regardless of the surrounding markup. The
 * functions here are pure DOM operations and unit-tested against jsdom.
 *
 *   - getSelectionOffsets: read the current selection as offsets in a root.
 *   - applyHighlights:     wrap the offset ranges in <mark> elements.
 *   - clearHighlights:     unwrap every mark (inverse of applyHighlights).
 */

export interface HighlightSpan {
  id: string;
  start: number;
  end: number;
  color: string;
}

export interface SelectionOffsets {
  start: number;
  end: number;
  text: string;
}

/** Offsets of the current selection within `root`, or null when there isn't a
 *  usable (non-empty, in-bounds) selection. */
export function getSelectionOffsets(root: HTMLElement): SelectionOffsets | null {
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const text = range.toString();
  if (!text.trim()) return null;
  const pre = range.cloneRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  return { start, end: start + text.length, text };
}

/** Wrap each highlight's text in a `<mark class="reader-hl">`. Safe to call on
 *  freshly-rendered (mark-free) content; call clearHighlights first otherwise. */
export function applyHighlights(root: HTMLElement, highlights: HighlightSpan[]): void {
  for (const hl of highlights) {
    if (hl.end <= hl.start) continue;
    // Re-walk for each highlight: marks don't change text length, so offsets
    // stay valid, and earlier wraps only split the nodes they touched.
    const segments = collectSegments(root, hl.start, hl.end);
    for (const seg of segments) wrapTextRange(seg.node, seg.from, seg.to, hl);
  }
}

/** Remove every highlight mark, restoring the original text nodes. */
export function clearHighlights(root: HTMLElement): void {
  const marks = root.querySelectorAll("mark.reader-hl");
  for (const mark of Array.from(marks)) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  }
  root.normalize();
}

interface Segment {
  node: Text;
  from: number;
  to: number;
}

function collectSegments(root: HTMLElement, start: number, end: number): Segment[] {
  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out: Segment[] = [];
  let pos = 0;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const len = node.data.length;
    const nodeStart = pos;
    const nodeEnd = pos + len;
    if (nodeEnd > start && nodeStart < end) {
      out.push({
        node,
        from: Math.max(start, nodeStart) - nodeStart,
        to: Math.min(end, nodeEnd) - nodeStart,
      });
    }
    pos = nodeEnd;
    if (pos >= end) break;
    node = walker.nextNode() as Text | null;
  }
  return out;
}

function wrapTextRange(node: Text, from: number, to: number, hl: HighlightSpan): void {
  if (to <= from) return;
  const parent = node.parentNode;
  if (!parent) return;
  // Don't double-wrap text already inside a highlight mark.
  if ((node.parentElement as HTMLElement | null)?.classList?.contains("reader-hl")) return;
  const doc = node.ownerDocument ?? document;
  const text = node.data;
  const before = text.slice(0, from);
  const mid = text.slice(from, to);
  const after = text.slice(to);

  const mark = doc.createElement("mark");
  mark.className = "reader-hl";
  mark.setAttribute("data-hl-id", hl.id);
  mark.setAttribute("data-hl-color", hl.color);
  mark.textContent = mid;

  const frag = doc.createDocumentFragment();
  if (before) frag.appendChild(doc.createTextNode(before));
  frag.appendChild(mark);
  if (after) frag.appendChild(doc.createTextNode(after));
  parent.replaceChild(frag, node);
}

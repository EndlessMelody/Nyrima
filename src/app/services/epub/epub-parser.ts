/**
 * EPUB → Book model.
 *
 * Parses an EPUB archive (already opened with `openZip`) into a reader-friendly
 * `EpubBook`: ordered spine chapters, a flattened TOC, book metadata, and a
 * lazy `renderChapter()` that returns sanitized, theme-neutral HTML with the
 * archive's own images rewired to object URLs.
 *
 * Design choices:
 *   - We strip the publisher's stylesheets entirely. The whole point of the
 *     reader is the user's typography — author CSS (fixed colors, fonts,
 *     justified blocks) fights the calm reading themes. Inline `style`
 *     attributes are kept but scrubbed of color/font/background declarations so
 *     dark/sepia themes always win while layout hints (centering, image width)
 *     survive.
 *   - Chapter plain text is extracted up front for *every* spine item so search
 *     and word counts are instant. Rendered HTML (with object URLs) is built
 *     lazily per chapter and memoized, so a 200 MB illustrated novel doesn't
 *     mint hundreds of blob URLs before the first page shows.
 */

import { openZip, type ZipArchive } from "./unzip";
import type { EpubBook, EpubChapter, EpubHrefTarget, EpubTocItem } from "./types";

const CONTAINER_PATH = "META-INF/container.xml";

const CJK_RE = /[぀-ヿ㐀-鿿豈-﫿가-힯]/g;

/** Inline-style properties we strip so reader themes/typography always win. */
const BLOCKED_STYLE_PROPS = new Set([
  "color",
  "background",
  "background-color",
  "background-image",
  "font",
  "font-family",
  "font-size",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-shadow",
]);

export async function parseEpub(buffer: ArrayBuffer): Promise<EpubBook> {
  const zip = await openZip(buffer);

  const opfPath = await findOpfPath(zip);
  const opfDir = dirname(opfPath);
  const opfDoc = parseXml(await zip.text(opfPath), opfPath);

  const metadata = readMetadata(opfDoc);
  const manifest = readManifest(opfDoc, opfDir);
  const spineHrefs = readSpine(opfDoc, manifest);

  // Extract plain text for every spine document (cheap, all in memory).
  const docs: SpineDoc[] = [];
  for (let i = 0; i < spineHrefs.length; i++) {
    const entry = spineHrefs[i]!;
    let text = "";
    try {
      text = plainText(parseHtml(await zip.text(entry.href)));
    } catch {
      text = "";
    }
    docs.push({ id: entry.id, href: entry.href, text, wordCount: countWords(text) });
  }

  const docHrefToIndex = new Map<string, number>();
  docs.forEach((d, i) => docHrefToIndex.set(d.href.toLowerCase(), i));

  const toc = await readToc(zip, opfDoc, opfDir, manifest, docHrefToIndex);

  // Group spine documents into real chapters.
  //
  // A light novel's "chapter" usually spans several spine files: the chapter
  // text is split across continuation pages, and color illustrations are their
  // own image-only documents dropped between the prose. Rendering each spine
  // file as its own page turns those illustrations into empty "ghost" sections.
  // Instead we treat every spine doc a TOC entry points at as a chapter
  // boundary; docs *without* their own TOC entry (continuations, inline
  // illustrations) fold into the preceding chapter and render inline with its
  // text — exactly how the book reads.
  const labelByDoc = new Map<number, string>();
  const boundarySet = new Set<number>([0]);
  for (const t of toc) {
    if (t.chapterIndex < 0 || t.chapterIndex >= docs.length) continue;
    boundarySet.add(t.chapterIndex);
    if (t.label && !labelByDoc.has(t.chapterIndex)) labelByDoc.set(t.chapterIndex, t.label);
  }
  const boundaries = [...boundarySet].sort((a, b) => a - b);

  const groupOfDoc: number[] = new Array(docs.length).fill(0);
  const groupDocs: number[][] = [];
  const chapters: EpubChapter[] = [];
  for (let g = 0; g < boundaries.length; g++) {
    const start = boundaries[g]!;
    const end = g + 1 < boundaries.length ? boundaries[g + 1]! : docs.length;
    const members: number[] = [];
    for (let d = start; d < end; d++) {
      members.push(d);
      groupOfDoc[d] = g;
    }
    groupDocs.push(members);
    chapters.push({
      id: docs[start]!.id,
      href: docs[start]!.href,
      index: g,
      label: labelByDoc.get(start) ?? `Chapter ${g + 1}`,
      text: members.map((d) => docs[d]!.text).filter(Boolean).join("\n"),
      wordCount: members.reduce((sum, d) => sum + docs[d]!.wordCount, 0),
    });
  }

  // Remap TOC entries from spine-doc indices to chapter (group) indices, so the
  // contents list and link resolution both speak in chapters.
  for (const t of toc) {
    if (t.chapterIndex >= 0) t.chapterIndex = groupOfDoc[t.chapterIndex] ?? -1;
  }

  const resourceUrls = new Map<string, string>();
  const renderCache = new Map<number, string>();

  async function ensureResourceUrl(path: string): Promise<string | null> {
    const key = path.toLowerCase();
    const cached = resourceUrls.get(key);
    if (cached) return cached;
    if (!zip.has(path)) return null;
    try {
      const bytes = await zip.bytes(path);
      const mime = manifest.byHref.get(key)?.mediaType ?? guessMime(path);
      const url = URL.createObjectURL(new Blob([bytes.slice()], { type: mime }));
      resourceUrls.set(key, url);
      return url;
    } catch {
      return null;
    }
  }

  let coverUrl: string | undefined;
  const coverHref = resolveCoverHref(opfDoc, manifest);
  if (coverHref) {
    coverUrl = (await ensureResourceUrl(coverHref)) ?? undefined;
  }

  async function renderChapter(index: number): Promise<string> {
    const cached = renderCache.get(index);
    if (cached != null) return cached;
    const members = groupDocs[index];
    if (!members) return "";
    const label = chapters[index]?.label ?? "";
    const parts: string[] = [];
    for (let m = 0; m < members.length; m++) {
      const meta = docs[members[m]!]!;
      try {
        const doc = parseHtml(await zip.text(meta.href));
        await sanitizeAndRewire(doc, dirname(meta.href), ensureResourceUrl);
        // The reader renders its own chapter header from the TOC title, so a
        // book's matching first heading would show the title twice — strip it
        // from the chapter's opening document.
        if (m === 0 && doc.body) stripRedundantHeading(doc.body, label);
        const inner = doc.body ? doc.body.innerHTML : "";
        // Wrap each source document so concatenated spine files keep a little
        // breathing room (e.g. an illustration page after the prose).
        if (inner.trim()) parts.push(`<div class="reader-doc">${inner}</div>`);
      } catch {
        /* skip an unreadable member document */
      }
    }
    const html = parts.join("\n") || `<p>Could not load this chapter.</p>`;
    renderCache.set(index, html);
    return html;
  }

  function resolveHref(href: string, fromChapterIndex: number): EpubHrefTarget | null {
    if (!href) return null;
    const [pathPart, fragment] = splitFragment(href);
    // Fragment-only link → same chapter, jump to anchor.
    if (!pathPart) return { chapterIndex: fromChapterIndex, fragment };
    // Anchors carry a pre-resolved full archive path (set in rewireAnchor), so
    // try a direct lookup first; fall back to resolving against the current
    // chapter's first document for any stray relative href.
    let docIdx = docHrefToIndex.get(pathPart.toLowerCase());
    if (docIdx == null) {
      const members = groupDocs[fromChapterIndex];
      const base = members && members.length ? dirname(docs[members[0]!]!.href) : opfDir;
      docIdx = docHrefToIndex.get(resolvePath(base, pathPart).toLowerCase());
    }
    if (docIdx == null) return null;
    const group = groupOfDoc[docIdx];
    if (group == null) return null;
    return { chapterIndex: group, fragment };
  }

  function dispose(): void {
    for (const url of resourceUrls.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* already revoked */
      }
    }
    resourceUrls.clear();
    renderCache.clear();
  }

  return {
    title: metadata.title || "Untitled",
    author: metadata.author,
    language: metadata.language,
    chapters,
    toc,
    coverUrl,
    totalWordCount: chapters.reduce((sum, c) => sum + c.wordCount, 0),
    renderChapter,
    resolveHref,
    dispose,
  };
}

// ---------------------------------------------------------------------------
// OPF discovery + metadata
// ---------------------------------------------------------------------------

async function findOpfPath(zip: ZipArchive): Promise<string> {
  if (!zip.has(CONTAINER_PATH)) {
    // Fallback: scan for any .opf at the archive root.
    const opf = zip.list().find((p) => p.toLowerCase().endsWith(".opf"));
    if (opf) return opf;
    throw new Error("epub: missing META-INF/container.xml");
  }
  const doc = parseXml(await zip.text(CONTAINER_PATH), CONTAINER_PATH);
  const rootfile = doc.getElementsByTagName("rootfile")[0];
  const fullPath = rootfile?.getAttribute("full-path");
  if (!fullPath) throw new Error("epub: container.xml has no rootfile path");
  return fullPath;
}

/** A single spine document before chapters are grouped. */
interface SpineDoc {
  id: string;
  href: string;
  text: string;
  wordCount: number;
}

interface Metadata {
  title: string;
  author?: string;
  language?: string;
}

function readMetadata(opf: Document): Metadata {
  return {
    title: textOf(firstByLocal(opf, "title")),
    author: textOf(firstByLocal(opf, "creator")) || undefined,
    language: textOf(firstByLocal(opf, "language")) || undefined,
  };
}

interface ManifestItem {
  id: string;
  href: string; // normalized full path
  mediaType: string;
  properties: string;
}

interface Manifest {
  byId: Map<string, ManifestItem>;
  byHref: Map<string, ManifestItem>;
}

function readManifest(opf: Document, opfDir: string): Manifest {
  const byId = new Map<string, ManifestItem>();
  const byHref = new Map<string, ManifestItem>();
  const items = byLocal(opf, "item");
  for (const el of items) {
    const id = el.getAttribute("id");
    const rawHref = el.getAttribute("href");
    if (!id || !rawHref) continue;
    const href = resolvePath(opfDir, decodeURIComponent(splitFragment(rawHref)[0]));
    const item: ManifestItem = {
      id,
      href,
      mediaType: el.getAttribute("media-type") ?? "",
      properties: el.getAttribute("properties") ?? "",
    };
    byId.set(id, item);
    byHref.set(href.toLowerCase(), item);
  }
  return { byId, byHref };
}

function readSpine(
  opf: Document,
  manifest: Manifest,
): Array<{ id: string; href: string }> {
  const out: Array<{ id: string; href: string }> = [];
  for (const ref of byLocal(opf, "itemref")) {
    const idref = ref.getAttribute("idref");
    if (!idref) continue;
    if (ref.getAttribute("linear") === "no") continue;
    const item = manifest.byId.get(idref);
    if (!item) continue;
    // Only document-ish spine items are readable chapters.
    if (item.mediaType && !/x?html|xml/.test(item.mediaType)) continue;
    out.push({ id: item.id, href: item.href });
  }
  return out;
}

function resolveCoverHref(opf: Document, manifest: Manifest): string | null {
  // EPUB3: manifest item with properties="cover-image".
  for (const item of manifest.byId.values()) {
    if (item.properties.split(/\s+/).includes("cover-image")) return item.href;
  }
  // EPUB2: <meta name="cover" content="cover-id">.
  for (const meta of byLocal(opf, "meta")) {
    if (meta.getAttribute("name") === "cover") {
      const id = meta.getAttribute("content");
      const item = id ? manifest.byId.get(id) : undefined;
      if (item) return item.href;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Table of contents (EPUB3 nav, then EPUB2 NCX, then spine fallback)
// ---------------------------------------------------------------------------

async function readToc(
  zip: ZipArchive,
  opf: Document,
  opfDir: string,
  manifest: Manifest,
  hrefToIndex: Map<string, number>,
): Promise<EpubTocItem[]> {
  const navItem = [...manifest.byId.values()].find((i) =>
    i.properties.split(/\s+/).includes("nav"),
  );
  if (navItem && zip.has(navItem.href)) {
    try {
      const doc = parseHtml(await zip.text(navItem.href));
      const items = parseNavDoc(doc, dirname(navItem.href), hrefToIndex);
      if (items.length > 0) return items;
    } catch {
      /* fall through */
    }
  }

  const ncxId = firstByLocal(opf, "spine")?.getAttribute("toc");
  const ncxItem = ncxId ? manifest.byId.get(ncxId) : undefined;
  if (ncxItem && zip.has(ncxItem.href)) {
    try {
      const doc = parseXml(await zip.text(ncxItem.href), ncxItem.href);
      const items = parseNcxDoc(doc, dirname(ncxItem.href), hrefToIndex);
      if (items.length > 0) return items;
    } catch {
      /* fall through */
    }
  }

  // Last resort: one TOC entry per spine chapter.
  const out: EpubTocItem[] = [];
  for (const [href, index] of hrefToIndex) {
    void href;
    out.push({ label: `Chapter ${index + 1}`, chapterIndex: index, depth: 0 });
  }
  out.sort((a, b) => a.chapterIndex - b.chapterIndex);
  return out;
}

function parseNavDoc(
  doc: Document,
  navDir: string,
  hrefToIndex: Map<string, number>,
): EpubTocItem[] {
  // Prefer the <nav epub:type="toc">; fall back to the first <nav>.
  const navs = Array.from(doc.getElementsByTagName("nav"));
  const tocNav =
    navs.find((n) => (n.getAttribute("epub:type") || n.getAttribute("type")) === "toc") ??
    navs.find((n) => n.querySelector("ol")) ??
    navs[0];
  const rootOl = tocNav?.querySelector("ol");
  if (!rootOl) return [];
  const out: EpubTocItem[] = [];
  walkNavList(rootOl, 0, navDir, hrefToIndex, out);
  return out;
}

function walkNavList(
  ol: Element,
  depth: number,
  navDir: string,
  hrefToIndex: Map<string, number>,
  out: EpubTocItem[],
): void {
  for (const li of Array.from(ol.children)) {
    if (li.tagName.toLowerCase() !== "li") continue;
    const anchor = directChild(li, "a") ?? directChild(li, "span");
    const label = anchor ? collapseWs(anchor.textContent ?? "") : "";
    const href = anchor?.getAttribute("href") ?? "";
    if (label) {
      const target = resolveTocHref(href, navDir, hrefToIndex);
      out.push({
        label,
        chapterIndex: target.chapterIndex,
        fragment: target.fragment,
        depth,
      });
    }
    const childOl = directChild(li, "ol");
    if (childOl) walkNavList(childOl, depth + 1, navDir, hrefToIndex, out);
  }
}

function parseNcxDoc(
  doc: Document,
  ncxDir: string,
  hrefToIndex: Map<string, number>,
): EpubTocItem[] {
  // NCX is XML with a default namespace, so CSS `querySelector` type selectors
  // would match the null namespace and miss everything. `getElementsByTagName`
  // matches on qualified name regardless of namespace, so we use it throughout.
  const navMap = doc.getElementsByTagName("navMap")[0];
  if (!navMap) return [];
  const out: EpubTocItem[] = [];
  walkNavPoints(navMap, 0, ncxDir, hrefToIndex, out);
  return out;
}

function walkNavPoints(
  parent: Element,
  depth: number,
  ncxDir: string,
  hrefToIndex: Map<string, number>,
  out: EpubTocItem[],
): void {
  for (const point of Array.from(parent.children)) {
    if (point.tagName.toLowerCase() !== "navpoint") continue;
    // `getElementsByTagName(...)[0]` returns the navPoint's *own* label/content
    // because they precede any nested navPoint in document order.
    const navLabel = point.getElementsByTagName("navLabel")[0];
    const label = navLabel ? collapseWs(navLabel.textContent ?? "") : "";
    const href = point.getElementsByTagName("content")[0]?.getAttribute("src") ?? "";
    if (label) {
      const target = resolveTocHref(href, ncxDir, hrefToIndex);
      out.push({
        label,
        chapterIndex: target.chapterIndex,
        fragment: target.fragment,
        depth,
      });
    }
    walkNavPoints(point, depth + 1, ncxDir, hrefToIndex, out);
  }
}

function resolveTocHref(
  href: string,
  baseDir: string,
  hrefToIndex: Map<string, number>,
): { chapterIndex: number; fragment?: string } {
  if (!href) return { chapterIndex: -1 };
  const [pathPart, fragment] = splitFragment(decodeURIComponent(href));
  const full = resolvePath(baseDir, pathPart).toLowerCase();
  const idx = hrefToIndex.get(full);
  return { chapterIndex: idx ?? -1, fragment };
}

// ---------------------------------------------------------------------------
// Chapter sanitization + resource rewiring
// ---------------------------------------------------------------------------

async function sanitizeAndRewire(
  doc: Document,
  chapterDir: string,
  ensureResourceUrl: (path: string) => Promise<string | null>,
): Promise<void> {
  const body = doc.body;
  if (!body) return;

  // Drop publisher styling + anything executable.
  for (const el of Array.from(
    body.querySelectorAll("script, style, link, base, meta, title"),
  )) {
    el.remove();
  }

  // Resolve images concurrently.
  const imgJobs: Promise<void>[] = [];
  for (const img of Array.from(body.querySelectorAll("img"))) {
    img.removeAttribute("srcset");
    const src = img.getAttribute("src");
    if (!src || /^(https?:|data:)/i.test(src)) continue;
    const full = resolvePath(chapterDir, decodeURIComponent(splitFragment(src)[0]));
    imgJobs.push(
      ensureResourceUrl(full).then((url) => {
        if (url) img.setAttribute("src", url);
        else img.remove();
      }),
    );
    img.setAttribute("loading", "lazy");
  }

  // SVG <image> (cover pages often use this wrapper).
  for (const image of Array.from(body.querySelectorAll("image"))) {
    const href =
      image.getAttribute("xlink:href") || image.getAttribute("href");
    if (!href || /^(https?:|data:)/i.test(href)) continue;
    const full = resolvePath(chapterDir, decodeURIComponent(splitFragment(href)[0]));
    imgJobs.push(
      ensureResourceUrl(full).then((url) => {
        if (url) {
          image.setAttribute("href", url);
          image.setAttribute("xlink:href", url);
        }
      }),
    );
  }

  await Promise.all(imgJobs);

  // Walk every element: scrub event handlers + inline style, rewire links.
  const all = body.querySelectorAll("*");
  for (const el of Array.from(all)) {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
    }
    const style = el.getAttribute("style");
    if (style) {
      const cleaned = scrubInlineStyle(style);
      if (cleaned) el.setAttribute("style", cleaned);
      else el.removeAttribute("style");
    }
    if (el.tagName.toLowerCase() === "a") rewireAnchor(el, chapterDir);
  }
}

function rewireAnchor(el: Element, chapterDir: string): void {
  const href = el.getAttribute("href");
  if (!href) return;
  if (/^(https?:|mailto:)/i.test(href)) {
    el.setAttribute("target", "_blank");
    el.setAttribute("rel", "noopener noreferrer");
    return;
  }
  // Internal link — tag it so the reader can intercept and jump chapters.
  const [pathPart, fragment] = splitFragment(decodeURIComponent(href));
  const full = pathPart ? resolvePath(chapterDir, pathPart) : "";
  el.setAttribute("data-epub-href", full);
  if (fragment) el.setAttribute("data-epub-fragment", fragment);
}

/**
 * Remove a chapter's opening heading when it merely repeats the chapter title
 * (which the reader already renders in its own header). Only the first heading
 * is considered, and only when it matches the label, so genuine sub-headings
 * survive.
 */
function stripRedundantHeading(body: HTMLElement, label: string): void {
  const target = normalizeHeading(label);
  if (!target) return;
  const first = body.querySelector("h1, h2, h3, h4, h5, h6");
  if (!first) return;
  const norm = normalizeHeading(first.textContent ?? "");
  if (!norm) return;
  const matches =
    norm === target ||
    (target.length > 6 && (target.includes(norm) || norm.includes(target)));
  if (!matches) return;
  // Drop an enclosing <header> if it wrapped only this heading; else the heading.
  const header = first.closest("header");
  if (
    header &&
    header.querySelectorAll("h1, h2, h3, h4, h5, h6").length === 1 &&
    collapseWs(header.textContent ?? "") === collapseWs(first.textContent ?? "")
  ) {
    header.remove();
  } else {
    first.remove();
  }
}

function normalizeHeading(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scrubInlineStyle(style: string): string {
  return style
    .split(";")
    .map((decl) => decl.trim())
    .filter((decl) => {
      if (!decl) return false;
      const prop = decl.split(":")[0]?.trim().toLowerCase() ?? "";
      return !BLOCKED_STYLE_PROPS.has(prop);
    })
    .join("; ");
}

// ---------------------------------------------------------------------------
// XML / HTML / path utilities
// ---------------------------------------------------------------------------

function parseXml(text: string, label: string): Document {
  const doc = new DOMParser().parseFromString(stripBom(text), "application/xml");
  const err = doc.getElementsByTagName("parsererror")[0];
  if (err) throw new Error(`epub: failed to parse ${label}`);
  return doc;
}

function parseHtml(text: string): Document {
  // text/html is the most forgiving parser and handles <ruby> furigana,
  // unclosed tags, and XHTML alike.
  return new DOMParser().parseFromString(stripBom(text), "text/html");
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Elements anywhere in the doc with the given local name, namespace-agnostic. */
function byLocal(doc: Document, localName: string): Element[] {
  return Array.from(doc.getElementsByTagNameNS("*", localName));
}

function firstByLocal(doc: Document, localName: string): Element | null {
  return doc.getElementsByTagNameNS("*", localName)[0] ?? null;
}

function textOf(el: Element | null): string {
  return el ? collapseWs(el.textContent ?? "") : "";
}

function directChild(parent: Element, tag: string): Element | null {
  for (const child of Array.from(parent.children)) {
    if (child.tagName.toLowerCase() === tag) return child;
  }
  return null;
}

function plainText(doc: Document): string {
  const body = doc.body;
  if (!body) return "";
  for (const el of Array.from(body.querySelectorAll("script, style"))) el.remove();
  return collapseWs(body.textContent ?? "");
}

function collapseWs(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function countWords(text: string): number {
  const cjk = (text.match(CJK_RE) || []).length;
  const latin = (
    text.replace(CJK_RE, " ").match(/[A-Za-z0-9À-ɏ'’-]+/g) || []
  ).length;
  return cjk + latin;
}

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(0, idx) : "";
}

function splitFragment(href: string): [string, string | undefined] {
  const hashIdx = href.indexOf("#");
  if (hashIdx < 0) return [href, undefined];
  return [href.slice(0, hashIdx), href.slice(hashIdx + 1) || undefined];
}

function resolvePath(baseDir: string, relative: string): string {
  const stack = baseDir ? baseDir.split("/").filter(Boolean) : [];
  for (const part of relative.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

function guessMime(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "webp":
      return "image/webp";
    case "css":
      return "text/css";
    case "woff":
      return "font/woff";
    case "woff2":
      return "font/woff2";
    case "ttf":
      return "font/ttf";
    case "otf":
      return "font/otf";
    default:
      return "application/octet-stream";
  }
}

/**
 * Local copy of BlockNote's default named-color palette (light variant
 * only — see the header note on why). The editor lets an author pick a
 * block or text-run color from this named set (e.g. "red", "blue"), and
 * `post-doc.ts`'s sanitizer accepts either one of these tokens or a raw
 * hex code (`sanitizeColorToken`). This is copied rather than imported
 * from `@blocknote/core` so the reader bundle stays free of any BlockNote
 * dependency — readers must never pay the editor's bundle cost.
 */

const NAMED_COLORS: Record<string, { text: string; background: string }> = {
  gray: { text: "#9b9a97", background: "#ebeced" },
  brown: { text: "#64473a", background: "#e9e5e3" },
  red: { text: "#e03e3e", background: "#fbe4e4" },
  orange: { text: "#d9730d", background: "#f6e9d9" },
  yellow: { text: "#dfab01", background: "#fbf3db" },
  green: { text: "#4d6461", background: "#ddedea" },
  blue: { text: "#0b6e99", background: "#ddebf1" },
  purple: { text: "#6940a5", background: "#eae4f2" },
  pink: { text: "#ad1a72", background: "#f4dfeb" },
};

export function resolveColor(token: string, kind: "text" | "background"): string {
  if (token === "default") return "inherit";
  const named = NAMED_COLORS[token];
  if (named) return named[kind];
  // Hex code or another literal CSS color — post-doc.ts's sanitizer already
  // constrained the charset before this ever reaches the renderer.
  return token;
}

/**
 * Stub for `prismjs`. Once UI's CodeBlock module imports it for syntax
 * highlighting; we don't ship CodeBlock, so this exists purely to satisfy
 * Rollup's static analysis of the lazy chunk.
 */

const noop = () => undefined;

export const languages: Record<string, unknown> = {};
export const plugins: Record<string, unknown> = {};
export const hooks = { add: noop, run: noop };

export function highlight(code: string): string {
  return code;
}
export function highlightAll(): void {
  /* noop */
}
export function highlightAllUnder(): void {
  /* noop */
}
export function highlightElement(): void {
  /* noop */
}
export function tokenize(): unknown[] {
  return [];
}

export const util = {
  encode: (s: string) => s,
  type: (_o: unknown) => "Object",
  objId: () => 0,
  clone: <T,>(o: T): T => o,
  setLanguage: noop,
};

const Prism = {
  languages,
  plugins,
  hooks,
  highlight,
  highlightAll,
  highlightAllUnder,
  highlightElement,
  tokenize,
  util,
};

export default Prism;

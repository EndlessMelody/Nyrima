/**
 * Empty stub module.
 *
 * @once-ui-system/core lists `prismjs`, `compressorjs`, `recharts` and `sharp`
 * as *optional* peer dependencies — they back the CodeBlock, MediaUpload,
 * chart modules etc. We don't use any of those components, but the package's
 * `dist/index.js` re-exports them all, so Rollup walks into the implementation
 * files and tries to resolve their imports.
 *
 * Pointing those bare specifiers at this empty module via Vite alias lets the
 * tree-shaker silently drop the unused code paths.
 */

export default {} as never;

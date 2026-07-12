/**
 * Rendered for any block type the sanitizer marked `unsupported` (unknown
 * to this client) or that this version of the renderer doesn't yet display
 * (a block the sanitizer whitelists ahead of the editor exposing it, e.g.
 * `spoiler`/`callout`/`rating`/`animeCard` — v2 scope). Keeps the rest of
 * the post readable instead of the whole page failing.
 */
export function UnsupportedBlock() {
  return (
    <div className="ny-post-unsupported-block">
      This block isn't supported yet — open it in a newer version of Nyrima.
    </div>
  );
}

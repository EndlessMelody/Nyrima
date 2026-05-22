# Nyrima Styling Guidance

Use this before adding or materially changing a Nyrima surface. For Once UI
integration details, also read
[`once-ui-guidance.md`](./once-ui-guidance.md).

## 1. Visual Roles

Nyrima has related but distinct visual zones.

| Zone | Visual job |
| --- | --- |
| App shell | Calm cinematic frame, sticky topbar, clear navigation. |
| Lobby/library | Media-rich browsing with posters, shelves, grids, grouping, scanning. |
| Social/settings/setup | Denser operational UI with clear controls, statuses, and copy. |
| Player | Dark-first, media-dominant cinema chrome with restraint around video. |
| External promo site | Public explanation/distribution site; aligned brand, more marketing/FAQ/legal structure. |

Do not style every page as a landing page. The extension first screen is a
working app.

## 2. Theme And Tokens

The app uses Once UI token variables plus Nyrima custom tokens in
`src/app/styles/anime-theme.scss`.

- Theme follows `data-theme="dark|light"` on `<html>`.
- The HTML root sets Once UI data attributes for brand/accent/neutral/surface
  behavior.
- Prefer existing CSS variables:
  - `--page-background`
  - `--surface-background*`
  - `--neutral-*`
  - `--brand-*`
  - `--accent-*`
  - `--dc-*`
  - `--ny-radius-*`
- Add a new token only when repeated use or theme compatibility needs it.

### Palette posture

- Current extension mood is Midnight/Pearl with pink brand and cyan accent.
- Use neutrals and surface contrast so the app does not become a single-hue
  neon wash.
- Reserve high-saturation glow for brand/action/media emphasis.
- Keep status colors semantic.

## 3. Typography

Nyrima already separates body, display, mono/timecode, wordmark, and subtitle
font roles.

- Use display/heading treatment for true section and media headings.
- Use body type for supporting copy and operational labels.
- Use mono/tabular numerals for timecodes, counters, IDs, stats, and compact
  technical/status readouts.
- Keep letter spacing readable. Follow existing tracker/wordmark cases rather
  than inventing broad tracking everywhere.
- Compact surfaces need compact headings. Hero-scale type belongs to actual
  hero/media emphasis only.

## 4. Layout Density

### General app pages

- Use the routed page grid and max-width conventions already present in
  `.dc-page`.
- Prefer unframed page bands and sections over cards inside cards.
- Keep page sections scan-friendly: headings, hairlines, shelves, rows,
  grouped controls.

### Operational surfaces

Settings, OAuth/setup, social privacy, inbox, and diagnostics should be:

- Quiet.
- Dense enough for repeated use.
- Clear about state and errors.
- Driven by familiar controls rather than explanatory decoration.

### Media surfaces

Lobby and library pages can carry more poster/backdrop/media presence while
keeping actions predictable.

## 5. Reusable Building Blocks

### Cards

- Use cards for repeated media/library/share items, modals, and truly framed
  tools.
- Do not stack cards inside page-section cards.
- Keep card radius near established small/medium values.
- Hover lift and glow should remain subtle and tied to existing tokens.

### Rows and shelves

- Use shelves for horizontal media exploration.
- Use rows/tables for inbox-like comparison surfaces.
- Keep metadata alignment stable. Counters and badges should not resize the
  entire row unexpectedly.

### Controls

- Icons belong in tool buttons when the command is obvious.
- Use segmented controls, toggles, inputs, sliders, menus, and tabs for their
  familiar jobs.
- Buttons should read as commands, not explanatory copy blocks.
- Tooltips are preferable when a compact icon needs explanation.

### Banners and status

- Status surfaces should name the problem and next action.
- Error copy should distinguish OAuth, API-key, Drive permission, rate limit,
  import, and playback failure when the code can.

## 6. Surface Guidance

### App shell

- The shell is a persistent frame, not the star.
- Reuse the glass/hairline sticky-header language.
- Keep brand/navigation/search balanced in compact and broad states.
- Respect reduced-motion branches for ambient motion.

### Lobby and library

- Posters and backdrops should reveal the actual user's media/artwork.
- Continue Watching, library stats, pinned surfaces, filters, sorting, and
  grouped view controls need scannability.
- Stable poster aspect ratios and responsive grid tracks matter more than
  decorative wrappers.
- Empty artwork state should still look intentional.

### Social hub

- Treat the social hub as a Drive metadata tool.
- Inbox, People, Activity, My Shares, and Privacy need clear attribution,
  target/permission expectations, sync state, and read states.
- Public/private sharing state must be visually legible.

### Setup and settings

- Make access configuration feel trustworthy and explicit.
- Separate API key versus OAuth copy and controls.
- Keep removal/sign-out/cache/history actions visible but not dominant.

### Player

- Video remains primary.
- HUD chrome can be expressive, but it must not occlude media or subtitle
  content incoherently.
- Keep timecodes, track selectors, subtitle controls, seek surfaces, and
  next-up/resume states stable.
- Poster/backdrop ambient treatment should not imply live video-frame access
  that the Drive/CORS path does not provide.

## 7. Interaction States

Every new surface should consider:

- loading
- empty
- hover/focus
- disabled
- active/selected
- error/retry
- permission/auth required
- long text and missing media

Focus must stay visible. Do not rely on color alone for important state.

## 8. Responsive And Text-Fit Rules

- Give fixed-format media tiles, toolbars, badges, counters, and grids stable
  dimensions/constraints.
- Long Drive names, captions, handles, and errors must wrap, clamp, or size
  safely.
- Do not let button labels or controls overlap neighboring UI.
- Mobile compaction should preserve primary workflows rather than hiding the
  only useful action.

## 9. Accessibility

- Keep keyboard focus visible.
- Keep labels for inputs and dialog intent clear.
- Use semantic buttons for commands.
- Keep contrast readable in both Midnight and Pearl theme moods.
- Respect reduced-motion behavior when ambient animation is added.

## 10. External Promo Site Alignment

The separate promo site can be more editorial than the extension, but it must
stay honest about current behavior.

- Use Nyrima brand signals immediately.
- Show the product/package and installation path clearly.
- Give Q&A/FAQ, privacy, terms, support/contact, and package download/upload
  routes clear hierarchy.
- Do not make public hero copy promise backend sync, unshipped privacy features,
  or future realtime behavior as current.

## 11. Reuse Checklist

Before inventing a new style:

1. Search similar page/component SCSS.
2. Reuse existing token vocabulary.
3. Reuse existing radius/hairline/control language.
4. Check dark and light themes.
5. Check compact width and long text.
6. Verify the surface still feels like its role: browse, operate, or watch.

## 12. Avoid

- Cards nested inside cards for page structure.
- Oversized marketing composition inside operational extension pages.
- Decorative orbs/bokeh-like filler.
- One-tone palette drift.
- New control shapes that fight familiar icon/toggle/tab/input semantics.
- Hero or player chrome that hides the actual product/media state.


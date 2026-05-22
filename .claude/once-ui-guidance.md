# Once UI Guidance For Nyrima

Nyrima uses Once UI inside a Vite Chrome extension, not a Next.js app. That
detail matters.

## 1. Current Integration

The app imports:

- `@once-ui-system/core/css/styles.css`
- `@once-ui-system/core/css/tokens.css`

from `src/app/providers/AppProviders.tsx`.

The root extension HTML sets Once UI data attributes such as:

```html
data-theme="dark"
data-brand="yellow"
data-accent="red"
data-neutral="slate"
data-solid="contrast"
data-solid-style="flat"
data-border="conservative"
data-surface="filled"
data-transition="all"
data-scaling="100"
```

Nyrima custom SCSS then maps/overrides token behavior for its Midnight/Pearl
cinematic theme.

## 2. Provider Model

Do not casually import the canonical Next-oriented Once UI provider wrapper.
This project is a Vite extension and has historically avoided provider paths
that pull `next/navigation`.

Current provider responsibilities:

- Nyrima owns theme state and mirrors resolved theme to `<html data-theme>`.
- `LayoutProvider` exists for Once UI layout components that need layout
  context.
- `IconProvider` and `ToastProvider` are available from pure React contexts.

If changing this provider model, verify the bundle and extension runtime rather
than assuming web-app defaults work.

## 3. Token Strategy

### Prefer tokens

Prefer token-backed styles for:

- surfaces
- borders/hairlines
- foreground strength
- brand/accent emphasis
- status
- radii
- focus and hover treatments

This keeps dark/light theme flips coherent.

### Use local SCSS intentionally

Use component SCSS when:

- the component already has a local SCSS pattern
- layout/animation is Nyrima-specific
- the player/social/library surface needs bespoke composition

Do not bypass token/theme behavior with random fixed colors when a current
token expresses the role.

## 4. Once UI Primitives Versus Nyrima Components

### Use Once UI where it fits

Use Once UI primitives when they:

- match an existing layout or typography need
- work inside current providers
- reduce custom scaffolding without pulling incompatible dependencies

### Reuse Nyrima components where ownership already exists

Prefer existing Nyrima components for:

- app shell/topbar behavior
- poster/library cards
- Drive/player surfaces
- sharing/social controls
- access/setup/user-center panels

Do not create parallel versions of established components simply because Once
UI has a nearby primitive.

## 5. Typography

- Let Once UI/token typography coexist with Nyrima font roles.
- Follow the display/body/mono hierarchy already in `fonts.scss` and theme
  rules.
- Numeric media UI should keep tabular readability.
- Do not scale type with viewport width in new surfaces.

## 6. Layout

- Once UI layout helpers must not turn the extension into card-heavy marketing
  pages.
- Use constrained routed content, unframed sections, stable grids, and dense
  panels where existing Nyrima pages do.
- Ensure Once UI Flex/Row/Column usage stays under `LayoutProvider`.

## 7. Theming Changes

Before changing root data attributes or token mappings:

1. Inspect `src/app/index.html`.
2. Inspect `src/app/providers/AppProviders.tsx`.
3. Inspect `src/app/styles/anime-theme.scss`.
4. Check dark/light theme behavior on affected surfaces.
5. Update styling guidance/docs when the contract changes.

## 8. Interactions And States

Once UI composition still needs Nyrima states:

- explicit loading/empty/error UI
- visible focus
- disabled state
- auth/permission state
- long-text behavior
- responsive compaction

Do not assume a primitive alone supplies the product state model.

## 9. Chrome Extension Constraints

- Extension CSP and bundling matter.
- Keep dependencies and assets compatible with Vite/CRXJS output.
- Do not add Next-only imports to app surfaces.
- Verify build output when adding Once UI-related imports beyond patterns
  already used in the repo.

## 10. Review Checklist

For a new Once UI-backed surface:

- Does it run under current providers?
- Does it use existing token and SCSS vocabulary?
- Does it match the surface role from `styling.md`?
- Does it work in dark and light theme?
- Does long Drive/user text fit?
- Does keyboard focus show?
- Does it avoid unnecessary marketing/card-heavy structure?
- Does it avoid introducing Next-specific dependencies?


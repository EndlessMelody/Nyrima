# Nyrima Claude Project Memory Design

**Date:** 2026-05-22

## Goal

Replace a stale standalone MKV remux handoff note with durable project memory
for future Nyrima work. The new guidance must live in tracked `.claude`
Markdown files, keep local permission settings separate, update the repository
README with current stack and promo-site context, and preserve the current
deployment documentation pass already in progress.

## Scope

This pass will:

- Delete `NOTES_mkv_remux.txt`.
- Add a tracked multi-file `.claude` guidance set for future contributors and
  agent sessions.
- Give Once UI and Nyrima styling its own detailed guidance files.
- Record the external promo-site contract as a separate public distribution
  surface for package hosting, Q&A/FAQ, install guidance, policy pages, and
  support links.
- Refresh README development information and technology-stack detail from the
  current package/runtime shape.

This pass will not build the separate promo site or change the extension
runtime behavior.

## Guidance Structure

The existing `.claude/settings.local.json` remains local tool permission state.
Durable tracked guidance will be split into focused Markdown files:

| File | Responsibility |
| --- | --- |
| `.claude/README.md` | Index, reading order, and separation between durable guidance and local settings. |
| `.claude/workflow.md` | Nyrima work lifecycle, documentation updates, verification, release habits, git hygiene, and scratch-note policy. |
| `.claude/artifacts.md` | Durable artifact map for docs, specs, plans, packages, promo-site materials, and cleanup rules. |
| `.claude/system-design.md` | Current system boundaries and design rules future work should preserve or deliberately redesign. |
| `.claude/patterns.md` | Reusable code, testing, security, and documentation patterns. |
| `.claude/styling.md` | Detailed visual system guidance across app surfaces and promo-site relationship. |
| `.claude/once-ui-guidance.md` | Detailed Once UI integration guidance for this Vite/Chrome extension. |

The files will cross-link rather than repeat large architecture or policy
documents. Canonical deploy docs remain in `docs/`.

## Workflow Guidance

`.claude/workflow.md` will cover:

- Read current docs/code before asserting behavior.
- Use `PHASES.md` for shipped/deferred engineering status.
- Use design specs and plans for substantial work.
- Update user docs, architecture docs, OAuth docs, permission docs, policy
  docs, or README when a change alters their claims.
- Verify builds/tests according to risk and never claim completion from stale
  output.
- Keep dirty user work, avoid destructive Git cleanup, and make artifacts
  intentional.
- Promote durable lessons into `.claude`, docs, tests, or code comments rather
  than leaving repository-root scratch notes behind.

## Artifact Guidance

`.claude/artifacts.md` will define:

- `README.md` as the public repository entry point.
- `docs/` as deploy/user/developer/policy documentation.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` as approved design
  and execution history.
- `PHASES.md` as the status tracker.
- `dist/` and packaged release archives as build artifacts, not hand-edited
  source.
- The external promo website as the public hosted distribution/info surface.

The promo website contract will name:

- Package upload/download path or release package link.
- Public Q&A/FAQ.
- Privacy policy, terms, install, support/contact, and reviewer/store-facing
  links.
- Alignment with repository docs so public claims do not drift from extension
  behavior.

## System Design Guidance

`.claude/system-design.md` will describe the current rules that future work
must understand:

- Chrome Manifest V3 contexts: manifest, background service worker, app page,
  Drive content script, and popup.
- Drive-first media/data ownership with no Nyrima backend receiving media.
- API-key public-file path versus BYOK OAuth signed-in path.
- Service-worker OAuth/token/DNR responsibilities.
- Local storage, session token storage, IndexedDB cache, and Drive-written
  sharing/import data boundaries.
- Native-first playback, supported MKV MSE remux fallback, subtitles, and
  JASSUB.
- Optional Drive-native sharing and public-metadata semantics.
- Sanitization/trust boundaries for public share and directory data.

## Pattern Guidance

`.claude/patterns.md` will preserve patterns worth reusing:

- Route Drive operations through existing auth/queue/service helpers.
- Reuse existing stores and file-boundary services before adding abstractions.
- Treat Drive IDs and public metadata as untrusted at boundaries.
- Respect sharing read-modify-write races and app-created write scope.
- Keep remux/media changes regression-tested against known gotchas.
- Keep policy/data claims auditable against manifest and code.
- Scale tests and manual Chrome checks to change risk.

## Styling Guidance

`.claude/styling.md` will be detailed and multi-section:

- Visual roles: Once UI-backed app shell, dense operational surfaces, cinematic
  player surfaces, and the separate public promo site.
- Palette/theming guardrails, data-theme use, typography hierarchy, spacing,
  page layout density, section framing, cards, controls, tables/rows, shelves,
  banners, dialogs, error/empty states, and responsive text-fit rules.
- Surface-specific rules for lobby/library, social hub, player, setup/settings,
  and any future promo-site alignment.
- Reuse rules and avoid-list for visual drift.

`.claude/once-ui-guidance.md` will carry the Once UI-specific detail:

- How Once UI tokens and data attributes are used by the current app.
- Why this Vite extension does not import Next-specific Once UI provider
  wrappers.
- How to compose new screens with existing local SCSS and app components.
- When to use Once UI primitives versus current Nyrima custom components.
- Theme, typography, spacing, interaction, accessibility, and responsive
  consistency checks.

## README Updates

README changes will:

- Keep the current user-first product intro.
- Add a current technology-stack section based on the repository package and
  architecture shape.
- Explain the external Nyrima promo site as the public package/info surface
  without pretending it is the extension runtime.
- Add a contributor/project-memory pointer to `.claude/README.md`.

## Validation

The implementation will be checked by:

- Confirming `NOTES_mkv_remux.txt` is removed.
- Reviewing `.claude` links and making sure durable guidance does not edit
  `.claude/settings.local.json`.
- Searching README/docs/guidance for conflicting promo-site and tech-stack
  claims.
- Running `git diff --check`.
- Running the project test command before completion because README and
  project guidance are part of the deploy-facing repository state.


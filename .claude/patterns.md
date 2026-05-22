# Nyrima Reusable Patterns

Use these patterns to keep future work aligned with the existing codebase.

## Drive Requests

- Prefer `services/auth.ts` and `services/drive-api.ts` over ad hoc Drive
  fetches.
- Let the Drive request queue, dedup layer, retry/backoff, and typed access
  errors keep one behavior across UI surfaces.
- Validate Drive IDs and escape Drive query literals at boundaries.
- Treat metadata list success and media/copy permission success as different
  Drive outcomes.

## Auth

- Keep API key and OAuth behavior separate in code and copy.
- OAuth belongs behind runtime messages and the background worker flow.
- Direct `<video>` signed-in playback depends on the DNR bearer-header rule;
  avoid "quick" token-in-URL workarounds unless investigated and designed.
- Update OAuth docs and permissions/data docs whenever scopes or token/session
  rules change.

## Stores And Services

- Reuse an existing store when it already owns UI-persistent state.
- Put Drive/file-format boundaries in services, not scattered React
  components.
- Keep React components focused on UI orchestration and interaction states.
- Prefer typed parsers/sanitizers over cast-and-trust logic for external JSON.

## Public Input Sanitization

Public Drive and directory surfaces are untrusted:

- Validate share index owner, IDs, schema version, timestamps, lengths, and
  image URL hosts.
- Validate directory entries before caching/rendering them.
- Keep comments tolerant of malformed lines without trusting arbitrary shape.
- Do not turn public caption/comment/profile text into HTML rendering.

## Sharing Writes

- Remember Drive has no atomic JSON patch or true JSONL append.
- Use the existing local mutation queues for same-context share/comment writes.
- Surface partial import failures rather than silently changing semantics.
- Preserve the difference between public share metadata and target Drive
  permission.

## Storage And Reset

- Local persistent state belongs in the existing storage keys/stores unless a
  new boundary is justified.
- Drive-account-specific caches should reset on root/account repointing.
- Keep user preferences and access configuration only where current reset
  behavior intentionally keeps them.
- Avoid large unbounded storage blobs; use cache caps and local cleanup paths.

## Media And Remux Work

Before editing fragile media behavior, read the relevant tests and the current
remux services.

Pin regressions for gotchas such as:

- fMP4 field order and codec box shape.
- Decode-order preservation.
- MKV lacing parsing and frame splitting.
- Buffer append/seek/audio-track switch recovery.
- AC-3/external audio recovery when Chromium rejects direct combinations.

Prefer a small targeted test for format logic plus a broader player/controller
test when lifecycle behavior changes.

## UI Reuse

- Prefer established app components, stores, SCSS naming style, and local
  controls before introducing a new visual abstraction.
- Keep app surfaces work-focused and scannable. The player may be more
  cinematic than settings/social tables.
- Read [`styling.md`](./styling.md) and
  [`once-ui-guidance.md`](./once-ui-guidance.md) before adding a major surface.

## Docs And Policy Claims

When a change touches permissions, endpoints, storage, OAuth, sharing
visibility, public site claims, or data flow:

1. Search the code/manifest for the new behavior.
2. Update the canonical doc.
3. Search README/docs/.claude for stale claims.
4. Keep privacy/terms public wording grounded in actual behavior.

## Test Strategy

| Change | Minimum attention |
| --- | --- |
| Pure parser/helper change | Focused unit test |
| Drive auth/sharing/storage logic | Unit tests plus state/permission-path review |
| Player/remux/subtitle lifecycle | Regression tests plus build/manual media check when feasible |
| Frontend surface | State/accessibility/responsive review and browser check when feasible |
| Docs/guidance only | Claim/link/stale-text search and whitespace validation |

Run broader verification before claiming a deploy-facing pass is ready.


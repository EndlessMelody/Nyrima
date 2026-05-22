# Deploy Readiness Finish Pass Design

Date: 2026-05-22

## Goal

Finish the current AC-3/remux working tree as the deploy candidate instead of
discarding it. The pass closes the two review blockers before packaging:

- backward AC-3 media seek recovery must not restart normal streaming after it
  failed to prove that the target is video-buffered;
- followed users' public `Shared/index.json` payloads must be validated before
  the social store trusts them.

## Scope

This pass keeps the current player, decoder, dependency, and generated icon
changes already in the worktree. It adds only the regression tests and code
needed to close the two blockers, then runs release verification and leaves the
deploy candidate committed with a clean worktree.

It does not add new product surfaces, redesign the player, change Drive sharing
semantics, or do broad performance work on the large Vite chunks.

## Approach

### AC-3 seek recovery

The MSE controller remains the authority for out-of-buffer external-audio seeks.
When random-access media catch-up appends a seek window, it should request a
normal stream restart only after `waitForVideoBufferedAt()` confirms that the
requested target is video-buffered. A failed proof remains incomplete recovery:
it logs diagnostics and lets the current recovery state unwind without moving
the main stream cursor past an unusable target.

The regression test should exercise the decision at controller level with the
smallest test harness available around the private recovery method. It should
demonstrate that successful recovery restarts the stream and failed recovery
does not.

### Shared index boundary

`readShareIndex()` is the parsing boundary for the public social manifest. It
should sanitize the JSON payload into a valid `ShareIndex` before callers use
it. Invalid owner metadata, malformed timestamps, bad Drive IDs, unsupported
targets, wrong entry versions, overlong plain-text fields, and unsafe image
URLs should not reach the social store.

The directory client already uses explicit sanitizers for a public payload; the
index reader should follow that defensive style. It may preserve valid optional
plain-text fields and Drive-hosted poster/avatar URLs while dropping malformed
entries. A manifest with no valid owner or no `entries` array is unreadable and
returns `null`.

## Error Handling

- Superseded and aborted seek work keeps the existing quiet abort behavior.
- Failed seek buffering does not claim success by restarting the stream.
- A malformed followed-user index degrades to an unreadable index or a smaller
  sanitized entry list instead of crashing follow or sync.
- Release verification failures stop the deploy-prep pass until resolved.

## Tests And Verification

- Add controller regression coverage for media seek restart gating.
- Add share-index sanitizer coverage for malformed public manifests and unsafe
  target fields.
- Run the current unit suite, build, production dependency audit, diff checks,
  and extension packaging script before claiming deploy readiness.

## Success Criteria

- The current AC-3/remux work stays in the deploy candidate.
- Failed backward media seek recovery does not advance normal streaming past an
  unbuffered target.
- Public share-index bytes are validated before social-store consumption.
- Verification and packaging commands succeed, and intentional changes are
  committed so the working tree is clean for deployment.

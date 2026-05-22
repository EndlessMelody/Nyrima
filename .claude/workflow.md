# Nyrima Workflow Guidance

Use this file when starting or finishing work in Nyrima.

## Start With Current Context

- Check the working tree before editing. Nyrima may already have user or
  agent changes in progress.
- Read the files nearest the change before assuming the implementation shape.
- Use `rg` and `rg --files` for repository searches.
- Check `PHASES.md` before making roadmap claims.
- Check deploy docs before changing privacy, OAuth, permission, sharing, or
  architecture claims.

## Work Shape

### Small changes

Keep small changes small:

- Reuse an existing service, store, helper, SCSS pattern, and route boundary
  when one already owns the concern.
- Add a focused test when behavior changes and the logic is testable.
- Update only docs whose claims change.

### Larger changes

For multi-step or behavior-changing work:

1. Clarify scope and success criteria.
2. Write or update the design spec under `docs/superpowers/specs/`.
3. Write the implementation plan under `docs/superpowers/plans/`.
4. Implement against the current code patterns.
5. Verify with fresh commands and report the actual result.

The plan is not product documentation. Keep it as execution history; update
user/developer docs separately when the product surface changes.

## Documentation Update Triggers

Update these artifacts when their claim changes:

| Change | Update |
| --- | --- |
| Product capability, setup flow, tech stack, docs map | `README.md` and relevant user docs |
| System boundary, storage, endpoint, auth, sharing, player architecture | `docs/architecture.md` |
| Google OAuth flow, scope, tester setup, client-ID handling | `docs/oauth-setup.md` |
| Manifest permission, host, scope, endpoint, storage, public-data handling | `docs/permissions-and-data-use.md` and policy docs when public claims change |
| Shipping/deferred ticket state | `PHASES.md` |
| Reusable architecture/styling/workflow rule | `.claude/*.md` |

## Verification

Completion claims need fresh evidence.

### Logic/runtime changes

Prefer:

```bash
npm run check
npm run build
```

Use focused tests during iteration and rerun the relevant broad check before
handoff. Browser-visible changes need manual or automated Chrome verification
when the affected flow can be exercised.

### Docs/guidance changes

Use:

```bash
npm run docs:check
git diff --check
rg -n "<stale claim>" README.md docs .claude
```

Run `npm test` before a completion handoff when the pass is part of deploy
readiness or touches repository-level guidance used by release work.

## Deploy Habits

- Use `npm run release:check` before handing off a deployment candidate.
- Use `npm run package` to build the real upload ZIP in `dist-zip/` and keep
  the printed SHA-256 with release notes when an artifact leaves the repo.
- Use `npm run inspect:manifest` when reviewing generated permissions, hosts,
  entry points, and icons from `dist/`.
- Build the unpacked extension from `dist/` for Chrome extension checks.
- Recheck OAuth on the real loaded extension ID for development/test clients.
- Keep API-key and OAuth flows distinct in docs and debugging.
- Review public policy/docs claims against manifest permissions and code paths.
- Treat release archives in `dist-zip/` as generated artifacts.

## Git Hygiene

- Do not discard unrelated dirty work.
- Avoid destructive Git commands unless the user clearly asks for them.
- Read user-touched files carefully before editing them.
- Keep commits intentional: design history, implementation changes, and deploy
  candidates should be understandable from their diff.

## Scratch Notes

Do not leave root-level "where we are" notes as long-lived project memory.
They drift quickly.

When a scratch note contains durable value:

| Note content | Promote it to |
| --- | --- |
| Reproducible bug cause | Regression test and code comment if needed |
| Architecture invariant | `docs/architecture.md` or `.claude/system-design.md` |
| Reusable implementation gotcha | `.claude/patterns.md` |
| User/tester instruction | User docs or troubleshooting docs |
| Work-session history | Approved spec/plan or commit message |

Delete stale scratch notes after promotion.

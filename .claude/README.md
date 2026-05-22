# Nyrima Project Memory

This directory holds durable project guidance for future Nyrima work. Read it
with the deploy documentation in [`../docs/index.md`](../docs/index.md), not
as a replacement for code, tests, or current repository status.

## Read First

1. Read [`../README.md`](../README.md) for the product entry point.
2. Read [`../docs/how-nyrima-works.md`](../docs/how-nyrima-works.md) when the
   user-facing flow matters.
3. Read [`../docs/architecture.md`](../docs/architecture.md) before changing
   extension boundaries, Drive auth, storage, player pipelines, or sharing.
4. Read the guidance file in this directory that matches the task.
5. Check [`../PHASES.md`](../PHASES.md) for shipped/deferred status before
   describing roadmap state.

## Guidance Files

| File | Use it for |
| --- | --- |
| [`workflow.md`](./workflow.md) | Work lifecycle, docs/status updates, verification, release habits, and scratch-note cleanup. |
| [`artifacts.md`](./artifacts.md) | Where durable docs, specs, release packages, and external promo-site material belong. |
| [`system-design.md`](./system-design.md) | Current architectural constraints and trust boundaries. |
| [`patterns.md`](./patterns.md) | Reusable code, testing, security, Drive, sharing, and docs patterns. |
| [`styling.md`](./styling.md) | Nyrima visual-system and surface-level styling guidance. |
| [`once-ui-guidance.md`](./once-ui-guidance.md) | Detailed Once UI integration guidance for this Vite Chrome extension. |

## Canonical Sources

| Question | Canonical source |
| --- | --- |
| What the current product does | `README.md`, `docs/how-nyrima-works.md` |
| Detailed architecture | `docs/architecture.md` |
| OAuth and tester setup | `docs/oauth-setup.md` |
| Permissions and data handling | `docs/permissions-and-data-use.md`, `docs/privacy-policy.md` |
| User setup and troubleshooting | `docs/getting-started.md`, `docs/troubleshooting.md` |
| Engineering status | `PHASES.md` |
| Approved design/execution history | `docs/superpowers/specs/`, `docs/superpowers/plans/` |

## Local Settings Are Separate

`.claude/settings.local.json` is local tool permission/configuration state. Do
not use it as project memory and do not bury durable architecture, workflow, or
style rules in it.

## Memory Rule

Prefer one of these durable homes over root scratch notes:

- A regression test for behavior that must not regress.
- A focused code comment where an implementation gotcha lives.
- A deploy or architecture doc when users/reviewers need the claim.
- A `.claude` pattern or system-design note for future work habits.
- A Superpowers spec/plan when the artifact records an approved work pass.


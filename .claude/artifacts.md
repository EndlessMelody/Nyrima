# Nyrima Artifact Guide

This file says what artifacts belong in this repository and what belongs on
the separate public promo website.

## Repository Artifact Map

| Artifact | Home | Lifecycle |
| --- | --- | --- |
| Product entry point | `README.md` | Current and user-first |
| User/deploy docs | `docs/*.md` | Current deploy documentation |
| Status tracker | `PHASES.md` | Updated with shipped/deferred work |
| Approved designs | `docs/superpowers/specs/` | Historical design record |
| Implementation plans | `docs/superpowers/plans/` | Historical execution record |
| Project memory | `.claude/*.md` | Durable contributor/agent guidance |
| Source code | `src/`, `scripts/`, config files | Hand-edited source |
| Build output | `dist/` | Generated extension output |
| Release package | `dist-zip/` | Generated package/archive output |

## Durable Versus Temporary

### Durable

- Architecture constraints.
- OAuth/tester and permission/data use instructions.
- User setup/troubleshooting.
- Reusable style/system patterns.
- Approved spec/plan records.
- Tests that pin fragile media, Drive, sharing, or parsing behavior.

### Temporary

- Ad hoc terminal output dumps.
- "Where we are" scratch notes in the repository root.
- One-off release staging notes once their content lives in docs/tests/plans.
- Generated build output and package files.

Do not keep temporary artifacts just because they were useful during one debug
session.

## Deploy Documentation Boundaries

Use the documentation map in [`../docs/index.md`](../docs/index.md).

- `docs/how-nyrima-works.md` is plain-language product behavior.
- `docs/architecture.md` is technical behavior.
- `docs/oauth-setup.md` is development/tester OAuth configuration.
- `docs/permissions-and-data-use.md`, `docs/privacy-policy.md`, and
  `docs/terms-of-use.md` carry public trust claims.

If code changes a public claim, update the relevant doc in the same work pass.

## External Promo Website Contract

The Nyrima promo site is separate from the Chrome extension runtime and this
repository's internal project memory. Treat it as the public distribution and
information surface.

It should provide or link to:

1. The Nyrima package upload/download or release acquisition path.
2. Clear install guidance for the package users receive.
3. Public product explanation and Q&A/FAQ.
4. Public privacy policy and terms pages that match the shipped extension.
5. Support/contact and issue-report direction.
6. Reviewer/store-facing links when a store or OAuth review needs public URLs.

## Promo-Site Drift Checks

Before uploading a package or publishing public copy:

- Match feature claims to the current extension release.
- Match OAuth/data-use claims to repository policy docs.
- Match install steps to the delivered package shape.
- Keep future roadmap ideas out of public "current behavior" claims unless
  they are clearly labeled as future.
- Link the public FAQ and policy pages from the package/public release surface.

## Package Flow

Repository work produces the source and built extension package. The promo
website is where public distribution information lives.

Typical path:

1. Build and verify extension in this repository.
2. Produce the package/archive artifact.
3. Upload or link the package through the promo site/release surface.
4. Keep public Q&A, install, privacy, terms, and support pages aligned with the
   package being served.


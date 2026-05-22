# Nyrima Deployment Documentation Design

**Date:** 2026-05-22

## Goal

Replace Nyrima's stale planning and smoke-test documentation with a
deployment-ready documentation set that explains the extension exactly as it
works today. The docs must help users set up and use the app, help developers
understand the current system, and give privacy/OAuth reviewers a precise
account of permissions and data handling without promising future features.

## Scope

This pass documents the current Chrome extension only:

- Drive-backed library browsing and playback.
- API key and BYOK OAuth access paths.
- Local playback, poster, subtitle, and settings behavior.
- The Drive-only sharing, following, comment, and import flows.
- Current permissions, storage, remote endpoints, privacy policy, and terms.

This pass does not document Phase 5 realtime watch parties, encrypted
libraries, offline cache plans, or any other unshipped capability.

## Documentation Shape

The repository will keep a small documentation map and split the material by
reader intent.

| Document | Reader job |
| --- | --- |
| `README.md` | Understand what Nyrima is, what works today, how to build/load it, and where deeper docs live. |
| `docs/index.md` | Navigate the full deployment documentation set. |
| `docs/how-nyrima-works.md` | Explain the product and data flow in plain language for users and reviewers. |
| `docs/getting-started.md` | Install the unpacked extension, prepare a Drive root, configure access, and play the first video. |
| `docs/library-guide.md` | Organize videos, posters, backdrops, subtitles, seasons, playback state, and supported player behavior. |
| `docs/sharing-guide.md` | Explain Drive-only shares, follows, comments, imports, privacy choices, and permissions. |
| `docs/troubleshooting.md` | Diagnose setup, OAuth, Drive access, Chrome extension, Linux/Chromium, playback, and sharing failures. |
| `docs/architecture.md` | Give developers the current extension architecture, trust boundaries, storage schema, and data flows. |
| `docs/oauth-setup.md` | Configure Google Cloud OAuth for development/testing and understand production review constraints. |
| `docs/permissions-and-data-use.md` | Map every manifest permission, host permission, scope, endpoint, storage surface, and user control to its purpose. |
| `docs/privacy-policy.md` | Publish an accurate privacy policy for the current extension and Google API Limited Use posture. |
| `docs/terms-of-use.md` | State user responsibilities, service limits, sharing expectations, warranty limits, and the publisher contact fields needed before publication. |

`PHASES.md` remains the engineering status record. The old conceptual
`docs/plan.md` and manual `docs/sharing-smoke-test.md` are removed because
they are not deployment-facing docs and their useful sharing explanation will
be folded into the new guides.

## Product Explanation

The docs will explain Nyrima at two levels:

1. `README.md` will give a compact first-read description: Nyrima is a Chrome
   extension that turns a Google Drive folder the user can access into a
   private video library and player. Nyrima is not a hosted streaming service
   and does not upload the user's media to a Nyrima backend.
2. `docs/how-nyrima-works.md` will describe the full current flow in plain
   language: Drive folder pairing, poster/subtitle discovery, streaming and
   remux behavior, local playback state, OAuth/API-key choices, optional
   sharing metadata, follower sync, comments, and Drive-to-Drive imports.

## Architecture Coverage

`docs/architecture.md` will stay technical and current. It will cover:

- Extension contexts: manifest, app page, background service worker, content
  script on Drive, popup, and Google-hosted endpoints.
- Authentication: public API-key requests, BYOK OAuth via
  `chrome.identity.launchWebAuthFlow`, service-worker token caching, the
  declarativeNetRequest media header rule, and the 24-hour re-consent window.
- Playback: Drive metadata/listing requests, direct media URLs, Range fetches,
  native playback, MKV MSE remux fallback, AC-3 path, subtitles, and JASSUB.
- Data placement: `chrome.storage.local`, token session storage, IndexedDB
  Drive caches, Drive-created `Shared/` and `Imports/` data, and the optional
  GitHub raw directory cache.
- Trust boundaries: Drive pages, extension pages, Google APIs, public share
  manifests, follower data, and no Nyrima backend.
- Current limits: Drive permission enforcement, local cache behavior,
  decentralized sharing write races, browser/platform assumptions, and
  unsupported containers/codecs where the player cannot recover.

## OAuth Coverage

`docs/oauth-setup.md` will replace the removed manifest `oauth2` instructions.
It will document the current BYOK development flow:

1. Build and load `dist/` as an unpacked Chrome extension.
2. Copy the real development extension ID.
3. Create a Google Cloud development project and enable Google Drive API.
4. Configure the Google Auth Platform consent screen for testing.
5. Add test-user email addresses while the OAuth app is in testing.
6. Create a Chrome Extension OAuth client for the extension ID.
7. Paste the client ID into Nyrima's API/OAuth settings UI.
8. Request the scopes the code uses today:
   `drive.readonly`, `drive.file`, `userinfo.email`, and `userinfo.profile`.

The doc will recommend separate development and production Cloud projects and
will describe common causes for invalid client, denied tester, scope, consent,
and extension-ID failures.

## Privacy And Policy Coverage

The policy docs will avoid broad claims that the code cannot support. They
will say:

- Nyrima currently has no Nyrima backend, ad network, or analytics endpoint.
- Nyrima does not read browser cookies from Google Drive or other websites and
  does not sell user data.
- Google Drive data is used only for extension features the user requests:
  browse, stream, poster/subtitle retrieval, profile-backed sharing, Drive
  writes for app-created share/import data, and permission changes the user
  chooses for the `Shared/` folder.
- Persistent extension state remains local unless a user writes share/comment
  metadata or imports content into their own Drive.
- Publishing `Shared/` exposes share metadata and comment stream files in that
  folder to anyone with its link, but it does not automatically make target
  videos or libraries public.
- The privacy policy will include the Google API Services User Data Policy
  Limited Use statement and a clear place to insert the publisher contact and
  effective date before external publication.

`docs/permissions-and-data-use.md` will make these claims auditable by mapping
them to manifest permissions, host permissions, OAuth scopes, remote
endpoints, and user controls.

## User Guidance Coverage

The user docs will describe:

- Folder setup and the root-folder model.
- Poster and backdrop file naming.
- Subtitle sibling matching and embedded subtitle behavior.
- Supported and unsupported playback paths at a practical level.
- API key versus OAuth setup decisions.
- Sharing semantics and how imports respect Drive permissions.
- How to sign out, remove stored keys, reset paired account data, unshare, and
  make a `Shared/` folder private.
- Troubleshooting steps that ask for precise Chrome extension errors and cover
  Linux/Chromium checks without assuming an unobserved failure cause.

## Validation

The docs pass will be checked by:

- Searching for links to deleted docs.
- Searching for stale `chrome.identity.getAuthToken`, manifest `oauth2`,
  Jikan/metadata claims, and stale test-count text in deployment docs.
- Checking Markdown links and file references manually with repository
  searches.
- Running `git diff --check` to catch whitespace mistakes.
- Reviewing privacy/OAuth factual claims against current code and official
  Chrome/Google guidance before reporting completion.

# Nyrima Documentation

This documentation set describes the deployable Chrome extension as it works
today. Future roadmap status belongs in [`../PHASES.md`](../PHASES.md), not in
user or policy docs.

## Start Here

| Need | Document |
| --- | --- |
| Understand what Nyrima does | [`how-nyrima-works.md`](./how-nyrima-works.md) |
| Install and play a first Drive video | [`getting-started.md`](./getting-started.md) |
| Organize libraries, posters, subtitles, and playback | [`library-guide.md`](./library-guide.md) |
| Use Drive-only sharing and imports safely | [`sharing-guide.md`](./sharing-guide.md) |
| Diagnose errors | [`troubleshooting.md`](./troubleshooting.md) |

## Developer And Reviewer Docs

| Need | Document |
| --- | --- |
| Detailed current system architecture | [`architecture.md`](./architecture.md) |
| Google Cloud OAuth setup for development and testers | [`oauth-setup.md`](./oauth-setup.md) |
| Set up the Supabase social database and deploy to Vercel | [`deployment.md`](./deployment.md) |
| Manifest permissions, OAuth scopes, endpoints, and data placement | [`permissions-and-data-use.md`](./permissions-and-data-use.md) |
| Privacy policy | [`privacy-policy.md`](./privacy-policy.md) |
| Terms of use | [`terms-of-use.md`](./terms-of-use.md) |
| Engineering phase status | [`../PHASES.md`](../PHASES.md) |

## Fast Facts

- Nyrima is a Chrome Manifest V3 extension for Google Drive video libraries.
- The current app has no Nyrima backend that receives user media or Drive
  library data.
- Access is configured with a user-provided Google Drive API key for public
  files, a user-provided Google OAuth client ID for signed-in Drive access, or
  both.
- Library artwork is user-owned Drive artwork such as `Poster.jpg`; it is not
  fetched from an external poster metadata provider.
- Sharing is optional and Drive-native. A user chooses whether to publish the
  app-created `Shared/` folder that contains share metadata.
- The separate Nyrima promo website is the public package/info surface for
  package distribution, FAQ/Q&A, install help, privacy, terms, and support
  links. It is not the extension runtime.

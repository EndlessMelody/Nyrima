# OAuth Setup For Development And Testers

> **Web app (current).** Nyrima now runs as a Vite web app. Drive OAuth uses a
> **Web application** Google client and a full-page redirect to
> `/auth/google/callback` — no `chrome.identity`, no `*.chromiumapp.org`. The
> token flow is frontend-only (implicit token grant), so **no client secret is
> ever shipped to the browser**. The legacy Chrome-extension flow below is
> retained for reference only.

OAuth is Drive-access-only: it grants read access so a user — **signed in OR in
"Try Nyrima" guest mode** — can browse and watch their own files. It does not
create a Nyrima account and is separate from the Supabase account/social layer.

## Web App OAuth Flow (current)

1. Configure `VITE_GOOGLE_CLIENT_ID` (a Google **Web** OAuth client id) and
   optionally `VITE_GOOGLE_OAUTH_REDIRECT_URI` (see `.env.example`). Users may
   still paste their own client id (BYOK) in Settings → Connect Drive.
2. "Connect Google Drive" calls `startDriveConnect()`, which navigates the
   browser to Google via `getGoogleOAuthUrl()` (`src/config/googleOAuth.ts`).
   The `state` param carries a CSRF nonce + the guest/authenticated mode + the
   return path.
3. Google returns to `/auth/google/callback` with the access token in the URL
   fragment. `AuthGoogleCallbackPage` validates `state`, stores the token, and
   returns the user to the app (default `/app`).
4. The token is cached in session storage (partitioned per account/guest) and
   used for Drive API/media requests for the 72-hour interactive window.
5. After expiry, the user reconnects with the same redirect flow.

### Google Cloud Console settings (web app)

Create an OAuth client of type **Web application** and set:

**Authorized JavaScript origins**

- `http://localhost:5173`
- `http://127.0.0.1:5173` (if you use that host)

**Authorized redirect URIs**

- `http://localhost:5173/auth/google/callback`
- `http://127.0.0.1:5173/auth/google/callback` (if needed)
- `https://<production-domain>/auth/google/callback` (production)

The `redirect_uri` the app sends must EXACTLY match one of these, or Google
returns `redirect_uri_mismatch`.

### Web app scopes (least-privilege)

| Scope | Purpose |
| --- | --- |
| `https://www.googleapis.com/auth/drive.readonly` | List + stream the user's Drive files, and read the profile name/avatar via the Drive About API. |

`drive.file`, `userinfo.email`, and `userinfo.profile` are intentionally NOT
requested by the web build — `drive.readonly` covers browsing, watching, and
the connected-account display. Override with `VITE_GOOGLE_DRIVE_SCOPE` only if a
feature genuinely needs more.

---

## Legacy: Chrome-Extension OAuth Flow (reference only)

The retired extension build used bring-your-own-client-ID with a **Chrome
Extension** OAuth client and `chrome.identity.launchWebAuthFlow`:

1. The user pastes a Google OAuth client ID into Nyrima API/OAuth settings.
2. The background service worker builds a Google OAuth URL with the current
   client ID and scopes.
3. The service worker starts consent with
   `chrome.identity.launchWebAuthFlow`.
4. The returned short-lived access token is cached in the extension service
   worker/session storage and used for Drive API/media requests.
5. After the current 72-hour interactive-consent window expires, Nyrima asks
   the user to consent again.

The extension build additionally requested `drive.file`,
`userinfo.email`, and `userinfo.profile` for sharing surfaces. The steps below
describe that legacy extension setup.

## Recommended Project Layout

Use separate Google Cloud projects for development/testing and production
publishing. The unpacked extension ID and release extension ID can differ, and
separating projects reduces the chance of mixing tester credentials, release
verification work, and local experiments.

## Development Setup

### 1. Build And Load The Extension

From the repository root:

```bash
npm install
npm run build
```

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select `dist/`.
5. Copy the extension ID shown for the loaded Nyrima extension.

That exact ID is what the Google OAuth Chrome Extension client must use.

### 2. Create A Google Cloud Project

Create or select a Google Cloud project for this development extension. Use a
clear name such as `nyrima-dev`.

### 3. Enable Google Drive API

In Google Cloud:

1. Open the API library.
2. Find **Google Drive API**.
3. Enable it for the selected project.

### 4. Configure Google Auth Platform / Consent

Configure the OAuth branding, audience, contact details, and scopes for the
project.

For an external app in testing:

1. Keep the project in the testing state while validating the extension.
2. Add every Google account that should test OAuth as a test user.
3. Add or review the current scope set listed above.

If a tester is not added while the app is limited to test users, consent can
fail even when the OAuth client ID is otherwise correct.

### 5. Create The OAuth Client

Create a credential with:

- Application type: **Chrome Extension**.
- Extension/Application ID: the ID copied from `chrome://extensions` for the
  loaded `dist/` extension.

Copy the generated client ID. It usually ends in
`.apps.googleusercontent.com`.

### 6. Paste The Client ID Into Nyrima

Open Nyrima and find the setup/API settings surface:

1. Paste the OAuth client ID into **OAuth Client ID**.
2. Save the configuration.
3. Click the Connect Drive/sign-in action.
4. Complete Google consent with a configured tester account.

The client ID is stored locally by the extension. It is not committed to the
repository by this flow.

## Adding Testers

While the OAuth app is in testing, add testers in the Google Auth Platform
audience/test-user settings for the same Cloud project that owns the OAuth
client.

Checklist:

- Add the exact email address the tester will use in Chrome consent.
- Confirm the tester is using the extension build/client ID for that project.
- Confirm Google Drive API is enabled in that project.
- Ask the tester to paste their own client ID only if that is the test model
  you intend; otherwise provide the approved tester client ID for the test
  project through a safe channel.

## API Key Versus OAuth

OAuth is separate from the optional Google Drive API key.

| Access | API key | OAuth |
| --- | --- | --- |
| Public Drive file read | Can work when Drive allows it | Can work when the signed-in user can read it |
| Private Drive folder | No | Yes |
| App-created share/import writes | No | Yes |
| Profile-backed share identity | No | Yes |

### Restrict the API key to your origins

Unlike the OAuth client id, the optional Drive API key is a bearer credential:
it's shipped to the browser and visible on every request the app makes
(`...?key=...`). Anyone who copies it can call the Drive API from their own
site unless it's restricted. In Google Cloud Console → **Credentials** → the
API key → **Application restrictions**:

- Choose **Websites** (HTTP referrers) and add the exact origins the app is
  served from, e.g.:
  - `http://localhost:5173/*` (dev)
  - `https://<production-domain>/*`
- Under **API restrictions**, limit the key to **Google Drive API** only.

A key restricted this way still works for "Anyone with the link" Drive
folders from the app's own origins, but is useless if leaked or scraped from
the bundle.

## Common Problems

### Invalid client ID or redirect failure

- Confirm the OAuth credential type is Chrome Extension.
- Confirm the configured extension ID matches `chrome://extensions`.
- Confirm the client ID was pasted into Nyrima UI.
- If you loaded a different unpacked directory or Chrome profile, compare the
  extension ID again.

### `access_denied`, blocked consent, or tester rejection

- Confirm the consent project audience/testing settings.
- Add the Google account as a test user when the app is still in testing.
- Confirm the tester uses the same Cloud project/client combination you
  configured.

### Missing scope or 403 on sharing/import

- Confirm the current OAuth setup includes `drive.file` as well as read and
  user-info scopes.
- Disconnect/reconnect if the browser token was granted before a scope set
  changed.
- Check Drive target permission and source copy restrictions separately from
  OAuth consent.

### API key works but OAuth does not

They are separate credentials. A working API key proves only that a public
Drive API request can be made with that key; it does not prove the OAuth Chrome
Extension client ID and tester consent setup are correct.

## Production Notes

Before public distribution:

- Use the release Chrome extension ID and production Google Cloud project.
- Publish a reachable privacy policy that accurately describes Google API data
  use and sharing behavior.
- Review Chrome Web Store privacy disclosures and Google OAuth verification
  requirements for the requested Drive scope set.
- Prepare justification for Drive scope usage and current no-backend data flow.

The current policy and permission explanations in this repository are:

- [`privacy-policy.md`](./privacy-policy.md)
- [`permissions-and-data-use.md`](./permissions-and-data-use.md)
- [`architecture.md`](./architecture.md)

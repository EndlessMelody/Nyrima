# OAuth Setup For Development And Testers

Nyrima's current OAuth flow is bring-your-own-client-ID. The app does not ship
a shared Google OAuth client ID in a manifest `oauth2` block. A developer or
tester creates a Google Cloud OAuth client for the Chrome extension ID they are
loading and pastes that client ID into the Nyrima UI.

OAuth is required for current signed-in Drive behavior such as private Drive
folders, profile-backed sharing, app-created share/import writes, and
publishing the app-created `Shared/` folder.

## Current OAuth Flow

1. The user pastes a Google OAuth client ID into Nyrima API/OAuth settings.
2. The background service worker builds a Google OAuth URL with the current
   client ID and scopes.
3. The service worker starts consent with
   `chrome.identity.launchWebAuthFlow`.
4. The returned short-lived access token is cached in the extension service
   worker/session storage and used for Drive API/media requests.
5. After the current 24-hour interactive-consent window expires, Nyrima asks
   the user to consent again.

Do not paste a client ID into `src/manifest.config.ts`. That is old behavior
and does not match the current build.

## Scope Set Used Today

The service worker requests:

| Scope | Current purpose |
| --- | --- |
| `https://www.googleapis.com/auth/drive.readonly` | List and stream Drive folders/files the signed-in user can read. |
| `https://www.googleapis.com/auth/drive.file` | Create/update app-created `Shared/` and `Imports/` data and app-created share folder permission changes. |
| `https://www.googleapis.com/auth/userinfo.email` | Profile identity data used by sharing surfaces. |
| `https://www.googleapis.com/auth/userinfo.profile` | Profile name/avatar data used by sharing surfaces. |

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

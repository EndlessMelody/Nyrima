# OAuth setup (one-time)

Nyrima authenticates via Google's OAuth using the user's Chrome profile
through `chrome.identity.getAuthToken`. There is no backend. You need to
provision a **Chrome Extension OAuth client** in Google Cloud and paste its
ID into `src/manifest.config.ts`.

## 1. Create a Google Cloud project

1. Visit <https://console.cloud.google.com/projectcreate>.
2. Name it e.g. `drive-cinema-dev`. Click **Create**.

## 2. Enable the Drive API

1. **APIs & Services → Library**.
2. Search **Google Drive API**. Click **Enable**.

## 3. Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. User type: **External** (or Internal if you're in a Workspace).
3. App name: `Nyrima`. Support email: yours.
4. Scopes — add manually:
   - `.../auth/drive.readonly`
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
5. Test users: add your Gmail (and any tester emails).
6. Save.

## 4. Create the OAuth client

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Chrome Extension**.
3. Item ID: paste your extension's id from `chrome://extensions` (after
   running `npm run build` + Load unpacked once).
4. Save. Copy the generated **Client ID** (looks like
   `1234567890-xxxxxxxx.apps.googleusercontent.com`).

## 5. Paste it into the manifest

`src/manifest.config.ts`:

```ts
oauth2: {
  client_id: "1234567890-xxxxxxxx.apps.googleusercontent.com",
  scopes: [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
  ],
},
```

Rebuild (`npm run build`) and reload the extension. Click the icon → an OAuth
prompt should appear the first time, then never again until token expiry
(handled silently by `chrome.identity`).

## Stuck? Common pitfalls

- **`bad client id`** → The extension id you pasted into the OAuth client
  doesn't match the loaded extension. Each `Load unpacked` of a different
  folder yields a different id; copy the actual id from `chrome://extensions`.
- **`access_denied`** → You forgot to add yourself as a test user, _or_ the
  scope you're requesting isn't on the consent screen.
- **`invalid_scope`** → A scope is misspelled. Compare to
  <https://developers.google.com/identity/protocols/oauth2/scopes#drive>.

## Production publishing

Before the Chrome Web Store can publish the extension publicly:

1. Submit the OAuth consent screen for verification (Google reviews scopes).
2. `drive.readonly` is **restricted**; expect to provide a privacy policy URL
   and possibly a CASA security assessment.
3. Consider migrating to `drive.file` to skip restricted-scope review.

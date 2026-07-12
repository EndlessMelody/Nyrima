# Migration TODO — `chrome.storage` → account-aware Repository

Status after the web-app migration: every `chrome.storage.*` call still works,
served by the **account-namespaced** web shim (`src/platform/storage-adapter.ts`).
Nothing is broken. This document tracks moving that data onto the typed
`Repository` boundary (`src/server/db/`) so it can later be backed by a real DB
without touching call sites.

## Classification of remaining `chrome.*` (in `src/`, excluding `legacy/`)

| Bucket | Where | Action |
| --- | --- | --- |
| **1. Safely shimmed (no action)** | `chrome.runtime.sendMessage` in `services/auth.ts` (AUTH_GET_TOKEN/REVOKE → `platform/runtime-messages.ts` → `drive-auth-web.ts`) | Keep. This is the Drive-auth boundary, not account data. |
| **2. Web asset helper** | ~~`components/NyrimaMark.tsx` `chrome.runtime.getURL`~~ | ✅ Done — now uses `platform/asset-url.ts`. |
| **3. Migrate to Repository** | All `chrome.storage.local/.session/.onChanged` in stores/services (below) | Move behind `getRepository()`. |
| **4. Legacy-only (not built)** | `legacy/extension/**` (`chrome.identity/tabs/contextMenus/alarms/declarativeNetRequest`) | Ignore. Excluded from build/tsconfig. |
| *False positives* | `landing/.../TermsPage.tsx`, `landing/.../PrivacySection.tsx` | `<code>chrome.storage.local</code>` is **prose** in the privacy text — not code. (Content is now slightly inaccurate for the web app; update copy later.) |

## Bucket 3 — modules to migrate, in recommended order

Order is chosen to (a) unblock per-account correctness first, (b) move
leaf/low-risk modules before widely-imported ones.

### Phase 1 — account-correctness (highest value)
1. **`stores/settings-store.ts`** + `services/storage.ts` `getSettings/saveSettings`
   → `Repository.settings`. *Why first:* `AppProviders` loads settings on boot
   under the `guest` partition before auth resolves; theme/volume don't re-load
   when the active account changes. Migrating + reloading on account change
   fixes a real per-account bug. (Track: re-fetch settings in `AuthProvider`
   after `setActiveAccount`.)
2. **`services/user-profile.ts`** → fold the Drive identity into
   `Repository.drive` (`DriveConnection.driveEmail/avatar`).
3. **`services/api-key.ts`, `services/oauth-key.ts`** → `DriveConnection`
   (`oauthClientId`, key). Keep secrets out of any synced store.
4. **`stores/nyrima-root-store.ts`** → `DriveConnection.rootFolderId/Name`.

### Phase 2 — library/playback domain
5. **`services/storage.ts`** playback map + `hooks/usePlaybackPositions.ts`
   → `Repository.watchHistory`.
6. **`stores/recent-store.ts`** + `services/library-shelves.ts` → `Repository.libraries`.
7. **`services/playback-strategy.ts`** (per-file engine cache) →
   `Repository.cache` (source `drive-file`).
8. **`services/storage.ts`** `LibraryViewState` → `Repository` (or keep as
   ephemeral per-device UI state — decide).

### Phase 3 — caches + social
9. **`services/drive/dev-mode.ts`** + `services/drive/idb.ts` byte caches →
   keep IDB for bytes; register **metadata** via `server/db/cache.ts`
   (`CacheRecord`).
10. **`services/mal-poster-migration.ts`**, **`services/account-reset.ts`** →
    rework against the Repository (account-reset becomes
    `Repository.users.deleteAll(userId)`).
11. **`stores/social-store.ts`, `stores/sharing-store.ts`, `services/sharing/*`,
    `components/SharingHost.tsx`, `components/social/*`** → `Repository.social`
    (Friendship/Follow/SharedLibrary/SharedPlaylist/Invitation/AccessPermission).
    Largest surface; do last.

### UI touch points (read through the stores above; migrate with their store)
`components/UserCenter.tsx`, `components/SetupAccessDialog.tsx`,
`components/ConnectDriveScreen.tsx`, `pages/LobbyPage.tsx`,
`pages/SettingsPage.tsx` — none call `chrome.storage` for new logic except via
the services above (plus `UserCenter`'s `clear history/cache` which should call
`Repository.watchHistory.clear` / `Repository.cache.clear`).

## Mechanics

- Add a small `useCurrentUserId()` hook (from `AuthProvider`) so call sites pass
  `userId` to the repository.
- Migrate one module at a time: swap the `chrome.storage` read/write for the
  matching `Repository` method; keep the public function signature so callers
  don't change.
- Provide a **one-time importer** that copies any existing
  `chrome.storage`-shim values (current `guest` partition) into the signed-in
  account's repository on first login, so dev data isn't lost.
- Do NOT remove the `chrome.storage` shim until every Bucket-3 module is
  migrated — it's the safety net.

## Known related issue (track here)
- **Settings load under `guest` before auth resolves** (see Phase 1, item 1).
  Low impact today (theme flashes device default); resolved by the settings
  migration + account-change reload.

/**
 * resolveLandingPage — where the app lands after sign-in / guest entry.
 * Reads the persisted `defaultLandingPage` setting so a fresh session opens
 * wherever the user configured in Appearance instead of always the lobby.
 */

import { useSettingsStore } from "../stores/settings-store";

export function resolveLandingPage(): string {
  return useSettingsStore.getState().settings.defaultLandingPage;
}

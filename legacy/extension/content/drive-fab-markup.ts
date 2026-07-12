export const DRIVE_FAB_LABEL = "Open with Nyrima";

export function buildDriveFabMarkup(iconUrl: string): string {
  return `
    <span class="dc-fab__mark" aria-hidden="true">
      <img class="dc-fab__logo" src="${iconUrl}" alt="" draggable="false" />
    </span>
    <span class="dc-fab__label">${DRIVE_FAB_LABEL}</span>
  `;
}

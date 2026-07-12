import { describe, expect, it } from "vitest";
import { buildDriveFabMarkup, DRIVE_FAB_LABEL } from "./drive-fab-markup";

describe("buildDriveFabMarkup", () => {
  it("renders the Nyrima logo bubble with the hover label content", () => {
    const markup = buildDriveFabMarkup(
      "chrome-extension://nyrima/icons/extension-icon-128.png",
    );

    expect(DRIVE_FAB_LABEL).toBe("Open with Nyrima");
    expect(markup).toContain('class="dc-fab__logo"');
    expect(markup).toContain(
      'src="chrome-extension://nyrima/icons/extension-icon-128.png"',
    );
    expect(markup).toContain(`>${DRIVE_FAB_LABEL}</span>`);
  });
});

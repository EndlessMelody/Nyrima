import { describe, expect, it } from "vitest";
import {
  featureChips,
  guestCta,
  loginLegalLinks,
  loginPosterUrl,
  mascotHelper,
  mascotMoods,
  mascotSpeaker,
  signInCopy,
  signUpCopy,
} from "./login-page-content";

describe("login page presentation content", () => {
  it("uses the provided public poster as the scene background", () => {
    expect(loginPosterUrl).toBe("/poster.png");
  });

  it("names Ny-chan as the guide and offers a resting helper line", () => {
    expect(mascotSpeaker).toBe("Ny-chan");
    expect(mascotHelper).toBe("Sign in when you're ready.");
  });

  it("greets returning visitors with the primary welcome line", () => {
    expect(mascotMoods.default.lines).toEqual([
      "Welcome back.",
      "Your next episode is still waiting.",
    ]);
  });

  it("reacts to every form state with a real expression and readable copy", () => {
    for (const mood of Object.values(mascotMoods)) {
      expect(mood.emotion).toBeTruthy();
      expect(mood.lines.length).toBeGreaterThan(0);
      expect(mood.lines.every((line) => line.trim().length > 0)).toBe(true);
    }
    // The form-state reactions map to distinct expressions.
    expect(mascotMoods.email.emotion).toBe("pointing");
    expect(mascotMoods.password.emotion).toBe("shy");
    expect(mascotMoods.error.emotion).toBe("confused");
    expect(mascotMoods.success.lines).toEqual(["Welcome home."]);
  });

  it("offers a small set of quiet supporting badges, not feature cards", () => {
    expect(featureChips.map((chip) => chip.label)).toEqual([
      "Personal Libraries",
      "Watch History",
      "Subtitles",
      "Multi-audio",
    ]);
    expect(featureChips.length).toBeLessThanOrEqual(5);
  });

  it("keeps sign-in and create-account form copy separate", () => {
    expect(signInCopy.submitLabel).toBe("Sign in");
    expect(signUpCopy.submitLabel).toBe("Create account");
    expect(signInCopy.panelHeading).toBe("Welcome back.");
    expect(signUpCopy.panelHeading).toBe("Create your cinema.");
  });

  it("offers a welcoming 'Try Nyrima' guest path, not a debug toggle", () => {
    expect(guestCta.title).toBe("Try Nyrima");
    expect(guestCta.button).toBe("Try Nyrima");
    // Makes the no-account promise + the Drive-permission caveat explicit.
    expect(guestCta.description).toMatch(/without creating a Nyrima account/i);
    expect(guestCta.note).toMatch(/permission/i);
    // No "dev"/"localhost"/"debug" language anywhere in the guest copy.
    const blob = Object.values(guestCta).join(" ").toLowerCase();
    expect(blob).not.toMatch(/dev|localhost|debug/);
  });

  it("links legal text to the public terms and privacy routes", () => {
    expect(loginLegalLinks).toEqual([
      { label: "Terms", href: "/terms" },
      { label: "Privacy Policy", href: "/privacy" },
    ]);
  });
});

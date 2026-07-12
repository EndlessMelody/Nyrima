import { describe, expect, it } from "vitest";
import {
  DEFAULT_EQ_VALUES,
  formatPlaybackClock,
  getEqPresetValues,
  shouldDeferPlaybackRequest,
  shouldStartPlaybackImmediately,
  volumePercentToElementVolume,
  resolveMusicPlayerBackTarget,
} from "./music-player";

describe("music player helpers", () => {
  it("prefers explicit source route state for the page Back button", () => {
    expect(
      resolveMusicPlayerBackTarget({
        sourceRoute: "/library/favorites",
        from: "/library/music",
      }),
    ).toBe("/library/favorites");
  });

  it("falls back through known state keys before the music library default", () => {
    expect(resolveMusicPlayerBackTarget({ from: "/library/albums" })).toBe(
      "/library/albums",
    );
    expect(
      resolveMusicPlayerBackTarget({ previousSection: "/library/artists" }),
    ).toBe("/library/artists");
    expect(resolveMusicPlayerBackTarget(undefined)).toBe("/library/music");
  });

  it("rejects unsafe or player-self back targets", () => {
    expect(resolveMusicPlayerBackTarget({ sourceRoute: "https://nyrima.invalid" })).toBe(
      "/library/music",
    );
    expect(resolveMusicPlayerBackTarget({ sourceRoute: "/music/player/track-1" })).toBe(
      "/library/music",
    );
  });

  it("returns isolated EQ preset values and preserves the flat reset", () => {
    const anime = getEqPresetValues("Anime OST");
    expect(anime).toEqual([2, 3, 4, 3, 1, 2, 4, 5, 4, 3]);

    anime[0] = 99;
    expect(getEqPresetValues("Anime OST")[0]).toBe(2);
    expect(getEqPresetValues("Unknown")).toEqual(DEFAULT_EQ_VALUES);
  });

  it("formats playback clocks without leaking fractional seconds", () => {
    expect(formatPlaybackClock(38.0293)).toBe("0:38");
    expect(formatPlaybackClock(191.454563)).toBe("3:11");
    expect(formatPlaybackClock(3661.9)).toBe("1:01:01");
  });

  it("uses a stable zero clock for invalid playback values", () => {
    expect(formatPlaybackClock(Number.NaN)).toBe("0:00");
    expect(formatPlaybackClock(-12)).toBe("0:00");
    expect(formatPlaybackClock(undefined)).toBe("0:00");
  });

  it("queues play requests while the track is not ready yet", () => {
    expect(shouldDeferPlaybackRequest("idle")).toBe(true);
    expect(shouldDeferPlaybackRequest("loading")).toBe(true);
    expect(shouldDeferPlaybackRequest("ready")).toBe(false);
    expect(shouldDeferPlaybackRequest("error")).toBe(false);
  });

  it("only starts playback immediately after a playable source exists", () => {
    expect(shouldStartPlaybackImmediately("loading", false)).toBe(false);
    expect(shouldStartPlaybackImmediately("ready", false)).toBe(false);
    expect(shouldStartPlaybackImmediately("ready", true)).toBe(true);
    expect(shouldStartPlaybackImmediately("error", true)).toBe(false);
  });

  it("maps volume percent to the media element range", () => {
    expect(volumePercentToElementVolume(68)).toBe(0.68);
    expect(volumePercentToElementVolume(-10)).toBe(0);
    expect(volumePercentToElementVolume(120)).toBe(1);
    expect(volumePercentToElementVolume(Number.NaN)).toBe(0);
  });
});

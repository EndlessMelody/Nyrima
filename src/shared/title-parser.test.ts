/**
 * Tests for the consolidated title parser. Locks in:
 *   - Folder-aware `parseTitle` (show / season / episode / specials)
 *   - Filename-only `normalizeMovieTitle` (year + quality + cleaned title)
 *   - `isEpisodicFilename` / `isSeasonFolderName` predicates
 *
 * These are pure-logic tests — no DOM, no chrome.* surface — so they run
 * under the default Vitest node environment.
 */

import { describe, expect, it } from "vitest";
import {
  parseTitle,
  isSeasonFolderName,
  normalizeMovieTitle,
  isEpisodicFilename,
} from "./title-parser";

describe("parseTitle", () => {
  it("extracts [GS]NN.mkv as an episode in its parent show folder", () => {
    const out = parseTitle({
      filename: "[GS]07.mkv",
      parentFolder: "Gimai Seikatsu",
    });
    expect(out.episodeNumber).toBe("07");
    expect(out.showTitle).toBe("GIMAI SEIKATSU");
    expect(out.fullTitle).toBe("GIMAI SEIKATSU - EP07");
    expect(out.shortLabel).toBe("Episode 7");
  });

  it("preserves the source's leading zero on episode numbers", () => {
    const out = parseTitle({
      filename: "[Erai-raws] Series - 03 [1080p].mkv",
      parentFolder: "Series",
    });
    expect(out.episodeNumber).toBe("03");
    expect(out.fullTitle).toContain("EP03");
  });

  it("treats `Kan` parent as a season subfolder", () => {
    const out = parseTitle({
      filename: "Show - 05.mkv",
      parentFolder: "Kan",
      showFolder: "Yahari Ore",
    });
    expect(out.showTitle).toBe("YAHARI ORE");
    expect(out.seasonLabel).toBe("KAN");
    expect(out.fullTitle).toBe("YAHARI ORE - KAN - EP05");
  });

  it("recognises OVA / MOVIE specials over numeric episodes", () => {
    const out = parseTitle({
      filename: "Series OVA.mkv",
      parentFolder: "Series",
    });
    expect(out.episodeNumber).toBeUndefined();
    expect(out.specialTag).toBe("OVA");
    expect(out.fullTitle).toBe("SERIES - OVA");
  });

  it("drops 4-digit years masquerading as episode numbers", () => {
    const out = parseTitle({
      filename: "Inception 2010.mkv",
      parentFolder: "Movies",
    });
    expect(out.episodeNumber).toBeUndefined();
  });

  it("falls back to the cleaned filename for one-shots with no episode marker", () => {
    const out = parseTitle({
      filename: "Your Name.mkv",
      parentFolder: "Movies",
    });
    expect(out.episodeNumber).toBeUndefined();
    expect(out.fullTitle).toBe("MOVIES - YOUR NAME");
  });

  it("collapses to the filename when no folder context is supplied", () => {
    const out = parseTitle({
      filename: "Tenki no Ko (2019).mkv",
      parentFolder: "",
    });
    expect(out.showTitle).toBe("");
    expect(out.cleanedFileName).toContain("Tenki no Ko");
  });
});

describe("isSeasonFolderName", () => {
  it("matches the common JP season suffixes", () => {
    expect(isSeasonFolderName("Kan")).toBe(true);
    expect(isSeasonFolderName("Zoku")).toBe(true);
    expect(isSeasonFolderName("Ni")).toBe(true);
  });

  it("matches Western season conventions", () => {
    expect(isSeasonFolderName("S2")).toBe(true);
    expect(isSeasonFolderName("Season 3")).toBe(true);
    expect(isSeasonFolderName("2nd Season")).toBe(true);
    expect(isSeasonFolderName("Part 2")).toBe(true);
    expect(isSeasonFolderName("Cour 1")).toBe(true);
  });

  it("rejects regular show folders", () => {
    expect(isSeasonFolderName("Gimai Seikatsu")).toBe(false);
    expect(isSeasonFolderName("My Show")).toBe(false);
    expect(isSeasonFolderName("Movies")).toBe(false);
  });
});

describe("normalizeMovieTitle", () => {
  it("strips release brackets, scene tags, and extension", () => {
    const out = normalizeMovieTitle(
      "[Erai-raws] Tenki no Ko (2019) [1080p][HEVC][AAC].mkv",
    );
    expect(out.title).toBe("Tenki No Ko");
    expect(out.year).toBe(2019);
    expect(out.quality).toBe("1080p");
  });

  it("recognises 4K via 2160p", () => {
    const out = normalizeMovieTitle("Inception 2010 2160p.mkv");
    expect(out.quality).toBe("4K");
  });

  it("returns null year when no plausible year is present", () => {
    const out = normalizeMovieTitle("Random Title.mkv");
    expect(out.year).toBeNull();
    expect(out.title).toBe("Random Title");
  });

  it("title-cases small words after position 0 lowercased", () => {
    const out = normalizeMovieTitle("the lord of the rings.mkv");
    expect(out.title).toBe("The Lord of the Rings");
  });
});

describe("isEpisodicFilename", () => {
  it("flags bare-number filenames as episodic", () => {
    expect(isEpisodicFilename("[GS]01.mkv")).toBe(true);
    expect(isEpisodicFilename("07.mkv")).toBe(true);
    expect(isEpisodicFilename("[Group]12.mkv")).toBe(true);
  });

  it("flags SxxExx and Episode-N filenames", () => {
    expect(isEpisodicFilename("Show.S01E05.mkv")).toBe(true);
    expect(isEpisodicFilename("Show - Episode 12.mkv")).toBe(true);
    expect(isEpisodicFilename("Show Ep07.mkv")).toBe(true);
  });

  it("does NOT flag full movie titles as episodic", () => {
    expect(isEpisodicFilename("Inception 2010.mkv")).toBe(false);
    expect(isEpisodicFilename("Your Name.mkv")).toBe(false);
    expect(isEpisodicFilename("Tenki no Ko (2019).mkv")).toBe(false);
  });
});

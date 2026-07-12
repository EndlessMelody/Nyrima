import { describe, expect, it } from "vitest";
import { parseDisplayLyrics } from "./lrc";

describe("parseDisplayLyrics", () => {
  it("strips lrc and karaoke timing while keeping readable text", () => {
    expect(
      parseDisplayLyrics(
        "[ti:Gleaming Eternity]\n[00:01.20]<00:01.30>Gleaming Eternity\n[00:03.00]Heard there is a theatre reeling",
      ).map((line) => line.text),
    ).toEqual(["Gleaming Eternity", "Heard there is a theatre reeling"]);
  });

  it("keeps plain lyrics as display-only lines", () => {
    expect(parseDisplayLyrics("First line\n\nSecond line")).toEqual([
      { timeSec: 0, text: "First line" },
      { timeSec: 0, text: "Second line" },
    ]);
  });
});

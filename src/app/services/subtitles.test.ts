/**
 * Tests for the subtitle converters.
 *
 * These are the parsers Nyrima leans on most: SRT for the dominant fansub
 * format, VTT as the browser-native fallback, ASS for the JASSUB path's
 * non-libass fallback. We also test `forceCenterDialogueInAss` since it's
 * the rewrite step that keeps positioned signs intact while pinning plain
 * dialogue to bottom-center (see [[feedback-subtitle-alignment]] in the
 * memory bank).
 */

import { describe, expect, it } from "vitest";
import {
  parseSrt,
  parseVtt,
  parseAss,
  forceCenterDialogueInAss,
  detectLang,
  stripAssTags,
} from "./subtitles";

describe("parseSrt", () => {
  it("parses a basic two-cue SRT", () => {
    const src = `1
00:00:01,000 --> 00:00:03,500
Hello there.

2
00:00:05,000 --> 00:00:07,000
General Kenobi.`;
    const cues = parseSrt(src);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ start: 1, end: 3.5, text: "Hello there." });
    expect(cues[1]).toMatchObject({ start: 5, end: 7, text: "General Kenobi." });
  });

  it("strips inline HTML tags from cue text", () => {
    const src = `1
00:00:01,000 --> 00:00:02,000
<i>italic</i> and <b>bold</b>`;
    expect(parseSrt(src)[0].text).toBe("italic and bold");
  });

  it("handles CRLF line endings", () => {
    const src =
      "1\r\n00:00:01,000 --> 00:00:02,000\r\nHello\r\n\r\n" +
      "2\r\n00:00:03,000 --> 00:00:04,000\r\nWorld";
    expect(parseSrt(src)).toHaveLength(2);
  });
});

describe("parseVtt", () => {
  it("parses a WEBVTT block with the header", () => {
    const src = `WEBVTT

00:00:01.000 --> 00:00:03.500
Hello there.

00:00:05.000 --> 00:00:07.000
General Kenobi.`;
    const cues = parseVtt(src);
    expect(cues).toHaveLength(2);
    expect(cues[0].start).toBe(1);
    expect(cues[0].text).toBe("Hello there.");
  });
});

describe("parseAss", () => {
  it("extracts Dialogue rows and drops Comment rows", () => {
    const src = `[Script Info]
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, Alignment
Style: Default,Arial,40,2

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Comment: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,A comment that should NOT appear
Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,Hello there.
Dialogue: 0,0:00:05.00,0:00:07.00,Default,,0,0,0,,General Kenobi.`;
    const cues = parseAss(src);
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe("Hello there.");
    expect(cues[1].text).toBe("General Kenobi.");
  });
});

describe("forceCenterDialogueInAss", () => {
  it("rewrites Default-style Alignment to 2 (bottom-center)", () => {
    const src = `[V4+ Styles]
Format: Name, Fontname, Fontsize, Alignment, MarginL, MarginR, MarginV
Style: Default,Arial,40,5,40,40,40

[Events]
Format: Layer, Start, End, Style, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,Plain dialogue line`;
    const out = forceCenterDialogueInAss(src);
    // Default style's Alignment field (4th column) should now be 2. The
    // rewrite preserves the Name + Fontname + Fontsize columns ahead of it.
    expect(out).toMatch(/Style:\s*Default,\s*Arial,\s*40,\s*2,/);
  });

  it("leaves positioned signs (with \\pos) untouched", () => {
    const src = `[Events]
Format: Layer, Start, End, Style, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Sign,{\\pos(100,80)}A sign`;
    const out = forceCenterDialogueInAss(src);
    expect(out).toContain("{\\pos(100,80)}A sign");
  });
});

describe("stripAssTags", () => {
  it("strips well-formed override blocks", () => {
    expect(stripAssTags("{\\b1}Hello{\\b0} world")).toBe("Hello world");
  });

  it("converts \\N / \\n to newlines and \\h to space", () => {
    expect(stripAssTags("Line one\\NLine two\\hwith hard space")).toBe(
      "Line one\nLine two with hard space",
    );
  });

  it("drops drawing-mode sections so bare path data doesn't leak", () => {
    // Real Tonari-no-Alya OP-title-card cue: a mask + a label split across
    // multiple drawing-mode sections. The CSS overlay must NEVER let any of
    // the `m … l …` path tokens through, otherwise the user sees the path
    // commands rendered as plain text on top of the video.
    const src =
      "{\\an7\\pos(0,0)\\p1}m 936 690 l 997 691 1003 723 940 723{\\p0}" +
      "{\\p1}m -1 704 l 1921 704 1921 1081 -1 1081{\\p0} itsP!";
    expect(stripAssTags(src)).toBe("itsP!");
  });

  it("drops a drawing-mode section that runs to end-of-line (no \\p0 close)", () => {
    // Some scripts leave drawing mode on at end of cue and rely on the
    // implicit reset. The strip should still discard everything after \p1.
    expect(stripAssTags("Hello {\\p1}m 0 0 l 10 10")).toBe("Hello");
  });

  it("keeps karaoke text (timing tags are stripped, words remain)", () => {
    // Karaoke renders via libass; in the CSS fallback we just want the lyric
    // text without the timing values. JASSUB still gets the full \k tags
    // because it reads the raw script, not this stripped output.
    const lyric = "{\\k20}mez{\\k34}ame {\\k28}sou{\\k30}na";
    expect(stripAssTags(lyric)).toBe("mezame souna");
  });
});

describe("parseAss with drawing-mode signs", () => {
  it("skips Dialogue rows that are pure drawing-mode (no text)", () => {
    const src = `[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:02.00,Sign,,0,0,0,,{\\an7\\pos(0,0)\\p1}m 0 0 l 100 100 b 200 200{\\p0}
Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,Hello there.`;
    const cues = parseAss(src);
    // The drawing-only cue trims to empty and is skipped; the dialogue
    // cue survives untouched.
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe("Hello there.");
  });
});

describe("detectLang", () => {
  it("picks up the explicit `.vi.srt` / `.en.srt` form", () => {
    expect(detectLang("Show.S01E07.vi.srt")).toBe("vi");
    expect(detectLang("Show.S01E07.en.srt")).toBe("en");
  });

  it("falls back to 'und' when no language tag is present", () => {
    expect(detectLang("Show.S01E07.srt")).toBe("und");
  });
});

import { describe, expect, it } from "vitest";
import { splitPinnedLibraries } from "./library-shelves";

describe("splitPinnedLibraries", () => {
  it("keeps pinned libraries out of the all-libraries shelf", () => {
    const shelves = splitPinnedLibraries([
      { id: "charlotte", pinned: true },
      { id: "movies" },
      { id: "frieren", pinned: false },
    ]);

    expect(shelves.pinned.map((folder) => folder.id)).toEqual(["charlotte"]);
    expect(shelves.others.map((folder) => folder.id)).toEqual([
      "movies",
      "frieren",
    ]);
  });

  it("leaves the pinned shelf empty until a library is pinned", () => {
    const shelves = splitPinnedLibraries([
      { id: "movies" },
      { id: "frieren", pinned: false },
    ]);

    expect(shelves.pinned).toEqual([]);
    expect(shelves.others.map((folder) => folder.id)).toEqual([
      "movies",
      "frieren",
    ]);
  });
});

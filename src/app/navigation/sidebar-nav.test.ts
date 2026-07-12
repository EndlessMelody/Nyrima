import { describe, expect, it } from "vitest";
import {
  SIDEBAR_NAV_SECTIONS,
  getSidebarNavItems,
  resolveSidebarActiveId,
} from "./sidebar-nav";

describe("sidebar navigation config", () => {
  it("defines the routed primary sidebar links", () => {
    const links = getSidebarNavItems();
    expect(Object.fromEntries(links.map((item) => [item.label, item.path]))).toEqual({
      Home: "/app",
      Library: "/library",
      Movies: "/library/movies",
      Manga: "/library/manga",
      "Light Novel": "/library/light-novel",
      Music: "/library/music",
      Favorites: "/library/favorites",
      Continue: "/library/continue",
      History: "/library/history",
      Downloads: "/library/downloads",
      "Local Folder": "/library/local-folder",
    });
    expect(links.every((item) => typeof item.path === "string" && item.path.length > 0)).toBe(
      true,
    );
  });

  it("keeps the restored sidebar sections without an account section", () => {
    expect(SIDEBAR_NAV_SECTIONS.map((section) => section.label)).toEqual([
      "Browse",
      "Quick Access",
      "Sources",
    ]);
  });

  it("resolves active sidebar items from the current route", () => {
    expect(resolveSidebarActiveId("/app")).toBe("home");
    expect(resolveSidebarActiveId("/library")).toBe("library");
    expect(resolveSidebarActiveId("/library/movies")).toBe("movies");
    expect(resolveSidebarActiveId("/library/manga")).toBe("manga");
    expect(resolveSidebarActiveId("/library/light-novel")).toBe("light-novel");
    expect(resolveSidebarActiveId("/library/music")).toBe("music");
    expect(resolveSidebarActiveId("/library/1a2b3c4d5e")).toBe("library");
    expect(resolveSidebarActiveId("/library/favorites")).toBe("favorites");
    expect(resolveSidebarActiveId("/library/continue")).toBe("continue");
    expect(resolveSidebarActiveId("/library/history")).toBe("history");
    expect(resolveSidebarActiveId("/library/downloads")).toBe("downloads");
    expect(resolveSidebarActiveId("/library/local-folder")).toBe("local-folder");
  });
});

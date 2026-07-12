import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/types";

function installChromeStorageMock() {
  const data = new Map<string, unknown>();
  const local = {
    get: vi.fn(async (key: string) => {
      if (!data.has(key)) return {};
      return { [key]: data.get(key) };
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) data.set(key, value);
    }),
    remove: vi.fn(async (key: string) => {
      data.delete(key);
    }),
  };
  vi.stubGlobal("chrome", {
    storage: {
      local,
      onChanged: {
        addListener: vi.fn(),
      },
    },
  });
  return local;
}

describe("settings storage repository bridge", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("loads signed-in settings from the repository when Supabase is configured", async () => {
    const chromeLocal = installChromeStorageMock();
    const repo = {
      settings: {
        getSettings: vi.fn(async () => ({
          userId: "user-1",
          theme: "light",
          autoplayNext: false,
          defaultVolume: 0.4,
          skipSeconds: 30,
          appSettings: {
            subtitleScale: 1.35,
            libraryView: "grid",
          },
          updatedAt: Date.now(),
        })),
      },
    };

    vi.doMock("../../lib/supabase", () => ({
      isSupabaseConfigured: () => true,
    }));
    vi.doMock("../../platform/storage-adapter", () => ({
      getActiveAccount: () => "user-1",
    }));
    vi.doMock("../../server/db/repository", () => ({
      getRepository: () => repo,
    }));

    const { getSettings } = await import("./storage");
    const settings = await getSettings();

    expect(repo.settings.getSettings).toHaveBeenCalledWith("user-1");
    expect(chromeLocal.get).not.toHaveBeenCalled();
    expect(settings).toMatchObject({
      theme: "light",
      autoplayNext: false,
      defaultVolume: 0.4,
      skipSeconds: 30,
      subtitleScale: 1.35,
      libraryView: "grid",
    });
  });

  it("saves signed-in settings through the repository and returns merged app settings", async () => {
    installChromeStorageMock();
    const repo = {
      settings: {
        getSettings: vi.fn(async () => ({
          userId: "user-1",
          theme: "dark",
          autoplayNext: true,
          defaultVolume: 1,
          skipSeconds: 10,
          appSettings: DEFAULT_SETTINGS,
          updatedAt: Date.now(),
        })),
        saveSettings: vi.fn(async (settings) => settings),
      },
    };

    vi.doMock("../../lib/supabase", () => ({
      isSupabaseConfigured: () => true,
    }));
    vi.doMock("../../platform/storage-adapter", () => ({
      getActiveAccount: () => "user-1",
    }));
    vi.doMock("../../server/db/repository", () => ({
      getRepository: () => repo,
    }));

    const { saveSettings } = await import("./storage");
    const next = await saveSettings({ theme: "light", subtitleScale: 1.5 });

    expect(repo.settings.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        theme: "light",
        autoplayNext: true,
        defaultVolume: 1,
        skipSeconds: 10,
        appSettings: expect.objectContaining({
          theme: "light",
          subtitleScale: 1.5,
        }),
      }),
    );
    expect(next).toMatchObject({ theme: "light", subtitleScale: 1.5 });
  });
});

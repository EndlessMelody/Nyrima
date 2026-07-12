import { describe, expect, it } from "vitest";
import {
  getSupabaseConfigError,
  shouldAllowLocalSupabaseFallback,
} from "./supabase";

describe("Supabase environment guard", () => {
  it("allows local fallback in development when Supabase env is missing", () => {
    expect(
      shouldAllowLocalSupabaseFallback({
        PROD: false,
        VITE_SUPABASE_URL: "",
        VITE_SUPABASE_ANON_KEY: "",
      }),
    ).toBe(true);
  });

  it("blocks local fallback in production when Supabase env is missing", () => {
    const env = {
      PROD: true,
      VITE_SUPABASE_URL: "",
      VITE_SUPABASE_ANON_KEY: "",
    };

    expect(shouldAllowLocalSupabaseFallback(env)).toBe(false);
    expect(getSupabaseConfigError(env)).toContain("VITE_SUPABASE_URL");
    expect(getSupabaseConfigError(env)).toContain("VITE_SUPABASE_ANON_KEY");
  });

  it("allows Supabase mode in production when both frontend env vars are present", () => {
    const env = {
      PROD: true,
      VITE_SUPABASE_URL: "https://project.supabase.co",
      VITE_SUPABASE_ANON_KEY: "anon-key",
    };

    expect(getSupabaseConfigError(env)).toBeNull();
    expect(shouldAllowLocalSupabaseFallback(env)).toBe(false);
  });
});

/**
 * Top-level providers for Nyrima.
 *
 * Once UI was designed for Next.js. In a Vite/extension context the canonical
 * <Providers> from @once-ui-system/core may pull in next/navigation, which
 * does not exist here. We therefore:
 *
 *   1. Import Once UI's CSS so component styles work.
 *   2. Maintain theme state ourselves and reflect it as data-* attributes on
 *      <html>, which is how Once UI tokens cascade.
 *   3. Skip Next.js-specific providers entirely.
 *
 * If the official <Providers> turns out to be import-safe in Vite, we can
 * swap this for it without changing component code.
 */

import {
  type ReactNode,
  useEffect,
  useState,
  createContext,
  useContext,
  useCallback,
} from "react";
import "@once-ui-system/core/css/styles.css";
import "@once-ui-system/core/css/tokens.css";
// Once UI's Flex/Row/Column subscribe to LayoutContext for breakpoint matching;
// without it they throw "useLayout must be used within a LayoutProvider".
// IconProvider + ToastProvider are also wired so any future use of <Icon>
// or toast() doesn't crash. All three are pure React, no Next.js deps.
import {
  LayoutProvider,
  IconProvider,
  ToastProvider,
} from "@once-ui-system/core/contexts";

type ThemeMode = "light" | "dark" | "system";

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: "light" | "dark";
  setMode: (m: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") {
    return typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
  return mode;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>("dark");
  const resolved = resolveTheme(mode);

  // Hydrate the persisted user settings (subtitle scale/font, skip seconds,
  // …) once on boot so the player can read straight from the store. Lazy
  // import keeps the providers file's dependency graph thin.
  useEffect(() => {
    void import("../stores/settings-store").then(({ useSettingsStore }) =>
      useSettingsStore.getState().load(),
    );
  }, []);

  // Reflect resolved theme onto <html> so Once UI's CSS variables flip correctly.
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute("data-theme", resolved);
  }, [resolved]);

  // React to OS theme changes when in system mode.
  useEffect(() => {
    if (mode !== "system" || typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      document.documentElement.setAttribute(
        "data-theme",
        mq.matches ? "light" : "dark",
      );
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  const updateMode = useCallback((m: ThemeMode) => setMode(m), []);

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode: updateMode }}>
      <LayoutProvider>
        <IconProvider>
          <ToastProvider>{children}</ToastProvider>
        </IconProvider>
      </LayoutProvider>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <AppProviders>");
  return ctx;
}

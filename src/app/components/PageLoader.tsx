/**
 * PageLoader — the app's standard full-page loading state: centered,
 * monospace, uppercase, dim. Same treatment `RequireAuth` uses while auth
 * restores and `LobbyPage` uses before its onboarding check resolves,
 * extracted here so a third/fourth caller doesn't re-inline the same style
 * object (and so every "loading this page" moment looks the same instead
 * of some being centered and others defaulting to top-left block text).
 */
export function PageLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        fontFamily: "var(--font-mono, monospace)",
        fontSize: "12px",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        opacity: 0.7,
      }}
    >
      {label}
    </div>
  );
}

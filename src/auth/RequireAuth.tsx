/**
 * Route guard for the app shell routes.
 *
 * - While auth is restoring → a lightweight loader (also keeps app stores from
 *   mounting before the storage partition is set for the right account).
 * - Unauthenticated → redirect to /login, preserving the intended path so we
 *   can bounce back after a successful sign-in.
 * - Guest OR authenticated → render the protected tree. Guests get into the
 *   library/player area; per-feature gating (social, cloud sync) is enforced
 *   downstream via capabilities (`canAccess`), not here, so guests can still
 *   reach a page and see a friendly locked state instead of a hard redirect.
 */

import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./AuthProvider";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
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
        Loading…
      </div>
    );
  }

  // Guests are allowed into the shell; only a fully unauthenticated visitor is
  // bounced to the login threshold.
  if (status !== "authenticated" && status !== "guest") {
    const redirectTo = location.pathname + location.search + location.hash;
    return <Navigate to="/login" replace state={{ from: redirectTo }} />;
  }

  return <>{children}</>;
}

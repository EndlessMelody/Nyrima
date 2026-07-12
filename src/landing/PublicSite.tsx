/**
 * PublicSite — Nyrima's public marketing landing.
 *
 * This is the promo site (formerly a standalone Vite app) folded into the
 * unified web app as the `/` route. The CTAs open the in-app login (`/login`).
 *
 * The bare `/` route is the visual-novel landing stage (LandingVNPage): a single
 * fixed screen where Ny-chan guides the visitor through four sections, each
 * branching into subsections that open a structured information panel.
 *
 * It also backs the `/terms`, `/privacy`, `/faq`, `/contact`, and `/guide`
 * routes via the `forcedView` (+ `termsTab`) props. Each sub-page is a real
 * route now, not a URL hash: the landing keeps clean, shareable URLs and no
 * `#fragment` ever lands in the address bar. React Router keeps this same
 * `PublicSite` instance mounted across those routes (same component type at the
 * same tree slot), so the Three.js background does not thrash on navigation.
 *
 * Lifecycle side effects (kept landing-scoped so app routes are unaffected):
 *   - toggles `html.ny-landing-active` for the page-level resets in
 *     landing-base.scss (scroll-snap, body background)
 *   - applies the pink/cyan Once UI palette while mounted
 */

import { useEffect } from "react";
import { Column } from "@once-ui-system/core/components";
import { AnimeBackground } from "./components/AnimeBackground";
import { AnimationDirector } from "./components/animations/AnimationDirector";
import { NyrimaEntryFlow } from "./landing-vn";
import { SiteHeader } from "./components/layout";
import { useScrollUi, useVisualPerformanceMode } from "./components/sections";
import { TermsPage } from "./components/pages/TermsPage";
import { DownloadPage } from "./components/pages/DownloadPage";
import { QaPage } from "./components/pages/QaPage";
import { ContactUsPage } from "./components/pages/ContactUsPage";
import "./styles/landing-base.scss";
import "./styles/app.scss";
import "./landing-vn/entry-flow.scss";

type PublicView = "landing" | "terms" | "download" | "qa" | "contact";
type LegalTab = "terms" | "privacy" | "license";

export interface PublicSiteProps {
  /** Which sub-page to render. Set by the route (`/terms`, `/privacy`, `/faq`,
   *  `/contact`, `/guide`); the bare `/` route leaves it undefined and shows
   *  the landing. Driving this from the route — not a URL hash — keeps every
   *  public page on a clean, shareable URL. */
  forcedView?: PublicView;
  /** Which tab the combined legal document opens on. */
  termsTab?: LegalTab;
}

export function PublicSite({ forcedView, termsTab = "terms" }: PublicSiteProps) {
  useVisualPerformanceMode();
  const { isScrolled } = useScrollUi();

  const currentView: PublicView = forcedView ?? "landing";

  // Landing-scoped document side effects.
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add("ny-landing-active");
    const prevBrand = html.getAttribute("data-brand");
    const prevAccent = html.getAttribute("data-accent");
    html.setAttribute("data-brand", "pink");
    html.setAttribute("data-accent", "cyan");
    return () => {
      html.classList.remove("ny-landing-active");
      if (prevBrand) html.setAttribute("data-brand", prevBrand);
      if (prevAccent) html.setAttribute("data-accent", prevAccent);
    };
  }, []);

  // On each public route navigation, start the page at the top.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [currentView]);

  return (
    <Column className="ny-site">
      {currentView === "landing" ? (
        // The VN renders its own night-sky backdrop (MagicalSky); the Three.js
        // AnimeBackground is only used by the public sub-pages.
        <NyrimaEntryFlow />
      ) : (
        <>
          <a className="skip-to-main" href="#main-content">
            Skip to main content
          </a>
          <AnimeBackground />
          <AnimationDirector />
          <SiteHeader isScrolled={isScrolled} />

          <main id="main-content" tabIndex={-1}>
            {currentView === "terms" && <TermsPage defaultTab={termsTab} />}
            {currentView === "download" && <DownloadPage />}
            {currentView === "qa" && <QaPage />}
            {currentView === "contact" && <ContactUsPage />}
          </main>
        </>
      )}
    </Column>
  );
}

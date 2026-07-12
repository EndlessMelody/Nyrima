import { useState, useEffect } from "react";
import { NyrimaLoadingScreen } from "./NyrimaLoadingScreen";
import { NyrimaStartMenu } from "./NyrimaStartMenu";
import { LandingVNPage } from "./LandingVNPage";
import "./entry-flow.scss";

export type LandingPhase = "loading" | "start-menu" | "vn";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function NyrimaEntryFlow() {
  const reducedMotion = usePrefersReducedMotion();
  const [phase, setPhase] = useState<LandingPhase>(() => {
    if (
      typeof window !== "undefined" &&
      window.localStorage.getItem("nyrima.entry.hasLoadedOnce") === "true"
    ) {
      return "start-menu";
    }
    return "loading";
  });

  const handleFinishLoading = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("nyrima.entry.hasLoadedOnce", "true");
    }
    setPhase("start-menu");
  };

  const handleStartVN = () => {
    setPhase("vn");
  };

  return (
    <div
      className={`ny-entry-flow${reducedMotion ? " prefers-reduced-motion" : ""}`}
      data-phase={phase}
    >
      {phase === "loading" && <NyrimaLoadingScreen onFinish={handleFinishLoading} />}
      {phase === "start-menu" && (
        <div className="ny-start-menu-wrap">
          <NyrimaStartMenu onStart={handleStartVN} />
        </div>
      )}
      {phase === "vn" && (
        <div className="ny-vn-page-wrap">
          <LandingVNPage />
        </div>
      )}
    </div>
  );
}

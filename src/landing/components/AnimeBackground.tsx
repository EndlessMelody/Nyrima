import { Suspense, lazy, useEffect, useState } from "react";
import { posterBackgroundUrl } from "./sections/sectionData";

const FloatingLines = lazy(() => import("./react-bits/FloatingLines"));
const petalCount = 16;

export function AnimeBackground() {
  const [isBackgroundReady, setIsBackgroundReady] = useState(false);
  const [isWebGlLost, setIsWebGlLost] = useState(false);

  useEffect(() => {
    const win = window as Window & {
      requestIdleCallback?: (callback: () => void) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let timeoutHandle: number | null = null;
    let idleHandle: number | null = null;

    if (win.requestIdleCallback) {
      idleHandle = win.requestIdleCallback(() => setIsBackgroundReady(true));
    } else {
      timeoutHandle = window.setTimeout(() => setIsBackgroundReady(true), 250);
    }

    return () => {
      if (idleHandle !== null && win.cancelIdleCallback) {
        win.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle);
      }
    };
  }, []);

  const showWebGl = isBackgroundReady && !isWebGlLost;

  return (
    <div
      className={`anime-background${isWebGlLost ? " is-webgl-fallback" : ""}`}
      aria-hidden="true"
    >
      <img
        alt=""
        className="anime-background__poster"
        decoding="async"
        src={posterBackgroundUrl}
      />
      <div className="anime-background__floating-lines-frame">
        <div className="anime-background__lines-poster" />
        {showWebGl ? (
          <div className="anime-background__lines-canvas">
            <Suspense fallback={null}>
              <FloatingLines
                linesGradient={["#e945f5", "#45d6ff", "#1f2e59"]}
                lineCount={[5, 4, 5]}
                animationSpeed={0.85}
                bendRadius={8}
                bendStrength={-2}
                mouseDamping={0.05}
                parallaxStrength={0.12}
                onContextLost={() => setIsWebGlLost(true)}
              />
            </Suspense>
          </div>
        ) : null}
      </div>
      <div className="anime-background__petals" aria-hidden="true">
        {Array.from({ length: petalCount }, (_, index) => (
          <span key={index} />
        ))}
      </div>
      <div className="anime-background__speed-lines" />
      <div className="anime-background__glow" />
    </div>
  );
}

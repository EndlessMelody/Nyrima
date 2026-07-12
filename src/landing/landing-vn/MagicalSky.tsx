import { useEffect, useRef, type CSSProperties } from "react";

/**
 * The magical night-sky backdrop for the landing stage: the anime meadow
 * (public/ny_chan/background.png) under layered ambient motion — a slow ken-burns
 * drift, twinkling stars, falling sakura, the occasional shooting star, a
 * breathing horizon bloom, and a vignette that keeps overlaid text readable.
 * Pointer parallax nudges the scene as the cursor moves.
 *
 * All motion is CSS-driven (transform / opacity / background-position) and is
 * fully disabled under prefers-reduced-motion, falling back to the static image.
 */
const PETAL_COUNT = 14;

export function MagicalSky() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    const onMove = (event: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        const x = event.clientX / window.innerWidth - 0.5;
        const y = event.clientY / window.innerHeight - 0.5;
        el.style.setProperty("--px", x.toFixed(3));
        el.style.setProperty("--py", y.toFixed(3));
      });
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="lvn-sky" ref={ref} aria-hidden="true">
      <div className="lvn-sky__image" />
      <div className="lvn-sky__bloom" />
      <div className="lvn-sky__twinkle" />
      <div className="lvn-sky__sakura">
        {Array.from({ length: PETAL_COUNT }).map((_, i) => (
          <span key={i} style={{ "--i": i } as CSSProperties} />
        ))}
      </div>
      <div className="lvn-sky__shooting">
        <span />
        <span />
      </div>
      <div className="lvn-sky__vignette" />
    </div>
  );
}

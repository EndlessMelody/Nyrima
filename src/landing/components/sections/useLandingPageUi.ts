import { useEffect, useRef, useState } from "react";

export function useVisualPerformanceMode() {
  useEffect(() => {
    const body = document.body;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const deviceMemory =
      (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    const cpuCores = navigator.hardwareConcurrency ?? 8;
    const isLowPower = reducedMotion || deviceMemory <= 4 || cpuCores <= 4;

    if (isLowPower) {
      body.classList.add("low-power-visuals");
    }

    let idleTimer: number | null = null;

    const handleScroll = () => {
      body.classList.add("is-scrolling");
      if (idleTimer !== null) {
        window.clearTimeout(idleTimer);
      }
      idleTimer = window.setTimeout(() => {
        body.classList.remove("is-scrolling");
        idleTimer = null;
      }, 160);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
      body.classList.remove("is-scrolling");
      if (isLowPower) {
        body.classList.remove("low-power-visuals");
      }
      if (idleTimer !== null) {
        window.clearTimeout(idleTimer);
      }
    };
  }, []);
}

export function useScrollUi() {
  const [isScrolled, setIsScrolled] = useState(false);
  const isScrolledRef = useRef(false);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const updateScrollState = () => {
      const scrollTop =
        window.scrollY ||
        document.documentElement.scrollTop ||
        document.body.scrollTop ||
        0;

      const nextIsScrolled = isScrolledRef.current ? scrollTop > 32 : scrollTop > 80;
      if (nextIsScrolled !== isScrolledRef.current) {
        isScrolledRef.current = nextIsScrolled;
        setIsScrolled(nextIsScrolled);
      }
    };

    const queueUpdate = () => {
      if (frameRef.current !== null) {
        return;
      }

      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        updateScrollState();
      });
    };

    updateScrollState();
    window.addEventListener("scroll", queueUpdate, { passive: true });
    window.addEventListener("resize", queueUpdate);

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      window.removeEventListener("scroll", queueUpdate);
      window.removeEventListener("resize", queueUpdate);
    };
  }, []);

  return { isScrolled };
}

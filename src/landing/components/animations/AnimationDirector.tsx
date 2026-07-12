import { useEffect } from "react";

const STAGGER_STEP_MS = 65;
const STAGGER_MAX_MS = 390;
const HERO_STAGGER_STEP_MS = 75;
const HERO_STAGGER_MAX_MS = 450;
const REVEAL_CLEANUP_MS = 640;

function applyStaggerDelays(
  groupSelector: string,
  stepMs: number,
  maxMs: number,
) {
  document.querySelectorAll<HTMLElement>(groupSelector).forEach((group) => {
    group.querySelectorAll<HTMLElement>("[data-animate]").forEach((node, index) => {
      node.style.setProperty("--reveal-delay", `${Math.min(index * stepMs, maxMs)}ms`);
    });
  });
}

function revealTarget(target: HTMLElement) {
  target.classList.add("is-visible");
  window.setTimeout(() => {
    target.classList.add("is-revealed");
  }, REVEAL_CLEANUP_MS);
}

export function AnimationDirector() {
  useEffect(() => {
    applyStaggerDelays("[data-stagger]", STAGGER_STEP_MS, STAGGER_MAX_MS);
    applyStaggerDelays("[data-hero-stagger]", HERO_STAGGER_STEP_MS, HERO_STAGGER_MAX_MS);

    const hero = document.getElementById("top");
    if (hero) {
      hero.classList.add("is-hero-ready");
    }

    const targets = Array.from(
      document.querySelectorAll<HTMLElement>("[data-animate]"),
    );

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      targets.forEach(revealTarget);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }
          revealTarget(entry.target as HTMLElement);
          observer.unobserve(entry.target);
        });
      },
      {
        rootMargin: "0px 0px -6% 0px",
        threshold: 0.12,
      },
    );

    targets.forEach((target) => {
      const heroSection = target.closest("#top");
      if (heroSection) {
        const rect = heroSection.getBoundingClientRect();
        if (rect.top < window.innerHeight * 0.92 && rect.bottom > 0) {
          revealTarget(target);
          return;
        }
      }

      observer.observe(target);
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  return null;
}

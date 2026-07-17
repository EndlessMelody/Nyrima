import { useEffect, useRef, useState } from "react";
import { NyrimaMark } from "../../app/components/NyrimaMark";
import { BACKGROUND_ART, EMOTION_ART } from "./mascotArt";

// Preload the scene backdrop + the app icon + the handful of expressions the
// intro actually shows on first paint. The remaining expressions load lazily as
// later sections/login states reach for them, so the loader stays quick.
const IMAGES_TO_PRELOAD = [
  BACKGROUND_ART,
  "/icons/app-icon.png",
  EMOTION_ART.neutral,
  EMOTION_ART.proud,
  EMOTION_ART.smug,
  EMOTION_ART.happy,
  EMOTION_ART.pointing,
  EMOTION_ART.thinking,
];

const FONTS_TO_PRELOAD = ["Chakra Petch", "Audiowide"];

const MESSAGES = [
  "Booting Nyrima...",
  "Loading the sky archive...",
  "Calling Ny-chan...",
  "Preparing your private anime library...",
  "Warming up the typewriter...",
  "Tuning the starlight...",
];

function preloadImage(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = src;
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
  });
}

function preloadFont(fontFamily: string): Promise<void> {
  if (typeof window !== "undefined" && "fonts" in document) {
    return document.fonts
      .load(`1em "${fontFamily}"`)
      .then(() => {})
      .catch((err) => {
        console.warn(`Font loading failed for ${fontFamily}:`, err);
        // Fail gracefully, do not block the app
      });
  }
  return Promise.resolve();
}

function preloadAudio(src: string): Promise<void> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.src = src;
    audio.preload = "auto";
    audio.addEventListener("canplaythrough", () => resolve(), { once: true });
    audio.addEventListener("error", () => resolve(), { once: true });
    audio.load();
    // Timeout to ensure we don't hang if audio load fails silently or takes too long
    setTimeout(resolve, 300);
  });
}

interface NyrimaLoadingScreenProps {
  onFinish: () => void;
}

export function NyrimaLoadingScreen({ onFinish }: NyrimaLoadingScreenProps) {
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [messageIndex, setMessageIndex] = useState(0);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const fadingOutRef = useRef(false);
  const targetProgressRef = useRef(0);
  const startTimeRef = useRef(0);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  // Rotate messages
  useEffect(() => {
    if (error || progress >= 100) return;
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % MESSAGES.length);
    }, 1500);
    return () => clearInterval(interval);
  }, [error, progress]);

  // Easing progress animation loop
  useEffect(() => {
    let active = true;
    let animationFrameId: number;

    const animate = () => {
      if (!active) return;

      setProgress((prev) => {
        let next = prev;
        if (error) {
          // Keep progress stationary if error exists
          return prev;
        }

        if (prev < targetProgressRef.current) {
          // Smooth ease towards target
          const step = Math.max(0.5, Math.min(4, (targetProgressRef.current - prev) * 0.08));
          next = Math.min(targetProgressRef.current, prev + step);
        }

        if (next >= 100 && !fadingOutRef.current) {
          const elapsed = Date.now() - startTimeRef.current;
          if (elapsed >= 800) {
            fadingOutRef.current = true;
            setIsFadingOut(true);
            setTimeout(() => {
              active = false;
              onFinishRef.current();
            }, 350);
          }
        }

        return parseFloat(next.toFixed(1));
      });

      if (active) {
        animationFrameId = requestAnimationFrame(animate);
      }
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => {
      active = false;
      cancelAnimationFrame(animationFrameId);
    };
  }, [error]);

  const startPreload = async () => {
    setError(null);
    setProgress(0);
    targetProgressRef.current = 0;
    startTimeRef.current = Date.now();

    try {
      // Stage 1: Core UI (0% -> 40%)
      for (let p = 0; p <= 40; p += 10) {
        targetProgressRef.current = p;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }

      // Stage 2: Images (40% -> 70%)
      let imagesLoaded = 0;
      const imagePromises = IMAGES_TO_PRELOAD.map(async (src) => {
        await preloadImage(src);
        imagesLoaded++;
        targetProgressRef.current = Math.min(70, 40 + (imagesLoaded / IMAGES_TO_PRELOAD.length) * 30);
      });
      await Promise.all(imagePromises);

      // Stage 3: Fonts (70% -> 90%)
      let fontsLoaded = 0;
      const fontPromises = FONTS_TO_PRELOAD.map(async (font) => {
        await preloadFont(font);
        fontsLoaded++;
        targetProgressRef.current = Math.min(90, 70 + (fontsLoaded / FONTS_TO_PRELOAD.length) * 20);
      });
      await Promise.all(fontPromises);

      // Stage 4: Final Prep / Optional Audio (90% -> 100%)
      targetProgressRef.current = 95;
      await preloadAudio("/sounds/vn-type.wav");
      targetProgressRef.current = 100;
    } catch (err: any) {
      console.error("Critical preloading failed:", err);
      setError(err?.message || "Something drifted off-script.");
    }
  };

  useEffect(() => {
    void startPreload();
  }, []);

  const handleRetry = () => {
    void startPreload();
  };

  const handleContinueAnyway = () => {
    setError(null);
    // Directly push to 100 and allow it to finish
    targetProgressRef.current = 100;
    startTimeRef.current = 0; // force instantaneous skip of minimum 800ms
  };

  return (
    <div className={`lvn-loading${isFadingOut ? " is-fade-out" : ""}`} role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
      <div className="lvn-loading__backdrop" />
      
      <div className="lvn-loading__content">
        <div className="lvn-loading__logo-wrapper">
          <NyrimaMark size="splash" variant="mark" className="lvn-loading__logo" />
        </div>

        <h1 className="lvn-loading__title ny-wordmark">Nyrima</h1>

        {error ? (
          <div className="lvn-loading__error">
            <p className="lvn-loading__error-text">Something drifted off-script.</p>
            <div className="lvn-loading__error-actions">
              <button type="button" className="lvn-loading__btn lvn-loading__btn--primary" onClick={handleRetry}>
                Retry
              </button>
              <button type="button" className="lvn-loading__btn lvn-loading__btn--secondary" onClick={handleContinueAnyway}>
                Continue Anyway
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="lvn-loading__progress-container">
              <div 
                className="lvn-loading__progress-bar" 
                style={{ width: `${progress}%` }} 
              />
            </div>
            <div className="lvn-loading__status">
              <span className="lvn-loading__message">{MESSAGES[messageIndex]}</span>
              <span className="lvn-loading__percentage">{Math.round(progress)}%</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

import { useEffect } from "react";
import { BOOT_LINES, BOOT_LINE_STAGGER_MS, BOOT_TOTAL_MS } from "./bootSequence";

/**
 * The start menu's boot cascade — a staggered mono status readout that plays
 * once per session before the menu reveals. Auto-finishes after
 * `BOOT_TOTAL_MS`, or instantly on any key press / pointer down.
 */
export function BootCascade({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, BOOT_TOTAL_MS);
    window.addEventListener("keydown", onDone);
    window.addEventListener("pointerdown", onDone);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onDone);
      window.removeEventListener("pointerdown", onDone);
    };
  }, [onDone]);

  return (
    <div className="lvn-boot" role="status">
      <div className="lvn-boot__frame">
        {BOOT_LINES.map((line, index) => (
          <p
            key={line.id}
            className="lvn-boot__line"
            style={{ animationDelay: `${index * BOOT_LINE_STAGGER_MS}ms` }}
          >
            <span className="lvn-boot__prompt" aria-hidden="true">
              &gt;
            </span>{" "}
            {line.text}
          </p>
        ))}
        <p
          className="lvn-boot__hint"
          style={{ animationDelay: `${BOOT_LINES.length * BOOT_LINE_STAGGER_MS}ms` }}
        >
          PRESS ANY KEY TO CONTINUE
        </p>
      </div>
    </div>
  );
}

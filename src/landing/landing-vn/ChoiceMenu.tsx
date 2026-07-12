import { useEffect, useRef, type KeyboardEvent } from "react";
import type { DialogueChoice } from "./landingSections";

/**
 * The VN choice menu — rendered above the dialogue box once its base lines
 * finish and a `DialogueChoice` is waiting for a pick. Real buttons (so the
 * stage's "while a button is focused, let it own Enter/Space/arrows" keyboard
 * guard routes them here automatically); the first option auto-focuses on
 * mount, and ArrowUp/Down rove between options.
 *
 * Stops click propagation so the stage-root's advance() can't fire through it
 * — though advance() also no-ops at a choice point as a second guard.
 */
export function ChoiceMenu({
  choice,
  onPick,
}: {
  choice: DialogueChoice;
  onPick: (optionId: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    rootRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [choice]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    buttons[(index + delta + buttons.length) % buttons.length]?.focus();
  };

  return (
    <div
      className="lvn-choice"
      ref={rootRef}
      role="menu"
      aria-label={choice.prompt ?? "Choose a response"}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      {choice.prompt ? <p className="lvn-choice__prompt">{choice.prompt}</p> : null}
      <div className="lvn-choice__options">
        {choice.options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="menuitem"
            className="lvn-choice__option"
            onClick={() => onPick(option.id)}
          >
            <span className="lvn-choice__marker" aria-hidden="true">
              &gt;
            </span>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

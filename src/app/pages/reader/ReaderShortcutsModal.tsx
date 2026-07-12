/**
 * Shortcuts help — a quiet centered overlay generated from the shortcut
 * catalog so the listing never drifts from the actual key handler.
 */

import { useEffect } from "react";
import { X } from "lucide-react";
import { READER_SHORTCUTS, type ShortcutDef } from "../../services/reader/reader-shortcuts";

const GROUPS: Array<ShortcutDef["group"]> = ["Navigate", "Typography", "Tools"];

export function ReaderShortcutsModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="reader-modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <button
        type="button"
        className="reader-modal__scrim"
        aria-label="Close shortcuts"
        onClick={onClose}
      />
      <div className="reader-modal__panel">
        <header className="reader-modal__head">
          <h2>Keyboard shortcuts</h2>
          <button type="button" className="reader-modal__close" onClick={onClose} aria-label="Close">
            <X aria-hidden />
          </button>
        </header>
        <div className="reader-modal__groups">
          {GROUPS.map((group) => (
            <div key={group} className="reader-shortcut-group">
              <h3 className="reader-shortcut-group__title">{group}</h3>
              <ul className="reader-shortcut-list">
                {READER_SHORTCUTS.filter((s) => s.group === group).map((s) => (
                  <li key={s.action} className="reader-shortcut-row">
                    <span className="reader-shortcut-row__label">{s.label}</span>
                    <kbd className="reader-shortcut-row__keys">{s.keys}</kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

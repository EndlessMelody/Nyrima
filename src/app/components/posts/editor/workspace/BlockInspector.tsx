/**
 * "Block" tab of the inspector rail — shows and edits the selected
 * block's type, alignment, colors, and per-type props. All edits flow
 * through `editor.updateBlock`, same pipeline as typing in the canvas.
 *
 * Alignment/color controls are hidden for `callout`: its sanitizer entry
 * in post-doc.ts whitelists only `tone` for that type, so offering them
 * would produce props the sanitizer silently strips on the next reload.
 */

import { Copy, Trash2, ArrowUp, ArrowDown, Check, Minus, Plus } from "lucide-react";
import type { PostBlock, PostDoc } from "@shared/post-types";
import type { PostEditor, PostEditorBlock } from "../post-editor-schema";
import { BlockTypeSwitcher } from "./BlockTypeSwitcher";
import { CONTENT_KIND, BLOCK_TYPE_OPTIONS, COLOR_NAMES } from "./block-type-options";
import { duplicateBlock, deleteBlock } from "./block-actions";
import { resolveColor } from "../../renderer/colors";
import { POST_FONT_CATALOG, POST_FONT_SIZE_RANGE } from "../../post-fonts";

const ALIGNMENTS: { value: string; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
  { value: "justify", label: "Justify" },
];

interface Props {
  editor: PostEditor;
  block: PostEditorBlock;
  doc: PostDoc;
  onDocPatch: (patch: Partial<PostDoc>) => void;
}

export function BlockInspector({ editor, block, doc, onDocPatch }: Props) {
  const postBlock = block as unknown as PostBlock;
  const typeLabel =
    BLOCK_TYPE_OPTIONS.find(
      (o) => o.type === postBlock.type && (o.type !== "heading" || o.extraProps?.level === postBlock.props.level),
    )?.label ?? postBlock.type;

  function setProps(patch: Record<string, string | number | boolean>) {
    editor.updateBlock(block, { props: { ...block.props, ...patch } } as never);
  }

  const blockFont = doc.blockFonts?.[postBlock.id];
  function setBlockFont(patch: { family?: string | null; size?: number | null }) {
    const next = { ...(blockFont ?? {}) };
    if (patch.family !== undefined) {
      if (patch.family === null) delete next.family;
      else next.family = patch.family;
    }
    if (patch.size !== undefined) {
      if (patch.size === null) delete next.size;
      else next.size = patch.size;
    }
    const blockFonts = { ...(doc.blockFonts ?? {}) };
    if (Object.keys(next).length === 0) delete blockFonts[postBlock.id];
    else blockFonts[postBlock.id] = next;
    onDocPatch({ blockFonts: Object.keys(blockFonts).length > 0 ? blockFonts : undefined });
  }

  const contentKind = CONTENT_KIND[postBlock.type];
  const showTextControls = contentKind === "inline" && postBlock.type !== "callout";

  return (
    <div className="ny-inspector-panel">
      <div className="ny-inspector-row ny-inspector-block-actions">
        <button type="button" aria-label="Duplicate block" onClick={() => duplicateBlock(editor, block)}>
          <Copy size={13} />
        </button>
        <button type="button" aria-label="Delete block" onClick={() => deleteBlock(editor, block)}>
          <Trash2 size={13} />
        </button>
        <button type="button" aria-label="Move up" onClick={() => editor.moveBlocksUp(block)}>
          <ArrowUp size={13} />
        </button>
        <button type="button" aria-label="Move down" onClick={() => editor.moveBlocksDown(block)}>
          <ArrowDown size={13} />
        </button>
      </div>

      <Field label="Block type">
        <BlockTypeSwitcher editor={editor} block={block} />
      </Field>

      <div className="ny-inspector-panel__badge">{typeLabel}</div>

      {showTextControls && (
        <>
          <Field label="Alignment">
            <div className="ny-inspector-segmented">
              {ALIGNMENTS.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  className={postBlock.props.textAlignment === a.value ? "is-active" : ""}
                  onClick={() => setProps({ textAlignment: a.value })}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Text color">
            <ColorSwatches
              value={(postBlock.props.textColor as string) ?? "default"}
              kind="text"
              onChange={(c) => setProps({ textColor: c })}
            />
          </Field>

          <Field label="Background">
            <ColorSwatches
              value={(postBlock.props.backgroundColor as string) ?? "default"}
              kind="background"
              onChange={(c) => setProps({ backgroundColor: c })}
            />
          </Field>

          <div
            className="ny-inspector-color-preview"
            style={{
              color: resolveColor((postBlock.props.textColor as string) ?? "default", "text"),
              background:
                postBlock.props.backgroundColor && postBlock.props.backgroundColor !== "default"
                  ? resolveColor(postBlock.props.backgroundColor as string, "background")
                  : undefined,
            }}
          >
            Sample text
          </div>

          <Field label="Font">
            <select
              className="ny-inspector-select"
              value={blockFont?.family ?? ""}
              onChange={(e) => setBlockFont({ family: e.target.value || null })}
            >
              <option value="">Default</option>
              {POST_FONT_CATALOG.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Font size">
            <NumberStepper
              value={blockFont?.size}
              min={POST_FONT_SIZE_RANGE.min}
              max={POST_FONT_SIZE_RANGE.max}
              step={POST_FONT_SIZE_RANGE.step}
              placeholder="Default"
              onChange={(v) => setBlockFont({ size: v ?? null })}
            />
          </Field>
        </>
      )}

      {postBlock.type === "callout" && (
        <Field label="Tone">
          <select
            className="ny-inspector-select"
            value={(postBlock.props.tone as string) ?? "info"}
            onChange={(e) => setProps({ tone: e.target.value })}
          >
            <option value="info">Note</option>
            <option value="warning">Warning</option>
            <option value="fave">Favorite</option>
          </select>
        </Field>
      )}

      {postBlock.type === "driveImage" && (
        <>
          <Field label="Width">
            <select
              className="ny-inspector-select"
              value={(postBlock.props.width as string) ?? "wide"}
              onChange={(e) => setProps({ width: e.target.value })}
            >
              <option value="inline">Inline</option>
              <option value="wide">Wide</option>
              <option value="full">Full</option>
            </select>
          </Field>
          <Field label="Align">
            <select
              className="ny-inspector-select"
              value={(postBlock.props.align as string) ?? "center"}
              onChange={(e) => setProps({ align: e.target.value })}
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </Field>
        </>
      )}

      {postBlock.type === "rating" && (
        <>
          <Field label="Style">
            <select
              className="ny-inspector-select"
              value={(postBlock.props.style as string) ?? "stars"}
              onChange={(e) => setProps({ style: e.target.value })}
            >
              <option value="stars">Stars</option>
              <option value="bar">Bar</option>
            </select>
          </Field>
          <Field label="Value">
            <input
              type="number"
              className="ny-inspector-input"
              min={0}
              max={10}
              step={0.5}
              value={(postBlock.props.value as number) ?? 0}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) setProps({ value: Math.max(0, Math.min(10, v)) });
              }}
            />
          </Field>
        </>
      )}

      {postBlock.type === "spoiler" && (
        <Field label="Label">
          <input
            type="text"
            className="ny-inspector-input"
            value={(postBlock.props.label as string) ?? ""}
            placeholder="Spoiler"
            onChange={(e) => setProps({ label: e.target.value })}
          />
        </Field>
      )}

      {postBlock.type === "linkCard" && (
        <Field label="URL">
          <div className="ny-inspector-hint">
            {postBlock.props.url ? String(postBlock.props.url) : "Edit the link directly in the canvas."}
          </div>
        </Field>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="ny-inspector-field">
      <span className="ny-inspector-field__label">{label}</span>
      {children}
    </label>
  );
}

/** Numeric stepper with Nyrima-styled +/- buttons, replacing the browser's
 *  default `<input type="number">` spinner arrows. `undefined` means "no
 *  override" (falls back to the doc's default), shown as an empty field
 *  with a placeholder rather than a numeric value. */
function NumberStepper({
  value,
  min,
  max,
  step,
  placeholder,
  onChange,
}: {
  value: number | undefined;
  min: number;
  max: number;
  step: number;
  placeholder?: string;
  onChange: (value: number | undefined) => void;
}) {
  function clamp(v: number) {
    return Math.max(min, Math.min(max, v));
  }
  function nudge(delta: number) {
    onChange(clamp((value ?? (delta > 0 ? min - step : max + step)) + delta));
  }
  return (
    <div className="ny-inspector-stepper">
      <button
        type="button"
        aria-label="Decrease"
        onClick={() => nudge(-step)}
        disabled={value !== undefined && value <= min}
      >
        <Minus size={12} />
      </button>
      <input
        type="number"
        inputMode="numeric"
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) => {
          if (e.target.value === "") {
            onChange(undefined);
            return;
          }
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(clamp(v));
        }}
      />
      <button
        type="button"
        aria-label="Increase"
        onClick={() => nudge(step)}
        disabled={value !== undefined && value >= max}
      >
        <Plus size={12} />
      </button>
    </div>
  );
}

/** Circle swatch row for a block's `textColor`/`backgroundColor` prop —
 *  all of `COLOR_NAMES` (minus "default", which gets its own distinct
 *  "no color" swatch) so the picker matches the Document tab's Accent
 *  picker one-for-one. */
function ColorSwatches({
  value,
  kind,
  onChange,
}: {
  value: string;
  kind: "text" | "background";
  onChange: (color: string) => void;
}) {
  return (
    <div className="ny-inspector-swatches">
      <button
        type="button"
        className="ny-inspector-swatch ny-inspector-swatch--none"
        aria-label="No color"
        aria-pressed={value === "default"}
        onClick={() => onChange("default")}
      >
        {value === "default" && <Check size={11} />}
      </button>
      {COLOR_NAMES.filter((c) => c !== "default").map((c) => (
        <button
          key={c}
          type="button"
          className="ny-inspector-swatch"
          aria-label={c}
          aria-pressed={value === c}
          style={{ background: resolveColor(c, kind) }}
          onClick={() => onChange(c)}
        >
          {value === c && <Check size={11} color="#fff" />}
        </button>
      ))}
    </div>
  );
}

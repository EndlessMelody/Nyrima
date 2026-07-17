/**
 * Type dropdown for the selected block, with a confirm dialog when the
 * conversion would destroy content (e.g. an image with a file, or a
 * paragraph with text converting into a block that carries no inline
 * content).
 */

import { useState } from "react";
import { Button, Dialog, Row, Text } from "@once-ui-system/core/components";
import type { PostBlock } from "@shared/post-types";
import type { PostEditor, PostEditorBlock } from "../post-editor-schema";
import {
  BLOCK_TYPE_OPTIONS,
  BLOCK_TYPE_ICON,
  freshPropsFor,
  isLossyConversion,
  type TypeOption,
} from "./block-type-options";

interface Props {
  editor: PostEditor;
  block: PostEditorBlock;
}

export function BlockTypeSwitcher({ editor, block }: Props) {
  const [pending, setPending] = useState<TypeOption | null>(null);
  const postBlock = block as unknown as PostBlock;
  const currentIndex = BLOCK_TYPE_OPTIONS.findIndex(
    (opt) =>
      opt.type === postBlock.type &&
      (opt.type !== "heading" || opt.extraProps?.level === postBlock.props.level),
  );

  function applyConversion(option: TypeOption) {
    editor.updateBlock(block, {
      type: option.type,
      props: freshPropsFor(option),
    } as never);
    editor.focus();
  }

  function handleSelect(index: number) {
    const option = BLOCK_TYPE_OPTIONS[index];
    if (!option) return;
    if (isLossyConversion(postBlock, option.type)) {
      setPending(option);
      return;
    }
    applyConversion(option);
  }

  return (
    <>
      <div className="ny-inspector-type-grid" role="listbox" aria-label="Block type">
        {BLOCK_TYPE_OPTIONS.map((opt, i) => {
          const Icon = BLOCK_TYPE_ICON[opt.type];
          return (
            <button
              key={i}
              type="button"
              role="option"
              aria-selected={i === currentIndex}
              aria-label={opt.label}
              title={opt.label}
              className={i === currentIndex ? "is-active" : ""}
              onClick={() => handleSelect(i)}
            >
              <Icon size={15} />
              {opt.type === "heading" && (
                <span className="ny-inspector-type-grid__level">{opt.extraProps?.level}</span>
              )}
            </button>
          );
        })}
      </div>

      <Dialog
        isOpen={pending !== null}
        onClose={() => setPending(null)}
        title={`Convert to ${pending?.label ?? ""}?`}
        description="This block's content will be removed and can't be recovered."
        style={{ backgroundColor: "var(--page-background)" }}
        footer={
          <Row gap="8">
            <Button variant="tertiary" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (pending) applyConversion(pending);
                setPending(null);
              }}
            >
              Convert
            </Button>
          </Row>
        }
      >
        <Text variant="body-default-xs" onBackground="neutral-weak">
          Text, images, or links in this block won't carry over.
        </Text>
      </Dialog>
    </>
  );
}

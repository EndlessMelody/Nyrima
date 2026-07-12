/**
 * The `driveImage` custom block — the only media block in v1. Props mirror
 * `post-doc.ts`'s sanitizer whitelist for this type exactly (`fileId`,
 * `caption`, `width`, `align`) so nothing an author does in the editor can
 * produce a document the sanitizer downgrades on the next reload.
 */

import { useRef } from "react";
import {
  createReactBlockSpec,
  type ReactCustomBlockRenderProps,
} from "@blocknote/react";
import { useDriveMedia } from "../../useDriveMedia";
import { usePostEditorContext } from "../post-editor-context";

export const driveImageBlockConfig = {
  type: "driveImage",
  propSchema: {
    fileId: { default: "" },
    caption: { default: "" },
    width: { default: "wide", values: ["inline", "wide", "full"] as const },
    align: { default: "center", values: ["left", "center", "right"] as const },
  },
  content: "none",
} as const;

type RenderProps = ReactCustomBlockRenderProps<typeof driveImageBlockConfig>;

function DriveImageBlockRender({ block, editor }: RenderProps) {
  const { pickDriveImage, uploadImage } = usePostEditorContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { url, loading, error } = useDriveMedia(block.props.fileId || undefined);

  function setProps(patch: Partial<typeof block.props>) {
    editor.updateBlock(block, { props: { ...block.props, ...patch } });
  }

  async function handleChooseFromDrive() {
    const file = await pickDriveImage();
    if (file) setProps({ fileId: file.id });
  }

  async function handleUploadClick() {
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const uploaded = await uploadImage(file);
    setProps({ fileId: uploaded.id });
  }

  if (!block.props.fileId) {
    return (
      <div className="ny-drive-image-block ny-drive-image-block--empty" contentEditable={false}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => void handleFileSelected(e)}
          style={{ display: "none" }}
        />
        <button type="button" onClick={() => void handleUploadClick()}>
          Upload image
        </button>
        <button type="button" onClick={() => void handleChooseFromDrive()}>
          Choose from Drive
        </button>
      </div>
    );
  }

  return (
    <figure
      className={`ny-drive-image-block ny-drive-image-block--${block.props.width} ny-drive-image-block--${block.props.align}`}
      contentEditable={false}
    >
      <div className="ny-drive-image-block__toolbar">
        <button type="button" onClick={() => void handleChooseFromDrive()}>
          Replace
        </button>
        <select
          value={block.props.width}
          onChange={(e) => setProps({ width: e.target.value as typeof block.props.width })}
        >
          <option value="inline">Inline</option>
          <option value="wide">Wide</option>
          <option value="full">Full</option>
        </select>
        <select
          value={block.props.align}
          onChange={(e) => setProps({ align: e.target.value as typeof block.props.align })}
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </div>

      {loading && <div className="ny-drive-image-block__placeholder">Loading…</div>}
      {error && <div className="ny-drive-image-block__placeholder ny-drive-image-block__placeholder--error">{error}</div>}
      {url && <img src={url} alt={block.props.caption || ""} />}

      <input
        type="text"
        className="ny-drive-image-block__caption"
        value={block.props.caption}
        placeholder="Caption (optional)"
        onChange={(e) => setProps({ caption: e.target.value })}
      />
    </figure>
  );
}

export const driveImageBlockSpec = createReactBlockSpec(driveImageBlockConfig, {
  render: DriveImageBlockRender,
});

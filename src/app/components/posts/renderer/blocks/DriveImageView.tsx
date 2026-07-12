import type { PostBlock } from "@shared/post-types";
import { useDriveMedia } from "../../useDriveMedia";

export function DriveImageView({ block }: { block: PostBlock }) {
  const fileId = typeof block.props.fileId === "string" ? block.props.fileId : undefined;
  const { url, loading, error } = useDriveMedia(fileId);
  const width = typeof block.props.width === "string" ? block.props.width : "wide";
  const align = typeof block.props.align === "string" ? block.props.align : "center";
  const caption = typeof block.props.caption === "string" ? block.props.caption : "";

  return (
    <figure className={`ny-post-image ny-post-image--${width} ny-post-image--${align}`}>
      {loading && <div className="ny-post-image__placeholder">Loading image…</div>}
      {error && (
        <div className="ny-post-image__placeholder ny-post-image__placeholder--error">
          Image unavailable
        </div>
      )}
      {url && <img src={url} alt={caption} loading="lazy" decoding="async" />}
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

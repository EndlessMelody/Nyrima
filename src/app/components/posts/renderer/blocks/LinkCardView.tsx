import type { PostBlock } from "@shared/post-types";
import { faviconUrlFor } from "../../../../services/posts";

export function LinkCardView({ block }: { block: PostBlock }) {
  const url = typeof block.props.url === "string" ? block.props.url : "";
  if (!url) return null;
  const title = typeof block.props.title === "string" && block.props.title ? block.props.title : hostnameOf(url);
  const description = typeof block.props.description === "string" ? block.props.description : "";
  const imageUrl = typeof block.props.imageUrl === "string" ? block.props.imageUrl : "";
  const siteName = typeof block.props.siteName === "string" && block.props.siteName ? block.props.siteName : hostnameOf(url);
  const thumb = imageUrl || faviconUrlFor(url);

  return (
    <a className="ny-post-link-card" href={url} target="_blank" rel="noopener noreferrer">
      {thumb && (
        <div className="ny-post-link-card__thumb">
          <img src={thumb} alt="" loading="lazy" decoding="async" />
        </div>
      )}
      <div className="ny-post-link-card__body">
        <span className="ny-post-link-card__title">{title}</span>
        {description && <span className="ny-post-link-card__description">{description}</span>}
        <span className="ny-post-link-card__site">{siteName}</span>
      </div>
    </a>
  );
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

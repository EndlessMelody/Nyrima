/**
 * The `linkCard` custom block. Props mirror `post-doc.ts`'s sanitizer
 * whitelist exactly (`url`, `title`, `description`, `imageUrl`,
 * `siteName`). The preview is fetched once, on explicit user action (Add
 * link / Refetch) via `fetchLinkPreview` — never on keystroke, to stay
 * inside the free microlink.io tier. On failure the block keeps the raw
 * url and falls back to a manual title + favicon.
 */

import { useState } from "react";
import { createReactBlockSpec, type ReactCustomBlockRenderProps } from "@blocknote/react";
import { fetchLinkPreview, faviconUrlFor, LinkPreviewError } from "../../../../services/posts";

export const linkCardBlockConfig = {
  type: "linkCard",
  propSchema: {
    url: { default: "" },
    title: { default: "" },
    description: { default: "" },
    imageUrl: { default: "" },
    siteName: { default: "" },
    fetched: { default: false },
  },
  content: "none",
} as const;

type RenderProps = ReactCustomBlockRenderProps<typeof linkCardBlockConfig>;

function LinkCardBlockRender({ block, editor }: RenderProps) {
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingUrl, setEditingUrl] = useState(false);

  function setProps(patch: Partial<typeof block.props>) {
    editor.updateBlock(block, { props: { ...block.props, ...patch } });
  }

  async function submitUrl(raw: string) {
    setError(null);
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      setError("Enter a valid URL.");
      return;
    }
    if (url.protocol !== "https:") {
      setError("Only https links are supported.");
      return;
    }
    setLoading(true);
    try {
      const preview = await fetchLinkPreview(url.toString());
      setProps({
        url: preview.url,
        title: preview.title ?? "",
        description: preview.description ?? "",
        imageUrl: preview.imageUrl ?? "",
        siteName: preview.siteName ?? "",
        fetched: true,
      });
      setEditingUrl(false);
    } catch (e) {
      const rateLimited = e instanceof LinkPreviewError && e.rateLimited;
      setProps({ url: url.toString(), fetched: false });
      setError(
        rateLimited
          ? "Preview service is rate-limited — enter a title manually below."
          : "Couldn't fetch a preview — enter a title manually below.",
      );
      setEditingUrl(false);
    } finally {
      setLoading(false);
    }
  }

  if (!block.props.url || editingUrl) {
    return (
      <div className="ny-link-card-block ny-link-card-block--empty" contentEditable={false}>
        <input
          type="url"
          placeholder="Paste a link (https://…)"
          value={inputValue || block.props.url}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submitUrl(inputValue || block.props.url);
          }}
        />
        <button type="button" disabled={loading} onClick={() => void submitUrl(inputValue || block.props.url)}>
          {loading ? "Fetching…" : "Add link"}
        </button>
        {error && <span className="ny-link-card-block__error">{error}</span>}
      </div>
    );
  }

  const favicon = faviconUrlFor(block.props.url);
  const thumb = block.props.imageUrl || favicon;

  return (
    <div className="ny-link-card-block" contentEditable={false}>
      <div className="ny-link-card-block__toolbar">
        <button type="button" onClick={() => { setInputValue(block.props.url); setEditingUrl(true); }}>
          Edit URL
        </button>
        <button type="button" disabled={loading} onClick={() => void submitUrl(block.props.url)}>
          {loading ? "Fetching…" : "Refetch"}
        </button>
      </div>

      {!block.props.fetched && (
        <input
          type="text"
          className="ny-link-card-block__title-input"
          placeholder="Title"
          value={block.props.title}
          onChange={(e) => setProps({ title: e.target.value })}
        />
      )}

      <a
        className="ny-link-card-block__preview"
        href={block.props.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.preventDefault()}
      >
        {thumb && (
          <div className="ny-link-card-block__thumb">
            <img src={thumb} alt="" />
          </div>
        )}
        <div className="ny-link-card-block__body">
          <span className="ny-link-card-block__title">{block.props.title || block.props.url}</span>
          {block.props.description && (
            <span className="ny-link-card-block__description">{block.props.description}</span>
          )}
          <span className="ny-link-card-block__site">{block.props.siteName || hostnameOf(block.props.url)}</span>
        </div>
      </a>
      {error && <span className="ny-link-card-block__error">{error}</span>}
    </div>
  );
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export const linkCardBlockSpec = createReactBlockSpec(linkCardBlockConfig, {
  render: LinkCardBlockRender,
});

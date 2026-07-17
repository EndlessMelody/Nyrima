/**
 * Read-mode preview inside the editor — mirrors `PostViewPage`'s markup
 * (minus the like control, which needs a real published post) so what an
 * author sees here matches what a reader will see. Renders straight from
 * the in-memory `doc.blocks`, which `editor.onChange` keeps current on
 * every keystroke, so no flush is needed when toggling into preview.
 */

import type { PostDoc } from "@shared/post-types";
import { PostRenderer } from "../../renderer/PostRenderer";
import { TableOfContents } from "../../renderer/TableOfContents";
import { resolveColor } from "../../renderer/colors";
import "../../../../pages/PostViewPage.scss";

export function EditorPreview({ doc }: { doc: PostDoc }) {
  return (
    <article className="ny-post-view-page ny-editor-preview">
      <header
        className="ny-post-view-page__header"
        style={
          doc.accent
            ? { borderTop: `3px solid ${resolveColor(doc.accent, "text")}`, paddingTop: 14 }
            : undefined
        }
      >
        <h1>{doc.title || "Untitled post"}</h1>
        {doc.tags && doc.tags.length > 0 && (
          <div className="ny-post-view-page__tags">
            {doc.tags.map((tag) => (
              <span key={tag} className="ny-post-view-page__tag">
                {tag}
              </span>
            ))}
          </div>
        )}
      </header>
      {doc.showToc && <TableOfContents blocks={doc.blocks} />}
      <PostRenderer blocks={doc.blocks} blockFonts={doc.blockFonts} />
    </article>
  );
}

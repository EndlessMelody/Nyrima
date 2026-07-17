/**
 * "Document" tab of the inspector rail — tags, cover image, and
 * visibility summary. (The heading outline moved to the always-visible
 * left structure rail — see `StructureRail.tsx`.) Tag rules mirror
 * `sanitizeTags` (post-doc.ts): lowercase, deduped, capped at
 * MAX_POST_TAGS × MAX_POST_TAG_CHARS, so nothing typed here gets
 * silently trimmed later.
 */

import { useState } from "react";
import { X, Check } from "lucide-react";
import { MAX_POST_TAGS, MAX_POST_TAG_CHARS, MAX_POST_EXCERPT_CHARS } from "@shared/constants";
import type { PostBlockType, PostDoc } from "@shared/post-types";
import type { PostStats } from "../../../../services/posts";
import { useDriveMedia } from "../../useDriveMedia";
import { usePostEditorContext } from "../post-editor-context";
import { resolveColor } from "../../renderer/colors";
import { COLOR_NAMES } from "./block-type-options";

/** Singular/plural labels for the stats breakdown — deliberately separate
 *  from `BLOCK_TYPE_LABEL` (block-type-options.ts), which serves the type
 *  switcher/toolbar where "Text" reads fine but "3 Texts" doesn't. */
const STATS_LABEL: Partial<Record<PostBlockType, [string, string]>> = {
  paragraph: ["paragraph", "paragraphs"],
  heading: ["heading", "headings"],
  bulletListItem: ["bullet item", "bullet items"],
  numberedListItem: ["numbered item", "numbered items"],
  checkListItem: ["checklist item", "checklist items"],
  quote: ["quote", "quotes"],
  codeBlock: ["code block", "code blocks"],
  callout: ["callout", "callouts"],
  driveImage: ["image", "images"],
  linkCard: ["link", "links"],
  spoiler: ["spoiler", "spoilers"],
  rating: ["rating", "ratings"],
};
const STATS_ORDER = Object.keys(STATS_LABEL) as PostBlockType[];

interface Props {
  doc: PostDoc;
  stats: PostStats;
  onDocPatch: (patch: Partial<PostDoc>) => void;
  onOpenPublish: () => void;
}

export function DocumentInspector({ doc, stats, onDocPatch, onOpenPublish }: Props) {
  const { pickDriveImage, uploadImage } = usePostEditorContext();
  const { url: coverUrl } = useDriveMedia(doc.cover?.fileId);
  const [tagInput, setTagInput] = useState("");
  const [coverBusy, setCoverBusy] = useState(false);

  function addTag() {
    const raw = tagInput.trim().toLowerCase().slice(0, MAX_POST_TAG_CHARS);
    setTagInput("");
    if (!raw) return;
    const existing = doc.tags ?? [];
    if (existing.includes(raw) || existing.length >= MAX_POST_TAGS) return;
    onDocPatch({ tags: [...existing, raw] });
  }

  function removeTag(tag: string) {
    onDocPatch({ tags: (doc.tags ?? []).filter((t) => t !== tag) });
  }

  function handleUploadCover() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setCoverBusy(true);
      try {
        const uploaded = await uploadImage(file);
        onDocPatch({ cover: { fileId: uploaded.id } });
      } finally {
        setCoverBusy(false);
      }
    };
    input.click();
  }

  async function handleChooseCover() {
    const file = await pickDriveImage();
    if (file) onDocPatch({ cover: { fileId: file.id } });
  }

  const visibilityLabel =
    doc.visibility === "public"
      ? "Public"
      : doc.visibility === "friends"
        ? "Friends"
        : doc.visibility === "private"
          ? "Private"
          : "Draft";

  const publishedLabel = doc.publishedAt
    ? `Published ${new Date(doc.publishedAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })}`
    : "Not yet published";

  return (
    <div className="ny-inspector-panel">
      <Field label="Overview">
        <div className="ny-inspector-stats ny-inspector-stats--prominent">
          <span>
            {stats.words} word{stats.words === 1 ? "" : "s"} · {stats.minutes} min read
          </span>
          {STATS_ORDER.filter((type) => stats.counts[type]).length > 0 && (
            <span>
              {STATS_ORDER.filter((type) => stats.counts[type])
                .map((type) => {
                  const count = stats.counts[type]!;
                  const [singular, plural] = STATS_LABEL[type]!;
                  return `${count} ${count === 1 ? singular : plural}`;
                })
                .join(" · ")}
            </span>
          )}
        </div>
      </Field>

      <Field label="Publish status">
        <div className="ny-inspector-row ny-inspector-row--between">
          <span className="ny-inspector-visibility">{publishedLabel}</span>
          <button type="button" onClick={onOpenPublish}>
            Change…
          </button>
        </div>
      </Field>

      <Field label="Tags">
        <div className="ny-inspector-tags">
          {(doc.tags ?? []).map((tag) => (
            <span key={tag} className="ny-inspector-tag">
              {tag}
              <button type="button" onClick={() => removeTag(tag)} aria-label={`Remove ${tag}`}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
        <input
          type="text"
          className="ny-inspector-input"
          placeholder={(doc.tags?.length ?? 0) >= MAX_POST_TAGS ? "Tag limit reached" : "Add a tag…"}
          value={tagInput}
          disabled={(doc.tags?.length ?? 0) >= MAX_POST_TAGS}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag();
            }
          }}
        />
      </Field>

      <Field label="Cover image">
        {coverUrl ? (
          <div className="ny-inspector-cover">
            <img src={coverUrl} alt="" />
          </div>
        ) : (
          <div className="ny-inspector-cover ny-inspector-cover--empty">No cover</div>
        )}
        <div className="ny-inspector-row">
          <button type="button" disabled={coverBusy} onClick={handleUploadCover}>
            Upload
          </button>
          <button type="button" onClick={() => void handleChooseCover()}>
            Choose from Drive
          </button>
        </div>
      </Field>

      <Field label="Accent">
        <div className="ny-inspector-swatches">
          {COLOR_NAMES.map((c) => (
            <button
              key={c}
              type="button"
              className="ny-inspector-swatch"
              aria-label={c}
              aria-pressed={(doc.accent ?? "default") === c}
              style={c === "default" ? undefined : { background: resolveColor(c, "text") }}
              onClick={() => onDocPatch({ accent: c === "default" ? undefined : c })}
            >
              {(doc.accent ?? "default") === c && <Check size={11} />}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Visibility">
        <div className="ny-inspector-row ny-inspector-row--between">
          <span className="ny-inspector-visibility">{visibilityLabel}</span>
          <button type="button" onClick={onOpenPublish}>
            Change…
          </button>
        </div>
      </Field>

      <Field label="SEO meta description">
        <textarea
          className="ny-inspector-input ny-inspector-textarea"
          placeholder="A hand-written blurb for share previews and search results…"
          maxLength={MAX_POST_EXCERPT_CHARS}
          value={doc.metaDescription ?? ""}
          onChange={(e) => onDocPatch({ metaDescription: e.target.value || undefined })}
        />
      </Field>

      <Field label="Table of contents">
        <button
          type="button"
          className="ny-inspector-toggle"
          role="switch"
          aria-checked={doc.showToc === true}
          onClick={() => onDocPatch({ showToc: doc.showToc ? undefined : true })}
        >
          <span className="ny-inspector-toggle__thumb" />
          {doc.showToc ? "Shown on published page" : "Hidden on published page"}
        </button>
      </Field>
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

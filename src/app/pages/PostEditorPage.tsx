/**
 * PostEditorPage — `/posts/new` and `/posts/edit/:folderId`.
 *
 * `/posts/new` bootstraps a fresh post folder + empty draft immediately on
 * mount (once the author's share profile is known), then replaces the URL
 * with `/posts/edit/:folderId` — same "create row, redirect to its real
 * URL" pattern as most document editors, so a refresh mid-draft never
 * creates a second empty post and `PostEditor` only ever mounts once a
 * real Drive folder exists (needed for image uploads).
 *
 * Autosave: title and block edits both flow into one `doc` state object;
 * a single debounced effect persists it ~2.5s after the last change. Two
 * independently-debounced writers (title vs. blocks) would race pointlessly
 * — `savePost`'s per-folder queue makes concurrent saves safe, but there's
 * no reason to have more than one timer.
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Text } from "@once-ui-system/core/components";
import { useAuth } from "@/auth/AuthProvider";
import { SocialLockedState } from "../components/SocialLockedState";
import { useSharingStore } from "../stores/sharing-store";
import { profileToAuthor } from "../services/sharing";
import {
  createPostFolder,
  generatePostId,
  readPost,
  savePost,
} from "../services/posts";
import type { PostBlock, PostDoc } from "@shared/post-types";
import { PostEditor } from "../components/posts/editor/PostEditor";
import { PublishDialog } from "../components/posts/PublishDialog";
import "./PostEditorPage.scss";

const AUTOSAVE_DELAY_MS = 2500;

export function PostEditorPage() {
  const { canAccess } = useAuth();
  return canAccess("social:profile") ? <PostEditorHub /> : <SocialLockedState />;
}

type SaveState = "idle" | "saving" | "saved" | "error";

function PostEditorHub() {
  const { folderId: routeFolderId } = useParams<{ folderId?: string }>();
  const isNew = !routeFolderId;
  const navigate = useNavigate();

  const profile = useSharingStore((s) => s.profile);
  const profileLoaded = useSharingStore((s) => s.profileLoaded);
  const loadProfile = useSharingStore((s) => s.loadProfile);

  const [postFolderId, setPostFolderId] = useState<string | null>(
    routeFolderId ?? null,
  );
  const [doc, setDoc] = useState<PostDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [publishOpen, setPublishOpen] = useState(false);

  const bootstrapped = useRef(false);
  const debounceHandle = useRef<number | null>(null);
  const skipNextAutosave = useRef(false);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  // Edit mode: load the existing doc.
  useEffect(() => {
    if (isNew || !routeFolderId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    readPost(routeFolderId)
      .then((loaded) => {
        if (cancelled) return;
        if (!loaded) {
          setError("Couldn't find that post.");
          setLoading(false);
          return;
        }
        setDoc(loaded);
        setPostFolderId(routeFolderId);
        setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Couldn't load post.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isNew, routeFolderId]);

  // New-post mode: bootstrap a fresh folder + draft, then redirect to its
  // edit URL. Runs once per mount (guarded by `bootstrapped`), waits for
  // the share profile to resolve since it's stamped as the post's author.
  useEffect(() => {
    if (!isNew || bootstrapped.current) return;
    if (!profileLoaded) return;
    if (!profile) {
      setLoading(false);
      return;
    }
    bootstrapped.current = true;
    let cancelled = false;
    (async () => {
      try {
        const id = generatePostId();
        const now = new Date().toISOString();
        const scaffold: PostDoc = {
          v: 1,
          id,
          author: profileToAuthor(profile),
          title: "",
          createdAt: now,
          updatedAt: now,
          visibility: "draft",
          blocks: [],
        };
        const folder = await createPostFolder(id);
        await savePost(folder.id, scaffold);
        if (cancelled) return;
        skipNextAutosave.current = true;
        setPostFolderId(folder.id);
        setDoc(scaffold);
        setLoading(false);
        setSaveState("saved");
        navigate(`/posts/edit/${folder.id}`, { replace: true });
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Couldn't create post.");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isNew, profile, profileLoaded, navigate]);

  // Debounced autosave whenever the doc changes.
  useEffect(() => {
    if (!doc || !postFolderId) return;
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false;
      return;
    }
    if (debounceHandle.current) window.clearTimeout(debounceHandle.current);
    debounceHandle.current = window.setTimeout(() => {
      void persist(postFolderId, doc);
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (debounceHandle.current) window.clearTimeout(debounceHandle.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, postFolderId]);

  async function persist(folderId: string, current: PostDoc) {
    setSaveState("saving");
    try {
      await savePost(folderId, current);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  function handleTitleChange(title: string) {
    setDoc((d) => (d ? { ...d, title } : d));
  }

  function handleBlocksChange(blocks: PostBlock[]) {
    setDoc((d) => (d ? { ...d, blocks } : d));
  }

  if (loading) {
    return (
      <div className="ny-post-editor-page">
        <Text variant="body-default-s" onBackground="neutral-weak">
          Loading…
        </Text>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ny-post-editor-page">
        <Text
          variant="body-default-s"
          style={{ color: "var(--danger-on-background-strong, #ff8a8a)" }}
        >
          {error}
        </Text>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="ny-post-editor-page">
        <Text variant="body-default-s" onBackground="neutral-weak">
          Pick a share handle before creating posts — open Settings to set one up.
        </Text>
      </div>
    );
  }

  if (!doc) return null;

  return (
    <div className="ny-post-editor-page">
      <div className="ny-post-editor-page__header">
        <input
          className="ny-post-editor-page__title"
          value={doc.title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Post title"
          maxLength={240}
        />
        <div className="ny-post-editor-page__actions">
          <SaveIndicator state={saveState} />
          <Button
            variant="primary"
            onClick={() => setPublishOpen(true)}
            disabled={!postFolderId}
          >
            {doc.visibility === "draft" ? "Publish" : "Update publish settings"}
          </Button>
        </div>
      </div>

      {postFolderId && (
        <PostEditor
          postFolderId={postFolderId}
          initialBlocks={doc.blocks}
          onBlocksChange={handleBlocksChange}
        />
      )}

      <PublishDialog
        isOpen={publishOpen}
        onClose={() => setPublishOpen(false)}
        postFolderId={postFolderId}
        doc={doc}
        onPublished={(next) => setDoc(next)}
      />
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const label =
    state === "saving"
      ? "Saving…"
      : state === "saved"
        ? "Saved"
        : state === "error"
          ? "Couldn't save"
          : "";
  if (!label) return null;
  return (
    <Text
      variant="body-default-xs"
      onBackground="neutral-weak"
      style={{
        fontFamily: "var(--dc-font-mono)",
        color:
          state === "error"
            ? "var(--danger-on-background-strong, #ff8a8a)"
            : undefined,
      }}
    >
      {label}
    </Text>
  );
}

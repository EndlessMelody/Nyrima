/**
 * PostEditorPage — `/posts/new` and `/posts/edit/:folderId`.
 *
 * Local-first drafting: `/posts/new` never touches Drive. It generates a
 * post id, writes a blank scaffold to `chrome.storage.local`
 * (post-local-draft.ts), and replaces the URL with
 * `/posts/edit/local-<id>` — same "create row, redirect to its real URL"
 * pattern the old Drive-backed flow used, just against local storage
 * instead of a Drive folder. A post is only ever promoted to a real
 * `Posts/<postId>/` folder on Drive (`promoteLocalDraftToDrive`) when
 * something actually needs Drive: an image upload (`ensureDriveFolder`,
 * threaded into `PostEditor`), an explicit Publish click below, or the
 * "Save to Drive" action on the Posts feed's resume-draft banner. This is
 * what stops an idle or abandoned `/posts/new` visit from littering
 * `Posts/` with empty folders — the old failure mode behind
 * "Couldn't find that post.".
 *
 * A share handle is NOT required to draft — only to publish (see
 * PublishDialog); a draft created before one is picked up gets its author
 * re-stamped from the profile as soon as it's available (`persist`, and
 * again on promotion in `promoteLocalDraftToDrive`).
 *
 * Nothing here blocks navigating away from an unfinished local draft —
 * it's already autosaved locally the whole time (see the resume banner on
 * PostsFeedPage for how the user gets back to it). A `beforeunload`
 * listener below only guards the browser-level case (tab close/refresh)
 * with the native "unsaved changes" prompt, since that's the one exit path
 * the resume banner can't cover.
 *
 * Autosave: title and block edits both flow into one `doc` state object;
 * a single debounced effect persists it ~2.5s after the last change. Two
 * independently-debounced writers (title vs. blocks) would race pointlessly
 * — `savePost`'s per-folder queue makes concurrent saves safe, but there's
 * no reason to have more than one timer.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Text } from "@once-ui-system/core/components";
import { useAuth } from "@/auth/AuthProvider";
import { SocialLockedState } from "../components/SocialLockedState";
import { PageLoader } from "../components/PageLoader";
import { useSharingStore } from "../stores/sharing-store";
import { getShareProfile, profileToAuthor } from "../services/sharing";
import {
  fromLocalDraftRouteId,
  generatePostId,
  getDefaultPostVisibility,
  isLocalDraftRouteId,
  postDraftHasContent,
  promoteLocalDraftToDrive,
  readLocalDraft,
  readPost,
  saveLocalDraft,
  savePost,
  toLocalDraftRouteId,
} from "../services/posts";
import type { ShareAuthor } from "@shared/types";
import type { PostBlock, PostDoc } from "@shared/post-types";
import { EditorWorkspace } from "../components/posts/editor/workspace/EditorWorkspace";
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
  const { account } = useAuth();

  const profile = useSharingStore((s) => s.profile);
  const loadProfile = useSharingStore((s) => s.loadProfile);

  // null until the post is promoted to a real Drive folder — see the
  // module doc. Only seeded from the route param when that param is a real
  // Drive folder id, not a `local-` draft id.
  const [postFolderId, setPostFolderId] = useState<string | null>(() =>
    routeFolderId && !isLocalDraftRouteId(routeFolderId) ? routeFolderId : null,
  );
  const [doc, setDoc] = useState<PostDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const bootstrapped = useRef(false);
  const debounceHandle = useRef<number | null>(null);
  const skipNextAutosave = useRef(false);
  const docRef = useRef<PostDoc | null>(null);
  const pushInFlight = useRef<Promise<string> | null>(null);

  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  // Load an existing doc — either a local-only draft or a real Drive post,
  // distinguished by the `local-` route-id prefix (post-local-draft.ts).
  // Re-runs fully per `routeFolderId` change (no ref-guard), so each run
  // registers its own promise handlers — safe under React 18 StrictMode's
  // dev double-invoke, unlike the ref-guarded bootstrap effect below.
  useEffect(() => {
    if (isNew || !routeFolderId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        if (isLocalDraftRouteId(routeFolderId)) {
          const entry = await readLocalDraft(fromLocalDraftRouteId(routeFolderId));
          if (cancelled) return;
          if (!entry) {
            setError("Couldn't find that draft.");
            setLoading(false);
            return;
          }
          setDoc(entry.doc);
          setPostFolderId(null);
          setLoading(false);
        } else {
          const loaded = await readPost(routeFolderId);
          if (cancelled) return;
          if (!loaded) {
            setError("Couldn't find that post.");
            setLoading(false);
            return;
          }
          setDoc(loaded);
          setPostFolderId(routeFolderId);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Couldn't load post.");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isNew, routeFolderId]);

  // New-post mode: write a blank local draft, then redirect to its local
  // edit URL. Runs once per mount (guarded by `bootstrapped`) and touches
  // no Drive/network APIs, so there's nothing to wait on — no share
  // profile, no Drive folder creation.
  //
  // Deliberately no `cancelled`/cleanup guard: `bootstrapped.current`
  // already makes this a true one-shot. Under React 18 StrictMode's
  // dev-only double-invoke (mount → cleanup → mount, same component
  // instance), a `cancelled` flag set by the *first* run's cleanup would
  // silently discard the only result the async work ever produces — the
  // second run bails out immediately via `bootstrapped` without starting
  // its own — leaving `loading` stuck `true` forever. Same gotcha as the
  // Drive-load + StrictMode pattern documented on `useDriveMedia`.
  useEffect(() => {
    if (!isNew || bootstrapped.current) return;
    bootstrapped.current = true;
    (async () => {
      try {
        const id = generatePostId();
        const now = new Date().toISOString();
        const profileNow = await getShareProfile();
        const author: ShareAuthor = profileNow
          ? profileToAuthor(profileNow)
          : { handle: "", name: account?.displayName, avatarUrl: account?.avatarUrl };
        const visibility = await getDefaultPostVisibility();
        const scaffold: PostDoc = {
          v: 1,
          id,
          author,
          title: "",
          createdAt: now,
          updatedAt: now,
          visibility,
          blocks: [],
        };
        await saveLocalDraft(id, scaffold);
        skipNextAutosave.current = true;
        setDoc(scaffold);
        setLoading(false);
        setSaveState("saved");
        navigate(`/posts/edit/${toLocalDraftRouteId(id)}`, { replace: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't start a new draft.");
        setLoading(false);
      }
    })();
    // account is only read once, guarded by `bootstrapped` — omitted deliberately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, navigate]);

  // Warn on tab close/refresh while there's unsaved local-only content —
  // the one exit path the Posts feed's resume banner can't reach. Once
  // promoted to Drive, autosave has already persisted every change, so
  // there's nothing left to warn about.
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (postFolderId) return;
      if (!doc || !postDraftHasContent(doc)) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [doc, postFolderId]);

  // Debounced autosave whenever the doc changes — writes to Drive once
  // promoted, local storage otherwise (see `persist`).
  useEffect(() => {
    if (!doc) return;
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false;
      return;
    }
    if (debounceHandle.current) window.clearTimeout(debounceHandle.current);
    debounceHandle.current = window.setTimeout(() => {
      void persist(doc);
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (debounceHandle.current) window.clearTimeout(debounceHandle.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, postFolderId]);

  async function persist(current: PostDoc) {
    setSaveState("saving");
    try {
      // A handle picked mid-draft (via Settings) should be picked up without
      // extra plumbing — cheap no-op once the author is already current.
      const stillUnpublished = current.visibility === "draft" || current.visibility === "private";
      const next =
        stillUnpublished && profile && current.author.handle !== profile.handle
          ? { ...current, author: profileToAuthor(profile) }
          : current;
      if (postFolderId) {
        await savePost(postFolderId, next);
      } else {
        await saveLocalDraft(next.id, next);
      }
      if (next !== current) setDoc(next);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  // Resolves the post's real Drive folder id, promoting a local-only draft
  // on first call. Stable across keystrokes (only `postFolderId` — which
  // flips exactly once — is a real dependency; the current doc is read via
  // `docRef` so typing doesn't churn this callback's identity, which would
  // otherwise invalidate `PostEditor`'s context on every change).
  const ensureDriveFolder = useCallback(async (): Promise<string> => {
    if (postFolderId) return postFolderId;
    if (pushInFlight.current) return pushInFlight.current;
    const current = docRef.current;
    if (!current) throw new Error("Nothing to save yet.");
    const task = (async () => {
      const { folderId, doc: saved } = await promoteLocalDraftToDrive({
        localId: current.id,
        doc: current,
        savedAt: new Date().toISOString(),
      });
      setPostFolderId(folderId);
      setDoc(saved);
      navigate(`/posts/edit/${folderId}`, { replace: true });
      return folderId;
    })();
    pushInFlight.current = task;
    try {
      return await task;
    } finally {
      pushInFlight.current = null;
    }
  }, [postFolderId, navigate]);

  async function handlePublishClick() {
    setPublishError(null);
    if (!postFolderId) {
      setSaveState("saving");
      try {
        await ensureDriveFolder();
        setSaveState("saved");
      } catch (e) {
        setSaveState("error");
        setPublishError(e instanceof Error ? e.message : "Couldn't save to Drive.");
        return;
      }
    }
    setPublishOpen(true);
  }

  function handleTitleChange(title: string) {
    setDoc((d) => (d ? { ...d, title } : d));
  }

  function handleBlocksChange(blocks: PostBlock[]) {
    setDoc((d) => (d ? { ...d, blocks } : d));
  }

  function handleDocPatch(patch: Partial<PostDoc>) {
    setDoc((d) => (d ? { ...d, ...patch } : d));
  }

  if (loading) {
    return <PageLoader label={isNew ? "Starting draft…" : "Loading…"} />;
  }

  if (error) {
    return (
      <div className="ny-post-editor-page" style={{ padding: 32 }}>
        <Text
          variant="body-default-s"
          style={{ color: "var(--danger-on-background-strong, #ff8a8a)" }}
        >
          {error}
        </Text>
      </div>
    );
  }

  if (!doc) return null;

  const publishLabel =
    doc.visibility === "draft" || doc.visibility === "private"
      ? "Publish"
      : "Update publish settings";

  return (
    <div className="ny-post-editor-page">
      <EditorWorkspace
        doc={doc}
        saveState={saveState}
        localOnly={!postFolderId}
        publishError={publishError}
        onTitleChange={handleTitleChange}
        onBlocksChange={handleBlocksChange}
        onDocPatch={handleDocPatch}
        ensureFolderId={ensureDriveFolder}
        onPublishClick={() => void handlePublishClick()}
        publishLabel={publishLabel}
        publishDisabled={saveState === "saving"}
        onBack={() => navigate("/posts")}
      />

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

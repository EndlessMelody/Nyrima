/**
 * PublicProfileSection — the publicly-synced half of profile personalization
 * (handle, bio, genres, pinned library/post, social links), pushed to the
 * Supabase `profiles` row so other signed-in users can see it on
 * `/u/:handle`. Deliberately separate from `ProfileSection` (nickname/
 * avatar/banner), which stays device-local personalization — see that
 * section's header comment for the split rationale.
 *
 * The handle saved here also mirrors into the local `ShareProfile`
 * (`useSharingStore.saveProfile`) — Posts (post-types.ts) and the rest of
 * the Drive-sharing layer stamp content with that local, device-scoped
 * identity, while `/u/:handle` and post discovery read this Supabase one.
 * They're two separate stores under the hood, but from here on out this is
 * the single place a user picks "their handle" — saving here keeps both in
 * lockstep instead of surfacing two disconnected pickers.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, X } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { useRecentStore } from "@app/stores/recent-store";
import { usePostsStore } from "@app/stores/posts-store";
import { useSharingStore } from "@app/stores/sharing-store";
import { SHARE_HANDLE_PATTERN } from "@shared/constants";
import {
  ensureSocialProfile,
  getMyProfile,
  updateMyProfile,
  type PinnedKind,
  type SocialLink,
} from "@app/services/social/social-api";
import type { SectionProps } from "../registry";

// Shared with the local (Drive-facing) share handle — see the module doc.
// Reusing the same pattern here keeps the two handle stores always in sync.
const HANDLE_PATTERN = SHARE_HANDLE_PATTERN;
const BIO_MAX = 280;
const GENRES_MAX = 12;

export function PublicProfileSection({ highlightSettingId: _ }: SectionProps) {
  const { status, account } = useAuth();
  const folders = useRecentStore((s) => s.folders);
  const loadFolders = useRecentStore((s) => s.load);
  const myPosts = usePostsStore((s) => s.myPosts);
  const loadMyPosts = usePostsStore((s) => s.loadMyPosts);
  const saveShareProfile = useSharingStore((s) => s.saveProfile);

  const [loading, setLoading] = useState(true);
  const [handle, setHandle] = useState("");
  const [bio, setBio] = useState("");
  const [genres, setGenres] = useState<string[]>([]);
  const [genreDraft, setGenreDraft] = useState("");
  const [links, setLinks] = useState<SocialLink[]>([]);
  const [pinnedKind, setPinnedKind] = useState<PinnedKind | "">("");
  const [pinnedRef, setPinnedRef] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadFolders();
    void loadMyPosts();
  }, [loadFolders, loadMyPosts]);

  useEffect(() => {
    if (status !== "authenticated") {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const profile = await getMyProfile();
        if (cancelled) return;
        if (profile) {
          setHandle(profile.handle ?? "");
          setBio(profile.bio ?? "");
          setGenres(profile.genres);
          setLinks(profile.socialLinks);
          setPinnedKind(profile.pinnedKind ?? "");
          setPinnedRef(profile.pinnedRef ?? "");
        }
      } catch {
        // First-time users have no row yet — the form just starts empty.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  const handleError = useMemo(() => {
    if (!handle) return null;
    return HANDLE_PATTERN.test(handle)
      ? null
      : "Lower-case letters, digits, dash, underscore. 3–32 characters.";
  }, [handle]);

  const pinnedOptions = useMemo(
    () => ({
      library: folders.map((f) => ({ ref: f.id, label: f.name })),
      post: myPosts.map((p) => ({ ref: p.folderId, label: p.doc.title || "Untitled post" })),
    }),
    [folders, myPosts],
  );

  function addGenre() {
    const g = genreDraft.trim();
    if (!g || genres.length >= GENRES_MAX || genres.includes(g)) {
      setGenreDraft("");
      return;
    }
    setGenres([...genres, g]);
    setGenreDraft("");
  }

  function addLink() {
    setLinks([...links, { label: "", url: "" }]);
  }

  function updateLink(index: number, patch: Partial<SocialLink>) {
    setLinks(links.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function removeLink(index: number) {
    setLinks(links.filter((_, i) => i !== index));
  }

  async function handleSave() {
    if (handleError) return;
    setSaving(true);
    setError(null);
    try {
      const trimmedHandle = handle.trim() || undefined;
      await ensureSocialProfile({ handle: trimmedHandle });
      const pinnedLabel = pinnedKind
        ? (pinnedOptions[pinnedKind].find((o) => o.ref === pinnedRef)?.label ?? null)
        : null;
      await updateMyProfile({
        bio: bio.trim() || null,
        genres,
        socialLinks: links.filter((l) => l.label.trim() && l.url.trim()),
        pinnedKind: pinnedKind || null,
        pinnedRef: pinnedKind ? pinnedRef || null : null,
        pinnedLabel: pinnedKind ? pinnedLabel : null,
      });
      // Mirror into the local ShareProfile so Posts/Drive-sharing (which
      // stamp content with the local, device-scoped identity) always match
      // the handle set here — see the module doc.
      if (trimmedHandle) {
        await saveShareProfile({
          handle: trimmedHandle,
          name: account?.displayName,
          avatarUrl: account?.avatarUrl,
        });
      }
      setSavedTick(true);
      window.setTimeout(() => setSavedTick(false), 1600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your public profile.");
    } finally {
      setSaving(false);
    }
  }

  if (status !== "authenticated") {
    return (
      <div className="ny-ac__section-body">
        <p className="ny-ac__row-sub">
          Sign in with a Nyrima account to set up a public profile dashboard.
        </p>
      </div>
    );
  }

  if (loading) {
    return <div className="ny-ac__section-body">Loading…</div>;
  }

  return (
    <div className="ny-ac__section-body">
      {handle && !handleError && (
        <div className="ny-ac__card">
          <div className="ny-ac__row">
            <div>
              <div className="ny-ac__row-label">Your dashboard</div>
              <div className="ny-ac__row-sub">Anyone signed into Nyrima can view this.</div>
            </div>
            <Link className="ny-btn ny-btn--ghost" to={`/u/${handle}`}>
              View /u/{handle}
            </Link>
          </div>
        </div>
      )}

      <div className="ny-ac__card" data-setting-id="public-profile-handle">
        <div className="ny-ac__row ny-ac__row--stack">
          <div>
            <div className="ny-ac__row-label">Handle</div>
            <div className="ny-ac__row-sub">
              Your dashboard link: /u/&lt;handle&gt;. Required for others to find you.
            </div>
          </div>
          <input
            type="text"
            className="ny-ac__input"
            value={handle}
            maxLength={32}
            placeholder={account?.displayName ? account.displayName.toLowerCase() : "e.g. khoa"}
            onChange={(e) => setHandle(e.target.value.toLowerCase())}
          />
          {handleError && <p className="ny-ac__error">{handleError}</p>}
        </div>
      </div>

      <div className="ny-ac__card" data-setting-id="public-profile-bio">
        <div className="ny-ac__row ny-ac__row--stack">
          <div>
            <div className="ny-ac__row-label">Bio</div>
            <div className="ny-ac__row-sub">A short caption shown under your name.</div>
          </div>
          <textarea
            className="ny-ac__input"
            value={bio}
            maxLength={BIO_MAX}
            rows={3}
            onChange={(e) => setBio(e.target.value)}
          />
          <span className="ny-ac__row-sub">
            {bio.length}/{BIO_MAX}
          </span>
        </div>
      </div>

      <div className="ny-ac__card" data-setting-id="public-profile-genres">
        <div className="ny-ac__row ny-ac__row--stack">
          <div>
            <div className="ny-ac__row-label">Favorite genres</div>
            <div className="ny-ac__row-sub">Up to {GENRES_MAX} tags shown as chips.</div>
          </div>
          <div className="ny-ac__inline-form">
            <input
              type="text"
              className="ny-ac__input"
              value={genreDraft}
              placeholder="e.g. isekai"
              onChange={(e) => setGenreDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addGenre();
                }
              }}
            />
            <button
              type="button"
              className="ny-btn ny-btn--ghost"
              onClick={addGenre}
              disabled={genres.length >= GENRES_MAX}
            >
              <Plus aria-hidden="true" /> Add
            </button>
          </div>
          {genres.length > 0 && (
            <div className="ny-ac__actions-row">
              {genres.map((g) => (
                <button
                  type="button"
                  key={g}
                  className="ny-btn ny-btn--ghost"
                  onClick={() => setGenres(genres.filter((x) => x !== g))}
                >
                  {g} <X aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="ny-ac__card" data-setting-id="public-profile-pinned">
        <div className="ny-ac__row ny-ac__row--stack">
          <div>
            <div className="ny-ac__row-label">Pinned item</div>
            <div className="ny-ac__row-sub">Feature a library or post at the top of your profile.</div>
          </div>
          <div className="ny-ac__inline-form">
            <select
              className="ny-ac__input"
              value={pinnedKind}
              onChange={(e) => {
                setPinnedKind(e.target.value as PinnedKind | "");
                setPinnedRef("");
              }}
            >
              <option value="">None</option>
              <option value="library">Library</option>
              <option value="post">Post</option>
            </select>
            {pinnedKind && (
              <select
                className="ny-ac__input"
                value={pinnedRef}
                onChange={(e) => setPinnedRef(e.target.value)}
              >
                <option value="">Choose…</option>
                {pinnedOptions[pinnedKind].map((o) => (
                  <option key={o.ref} value={o.ref}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      <div className="ny-ac__card" data-setting-id="public-profile-links">
        <div className="ny-ac__row ny-ac__row--stack">
          <div>
            <div className="ny-ac__row-label">Social links</div>
            <div className="ny-ac__row-sub">e.g. MAL, AniList, your site.</div>
          </div>
          {links.map((link, i) => (
            <div className="ny-ac__inline-form" key={i}>
              <input
                type="text"
                className="ny-ac__input"
                placeholder="Label"
                value={link.label}
                onChange={(e) => updateLink(i, { label: e.target.value })}
              />
              <input
                type="text"
                className="ny-ac__input"
                placeholder="https://…"
                value={link.url}
                onChange={(e) => updateLink(i, { url: e.target.value })}
              />
              <button type="button" className="ny-btn ny-btn--ghost" onClick={() => removeLink(i)}>
                <X aria-hidden="true" />
              </button>
            </div>
          ))}
          <button type="button" className="ny-btn ny-btn--ghost" onClick={addLink}>
            <Plus aria-hidden="true" /> Add link
          </button>
        </div>
      </div>

      {error && (
        <p className="ny-ac__error" role="status">
          {error}
        </p>
      )}

      <button
        type="button"
        className="ny-btn ny-btn--primary"
        disabled={saving || Boolean(handleError)}
        onClick={() => void handleSave()}
      >
        {saving ? "Saving…" : savedTick ? "Saved ✓" : "Save"}
      </button>
    </div>
  );
}

/**
 * Zustand store for the Phase 4 sharing layer.
 *
 * What lives here:
 *   - `profile`     — the user's own ShareProfile (handle + display + avatar).
 *                     Hydrated from chrome.storage on first read.
 *   - `folders`     — cached Drive id for the flat `Shared/` folder.
 *                     Resolved (and created) lazily via `ensureFolders()`.
 *   - `isPublic`    — last-known "Anyone with the link" state of `Shared/`.
 *                     Cached in chrome.storage so the composer can render
 *                     status without burning a Drive request per open.
 *   - `submitting`  — true while a share is being written.
 *   - `lastError`   — last failure surfaced by `submitShare()` so the
 *                     composer can render an inline error pill.
 *
 * Why a store and not refs scattered across components:
 *   - The handle picker, share composer, and the Phase 4.2 Inbox/Friends
 *     surfaces all need to read the same profile + folder state.
 *   - Bootstrap (`ensureFolders`) is expensive on a fresh install — caching
 *     in one place avoids racing identical bootstrap calls from two dialogs.
 *
 * The submitShare flow inlines a fresh ShareEntry into the index (schema
 * v=2) and optionally publishes the Shared/ folder in the same transaction.
 */

import { create } from "zustand";
import type {
  ShareAuthor,
  ShareEntry,
  ShareIndex,
  ShareProfile,
  ShareTarget,
} from "@shared/types";
import {
  ensureShareFolders,
  generateShareId,
  getShareProfile,
  mutateShareIndex,
  prependIndexEntry,
  profileToAuthor,
  setShareProfile,
  type ShareFolderIds,
} from "../services/sharing";
import {
  isSharedFolderPublic,
  publishSharedFolder,
} from "../services/sharing/share-permissions";

export interface SubmitSharePayload {
  target: ShareTarget;
  caption?: string;
  title?: string;
  posterUrl?: string;
  /** When true, flips the user's Shared/ folder to "Anyone with the link"
   *  as part of the same atomic submit. The composer surfaces this as a
   *  checkbox the first time the user shares. */
  publishFolder?: boolean;
}

export interface SubmitShareResult {
  entry: ShareEntry;
  /** Drive folder id of the user's Shared/ folder — useful for the
   *  composer's "view on Drive" success-state link. */
  sharedFolderId: string;
}

interface SharingState {
  profile: ShareProfile | null;
  /** Set true after the first hydrate so consumers can tell "not loaded
   *  yet" from "loaded, no profile". */
  profileLoaded: boolean;
  folders: ShareFolderIds | null;
  isPublic: boolean | null;
  submitting: boolean;
  lastError: string | null;

  /** Hydrate the profile from chrome.storage. Cheap; safe to call multiple
   *  times — the second call is a no-op once `profileLoaded` is true. */
  loadProfile: () => Promise<void>;
  /** Persist a fresh profile (handle picker flow). */
  saveProfile: (
    patch: Omit<ShareProfile, "v" | "updatedAt">,
  ) => Promise<ShareProfile>;

  /** Resolve (and create on first call) the Shared/ folder tree. */
  ensureFolders: () => Promise<ShareFolderIds>;

  /** Probe Drive (or read cache) for the Shared/ folder's public state. */
  refreshPublicState: (opts?: { force?: boolean }) => Promise<boolean | null>;

  /** End-to-end share submit. Walks the steps:
   *  1. ensureFolders()
   *  2. readShareIndex() (or seed an empty one)
   *  3. prependIndexEntry + writeShareIndex() (entry inlined into manifest)
   *  4. publishSharedFolder() when payload.publishFolder is true
   *
   *  Throws DriveAccessError on permission failures so the composer can
   *  show "Reconnect Drive" (the existing UI). */
  submitShare: (payload: SubmitSharePayload) => Promise<SubmitShareResult>;

  /** Clear the last-error so the composer can dismiss its pill. */
  clearError: () => void;
}

export const useSharingStore = create<SharingState>((set, get) => ({
  profile: null,
  profileLoaded: false,
  folders: null,
  isPublic: null,
  submitting: false,
  lastError: null,

  loadProfile: async () => {
    if (get().profileLoaded) return;
    const profile = await getShareProfile();
    set({ profile, profileLoaded: true });
  },

  saveProfile: async (patch) => {
    const next = await setShareProfile(patch);
    set({ profile: next, profileLoaded: true });
    return next;
  },

  ensureFolders: async () => {
    const existing = get().folders;
    if (existing) return existing;
    const folders = await ensureShareFolders();
    set({ folders });
    return folders;
  },

  refreshPublicState: async (opts) => {
    const folders = await get().ensureFolders().catch(() => null);
    if (!folders) {
      set({ isPublic: null });
      return null;
    }
    try {
      const isPublic = await isSharedFolderPublic(folders.root, {
        forceRefresh: opts?.force,
      });
      set({ isPublic });
      return isPublic;
    } catch {
      // Permission probe failing isn't fatal — caller can still attempt to
      // publish; Drive will return the canonical answer on the actual call.
      set({ isPublic: null });
      return null;
    }
  },

  submitShare: async (payload) => {
    const profile = get().profile;
    if (!profile) {
      throw new Error(
        "Pick a share handle in the User Center before sharing.",
      );
    }
    set({ submitting: true, lastError: null });
    try {
      const folders = await get().ensureFolders();
      const author: ShareAuthor = profileToAuthor(profile);
      const now = new Date().toISOString();
      const entry: ShareEntry = {
        id: generateShareId(),
        v: 2,
        sharedAt: now,
        updatedAt: now,
        target: payload.target,
        caption: payload.caption,
        title: payload.title,
        posterUrl: payload.posterUrl,
      };

      await mutateShareIndex(folders.root, (existing) => {
        // Read the existing index, or seed a fresh empty one. New users (and
        // anyone migrating off a legacy v=1 manifest) get `null` here.
        const seed: ShareIndex = existing ?? {
          v: 2,
          owner: author,
          updatedAt: now,
          entries: [],
        };
        // Always refresh the owner snapshot on write — the user may have
        // updated their display name / avatar between shares.
        return prependIndexEntry({ ...seed, owner: author }, entry);
      });

      // Optional: flip the folder public as part of the same submit. We do
      // this AFTER the index write so a permission failure doesn't leave a
      // published-but-empty Shared/ folder.
      if (payload.publishFolder) {
        await publishSharedFolder(folders.root);
        set({ isPublic: true });
      }

      return { entry, sharedFolderId: folders.root };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to share.";
      set({ lastError: msg });
      throw e;
    } finally {
      set({ submitting: false });
    }
  },

  clearError: () => set({ lastError: null }),
}));

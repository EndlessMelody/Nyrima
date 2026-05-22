# Sharing Guide

Nyrima sharing is optional and Drive-native. It is not a centralized social
server and it is not a permission bypass for private media.

## The Model

When the user creates a share, Nyrima can create app-owned files under the
paired Drive root:

```text
Shared/
  index.json
  comments.jsonl
```

- `index.json` is the public share manifest when the user publishes the
  `Shared/` folder. It contains share entries, author/profile snapshots, titles,
  captions, Drive target references, and related metadata.
- `comments.jsonl` is the outbound comment stream written by that user.

The user chooses whether the `Shared/` folder is changed to "Anyone with the
link" reader access. Until the user opts in, another person cannot follow that
folder through public Drive access.

## What A Share Does And Does Not Do

A share entry advertises a Drive target. It does not automatically grant Drive
access to the target video or library.

| Action | Controlled by |
| --- | --- |
| Read a published `Shared/index.json` | Permission on the `Shared/` folder |
| Open the target video or folder | Permission on that Drive target |
| Import a target into the recipient Drive | Source read/copy permission and recipient write permission |
| See comments targeting an owner's share | Which comment streams the owner can read and scan |

If a target remains private, the follower still needs Google Drive access to
open or import it.

## Publish A Share Surface

1. Connect Drive with OAuth.
2. Pair the Drive root.
3. Share a video or library from Nyrima.
4. Choose the sharing profile/handle when prompted.
5. Read the publish prompt carefully before making `Shared/` link-readable.
6. Share the `Shared/` folder URL only with people who should read that
   metadata surface.

Making the `Shared/` folder public exposes the metadata files in that folder to
people with the folder link. Keep captions, handles, profile fields, and
comments appropriate for that visibility.

## Follow Another User

1. Get the person's published Drive `Shared/` folder URL.
2. Open the Social/People surface in Nyrima.
3. Paste the folder URL and follow it.
4. Sync the Inbox.

Nyrima reads the remote `index.json`, caches last-good inbox rows locally, and
shows the latest entries it can read. A failed sync should not be read as the
owner deleting all shares; Drive access or network state may be the reason.

## Comments

Comments are decentralized:

1. User B comments on a share by appending a record to User B's own
   `comments.jsonl`.
2. User A, the share owner, reconstructs received comments by reading comment
   streams from followed users and filtering records targeting User A's
   `Shared/` folder and share ID.

That means a share owner may need to follow the commenter before that comment
appears in the owner's received activity view.

## Import

Import asks Google Drive to copy accessible shared content into the recipient's
Drive:

```text
Nyrima/
  Imports/
    <share title - timestamp>/
      copied files...
```

For a video share, the current flow can copy the video plus obvious companions
such as a same-folder poster and matching subtitle files. For a library share,
the current flow can walk and copy a folder tree.

Import still respects Drive rules:

- The recipient must be allowed to read/copy the source.
- The recipient must be able to write into the app-created import destination.
- Source-owner copy/download restrictions can block the operation.
- Partial library copy failures may be reported instead of silently changing
  access semantics.

## Make Sharing More Private Again

Use the Social privacy controls to make the app-created `Shared/` folder
private again when the public metadata surface is no longer wanted.

Also consider:

- Unshare entries that should disappear from future manifest syncs.
- Review Drive permissions on target files and folders separately.
- Remember that other users may retain local inbox caches or copies they
  already imported before an unshare.

## A Manual Sharing Check

For a quick same-profile check of the current flow:

1. Build and load the unpacked extension.
2. Connect Drive with OAuth and pair a root.
3. Share one accessible video and publish the `Shared/` folder.
4. Copy that folder URL from the social privacy/share surface.
5. Follow the same `Shared/` URL from the People surface.
6. Sync Inbox and confirm the share row appears.
7. Import the row and confirm a folder appears under `Nyrima/Imports/`.
8. Post a comment and inspect Activity after a refresh.

For a closer real-user check, repeat follow/comment/import with a second Chrome
profile and a second Google account.

## Related Docs

- Data visibility and permissions:
  [`permissions-and-data-use.md`](./permissions-and-data-use.md)
- Privacy policy:
  [`privacy-policy.md`](./privacy-policy.md)
- Sharing error diagnosis:
  [`troubleshooting.md`](./troubleshooting.md)


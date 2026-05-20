# Sharing Smoke Test

Use this when you want to prove the Drive-only sharing loop works outside the
unit tests.

## Fast loopback test

This uses one browser profile and follows your own `Shared/` folder. It proves
the manifest, public permission, inbox pull, comment write, and activity
aggregation paths without needing a second Google account.

1. Run `npm run build`.
2. Load `dist/` as an unpacked extension in Chrome.
3. Open Nyrima, connect Drive with an OAuth client that has `drive.readonly`,
   `drive.file`, `userinfo.email`, and `userinfo.profile`.
4. Pair a Nyrima root folder and open any library or video.
5. Click **Share**, pick a handle if prompted, keep **Make my Shared/ folder
   public** enabled, and submit.
6. Copy the `Shared/` folder URL from the success state or from
   `/social/privacy`.
7. Go to `/social/people`, paste that same URL, and follow it.
8. Click **Sync**. The share should appear in Inbox and in your followed shelf.
9. Click **Import** on the inbox row. A new folder should appear under
   `Nyrima/Imports/<share title - timestamp>/` in your own Drive. For video
   shares, the video is copied plus obvious companions from the same folder
   (`Poster.*` and subtitles with the same base name). For library shares,
   the folder tree is copied recursively.
10. Click **Comment** on the inbox row, post a short message, then open
   `/social/activity` and refresh. The comment should appear in both Sent and
   Received.

The Open/Copy actions point at the shared Drive target. They do not grant video
or library access by themselves; the recipient still needs Drive permission for
that target if it is private.

The Import action also respects Drive permissions. It uses Drive's server-side
copy endpoint, so the browser does not download and re-upload video bytes, but
the source owner can still block copying/downloads.

## Two-account test

This is closer to real use.

1. Complete steps 1-6 above as Account A.
2. In a second Chrome profile, load the same unpacked extension and connect
   Account B.
3. Account B follows Account A's `Shared/` folder URL and syncs.
4. Account B comments on Account A's share.
5. Account B opens Privacy and makes their own `Shared/` folder public.
6. For Account A to see that comment, Account A must also follow Account B's
   public `Shared/` folder. Activity only scans people the owner follows.
7. Account A opens `/social/activity` and refreshes. The received comment
   should be grouped under the original share.

## Expected Drive layout

Inside the user's Nyrima root:

```text
Imports/
  <share title - timestamp>/
    copied files...
Shared/
  index.json
  comments.jsonl
```

There should be no required `entries/` or `comments/` subfolders in the current
schema.

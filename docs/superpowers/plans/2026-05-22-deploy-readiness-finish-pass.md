# Deploy Readiness Finish Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the current AC-3/remux worktree as a clean deploy candidate with seek recovery and public share-index blockers closed.

**Architecture:** Keep the existing MSE seek-recovery design and gate its stream restart on proven video buffering. Treat `readShareIndex()` as the validation boundary for public social manifests so downstream Zustand stores consume only shaped data.

**Tech Stack:** TypeScript, React Chrome Extension MV3, Vitest, Vite, Google Drive REST APIs.

---

## File Structure

- `src/app/services/mkv-remux/mse-controller.ts`: gate normal stream restart after media seek recovery.
- `src/app/services/mkv-remux/mse-controller.test.ts`: controller regression tests for restart gating.
- `src/app/services/sharing/index-store.ts`: sanitize public `Shared/index.json` manifests.
- `src/app/services/sharing/index-store.test.ts`: sanitizer regression tests around malformed manifests.
- `docs/superpowers/specs/2026-05-22-deploy-readiness-finish-pass-design.md`: approved release-prep design.

### Task 1: Gate AC-3 media seek stream restart

**Files:**
- Modify: `src/app/services/mkv-remux/mse-controller.test.ts`
- Modify: `src/app/services/mkv-remux/mse-controller.ts`

- [ ] **Step 1: Write the failing recovery test**

Add a controller-level regression harness that calls the media seek recovery
method with stubbed range fetch/process/wait methods and asserts:

```ts
expect(restart).not.toHaveBeenCalled();
```

when `waitForVideoBufferedAt()` resolves `false`.

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
npx vitest run src/app/services/mkv-remux/mse-controller.test.ts
```

Expected: FAIL because failed recovery still requests a stream restart.

- [ ] **Step 3: Implement the minimal restart gate**

Change the recovery branch so:

```ts
if (!ready) {
  console.warn(...);
  return;
}
this.requestStreamRestart(endOffset);
```

- [ ] **Step 4: Verify the controller tests pass**

Run:

```powershell
npx vitest run src/app/services/mkv-remux/mse-controller.test.ts
```

Expected: PASS.

### Task 2: Sanitize public share indexes

**Files:**
- Modify: `src/app/services/sharing/index-store.test.ts`
- Modify: `src/app/services/sharing/index-store.ts`

- [ ] **Step 1: Write sanitizer tests first**

Add pure tests for a new sanitizer boundary that keep a valid manifest and drop
or reject malformed public content:

```ts
expect(sanitizeShareIndex({ v: 2, entries: "bad" })).toBeNull();
expect(
  sanitizeShareIndex({
    v: 2,
    owner: { handle: "alice" },
    updatedAt: "2026-05-20T04:00:00.000Z",
    entries: [
      {
        id: "bad-target",
        v: 2,
        sharedAt: "2026-05-20T04:01:00.000Z",
        updatedAt: "2026-05-20T04:01:00.000Z",
        target: { kind: "video", fileId: "short" },
      },
    ],
  })?.entries,
).toEqual([]);
```

- [ ] **Step 2: Run focused share-index tests to verify red**

Run:

```powershell
npx vitest run src/app/services/sharing/index-store.test.ts
```

Expected: FAIL because `sanitizeShareIndex` does not exist.

- [ ] **Step 3: Implement minimal manifest sanitization**

Validate the manifest owner, entry version, ISO timestamp fields, target kind,
Drive IDs, capped plain text, and HTTPS Drive/Google-hosted optional image URLs.
Have `readShareIndex()` return the sanitized result instead of casting raw JSON.

- [ ] **Step 4: Verify focused share-index tests pass**

Run:

```powershell
npx vitest run src/app/services/sharing/index-store.test.ts
```

Expected: PASS.

### Task 3: Verify and package deploy candidate

**Files:**
- Inspect: `package.json`
- Inspect: worktree via `git status --short`

- [ ] **Step 1: Run full verification**

Run:

```powershell
npm test
npm run build
npm audit --omit=dev
git diff --check
```

Expected: tests, build, and audit succeed; diff check has no whitespace errors.

- [ ] **Step 2: Run extension packaging**

Run:

```powershell
npm run zip
```

Expected: packaging script completes and emits the release archive path.

- [ ] **Step 3: Review final diff and commit intentionally**

Run:

```powershell
git status --short
git diff --stat
git add docs src package.json package-lock.json public/icons
git commit -m "feat: finish ac3 playback deploy candidate"
git status --short
```

Expected: commit succeeds and final status is clean.

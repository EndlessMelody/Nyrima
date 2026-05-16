# Nyrima — Living Plan

The day-to-day plan lives in [`../PHASES.md`](../PHASES.md), which is the
single source of truth for what's shipped, what's in progress, and what's
been deferred to the backlog. This file is the conceptual sketch — the
shape of the roadmap and the *why* behind each phase.

If you're trying to find out what's actively being worked on, open
PHASES.md. If you're trying to understand why a phase exists, stay here.

## Phase 1 — MVP · **shipped**

Goal: a working extension that opens a Drive folder and plays its videos
with synced subtitles. No remote dependencies beyond Drive.

The MVP landed the Nyrima root folder model, the lobby + library + player
surfaces, the API-key streaming path, and the resume/MRU storage layer.

## Phase 2 — Real player · **shipped**

Goal: an actual cinema, not a demo. MKV becomes a first-class citizen,
ASS/SSA typesetting renders the way Aegisub intended, and the chrome reads
as a piece of media software rather than a `<video>` reskin.

What landed: EBML header probe, native-first MKV with MSE-remux fallback,
range-fetched MSE streaming, embedded MKV subtitle extraction, the custom
Neon Cinema HUD, JASSUB handoff for both external and embedded ASS, smart
resume pill, pre-roll Now-Playing card, ambient backdrop glow, Next-up
autoplay card, theatre-mode toggle, `?` shortcuts overlay.

What stayed deferred: audio-track selector (needs demuxer changes + MSE
re-init), SeekHead-following header sniff, PGS subtitles, timeline
chapter markers, the unified Tracks panel that should ride with audio
work.

## Phase 3 — Library polish · **shipped**

Goal: the lobby and library pages feel like a real collection, not a file
manager. Posters, episode grouping, sortable / searchable libraries.

What landed: in-library search + watch-state filters, persisted sort + view
mode, season / episode grouping, MAL/Jikan integration with folder-aware
queries, browser-native virtualisation (`content-visibility: auto`),
library-card upgrades (cover backdrop, episode count, total runtime,
watched-ratio pill), lobby stats strip.

Deferred: multi-folder libraries (P3.6) — needs a data-model rewrite.

## Phase 4 — Sharing layer ("P2P on Drive") · *not started*

Goal: turn the personal cinema into a small social surface without
introducing a backend. Share entries live as JSON inside the sharer's
Drive; a central bootstrap index lets people discover each other.

Open shape:

- Schema for share entries (`Shared/<id>.json` in the sharer's Drive).
- A small public bootstrap folder we maintain that holds `index.json`.
- Per-user follow + pull (no server polling — pull-on-open).
- Comments as JSONL appends so writes don't conflict.
- A "Share this video" UX → produces a viewable Drive link + share entry.

Risk: this is the first phase that touches *other people's* data. OAuth
scope and consent flows need a careful pass.

## Phase 5 — Realtime + privacy · *not started*

Goal: ambient social and serious privacy. Watch parties via WebRTC
datachannels (signaling through Drive). AES-GCM-encrypted libraries for
private groups. PWA offline cache for recently watched chunks.

Risk: WebRTC inside an extension page is workable but has subtle MV3
limitations; budget time for service-worker reliability if signaling lives
in the background.

## Cross-cutting backlog

Lives in PHASES.md under the *Cross-cutting backlog* heading (F.1 through
F.12 at the time of writing). Anything that doesn't gate a phase but is
worth doing eventually.

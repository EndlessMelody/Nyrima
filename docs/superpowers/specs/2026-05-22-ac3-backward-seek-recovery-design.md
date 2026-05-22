# AC-3 Backward Seek Recovery Design

Date: 2026-05-22

## Problem

Nyrima's external AC-3 playback path can continue after a forward seek, but a
backward skip can leave playback stalled. In the reproduced failure:

- the video element stops loading the backward target;
- external AC-3 audio disappears after its seek reset;
- subtitles for the target area can still appear;
- the console reports that media seek catch-up appended data but the backward
  target is still not video-buffered before the controller restarts streaming.

The subtitle path can keep parsing fetched MKV bytes without proving that the
video element has a playable MSE window. The seek fix must therefore restore
video playback first and refill external AC-3 audio against that recovered
playhead.

## Scope

This work covers backward-seek recovery for MKV playback when selected audio is
rendered externally, especially the AC-3 WASM path.

It does not address unrelated Drive thumbnail `403` responses or Drive API
`401` responses unless investigation shows one directly blocks the media range
fetch used by seek recovery.

## Approaches Considered

### 1. Repair seek recovery in the MSE controller

Use the existing cluster index and keyframe knowledge to recover a playable
media window at an out-of-buffer backward target, then resume normal streaming
from that recovered window.

Tradeoff: the controller must coordinate random-access video append state,
external audio refill, and stale seek cancellation carefully.

### 2. Restart playback for AC-3 backward seeks

Treat a backward seek as a player restart at the new timestamp.

Tradeoff: simpler recovery logic, but skip-back would feel like a reload and
would add player startup churn to a common control.

### 3. Build a richer random-access seek index first

Expand indexing so all seeks can choose exact byte and keyframe windows before
performing recovery.

Tradeoff: valuable longer term, but wider than the reported regression and not
required to make the existing indexed recovery path behave correctly.

## Recommended Design

Implement approach 1.

The MSE controller already distinguishes two external-audio seek cases:

1. If video is buffered at the target, reset/refill external audio near the new
   playhead.
2. If video is not buffered at the target, perform media seek catch-up.

The media seek catch-up path should be the authoritative recovery path for the
reported backward skip stall. It should:

- cancel any older seek or audio catch-up operation;
- prevent queued forward video appends from winning over the backward target;
- choose the nearest indexed video keyframe cluster at or before the target
  lookback window;
- range-fetch enough MKV bytes from that cluster to cover the target and a
  bounded amount of playable lead;
- append random-access video samples for the recovered media window and feed
  external audio samples from the same seek area;
- verify that the target time is actually video-buffered before declaring the
  recovery successful and restarting normal forward streaming.

If recovery data was appended but the target is still not video-buffered, the
controller should not treat that append as a completed seek recovery. It should
leave diagnostics that identify the failed recovery window and use a controlled
follow-up recovery path instead of letting the player sit on an unusable
playhead indefinitely.

## Data Flow

1. `DrivePlayer` changes `video.currentTime` for skip-back.
2. `ExternalMkvAudioRenderer` receives the seek discontinuity, clears scheduled
   Web Audio work, and resets its AC-3 decoder state.
3. `MkvMseController` debounces the settled seek target.
4. For an already-buffered target, the controller backfills external audio only.
5. For an unbuffered target, the controller:
   - resolves target PTS to an indexed keyframe-backed cluster window;
   - fetches that media byte range from Drive;
   - demuxes and appends a random-access video segment;
   - feeds target-window audio samples to the external renderer;
   - waits until video buffering covers the actual target;
   - restarts normal byte streaming from the recovered byte window when ready.

## Error Handling

- A newer seek supersedes older catch-up fetches and append work.
- Abort errors from superseded recovery are quiet.
- A missing cluster index or missing recovery byte window exits without
  corrupting the main stream cursor.
- A fetched window that still does not cover the target remains visible through
  seek diagnostics and is treated as an incomplete recovery.
- AC-3 decoder reset remains tied to media discontinuities so stale PCM does
  not play after the backward target changes.

## Tests

Add focused regression coverage around the seek controller behavior:

- backward media seek recovery selects a keyframe-backed cluster window when
  the target is not already buffered;
- stale catch-up work is aborted when a newer seek starts;
- video append backlog is cleared or deprioritized before backward recovery
  appends;
- recovery does not report success when the target time remains outside video
  buffered ranges;
- external-audio seek recovery keeps the already-buffered target on the
  audio-only refill path.

Use the smallest unit tests possible around controller helpers and state
transitions, then verify the existing remux test suite and TypeScript build.

## Success Criteria

- Skip-back on an externally rendered AC-3 track resumes video near the chosen
  backward target instead of stalling permanently.
- AC-3 audio refills after the recovered video playhead becomes usable.
- Subtitle extraction no longer masks a broken media seek by being the only
  visible part of the target area that advances.
- The forward seek and in-buffer seek paths keep their existing behavior.

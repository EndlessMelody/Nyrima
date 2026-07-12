/**
 * Output-device selection for the music player.
 *
 * Wraps `HTMLMediaElement.setSinkId()` (typed, broadly available in Chromium)
 * and the newer `AudioContext.setSinkId()` (Chrome 110+, not yet in TS's
 * lib.dom) behind one call. Which one matters depends on whether the EQ's
 * `MediaElementAudioSourceNode` has captured the `<audio>` element yet (see
 * audio-graph.ts) — once captured, the element's own sink is moot and only
 * the AudioContext's sink controls where sound goes. Everything here no-ops
 * on browsers that don't support the Audio Output Devices API.
 */

export interface AudioOutputDevice {
  deviceId: string;
  label: string;
}

interface SinkSettable {
  setSinkId(sinkId: string): Promise<void>;
}

function asSinkSettable(target: unknown): SinkSettable | null {
  return target && typeof (target as Partial<SinkSettable>).setSinkId === "function"
    ? (target as SinkSettable)
    : null;
}

export function isOutputDeviceApiSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.enumerateDevices &&
    typeof HTMLMediaElement !== "undefined" &&
    typeof HTMLMediaElement.prototype.setSinkId === "function"
  );
}

/** True when the browser offers a native "choose output device" picker dialog. */
export function isOutputDevicePickerSupported(): boolean {
  if (typeof navigator === "undefined" || !navigator.mediaDevices) return false;
  return (
    typeof (navigator.mediaDevices as unknown as { selectAudioOutput?: unknown })
      .selectAudioOutput === "function"
  );
}

/**
 * Lists `audiooutput` devices. Labels are empty until the page holds
 * mic/output permission, so unlabeled entries get a generic fallback name.
 */
export async function listAudioOutputDevices(): Promise<AudioOutputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "audiooutput")
    .map((d, i) => ({
      deviceId: d.deviceId,
      label:
        d.label || (d.deviceId === "default" ? "System default" : `Output device ${i + 1}`),
    }));
}

/**
 * Opens the browser's native output-device picker. Resolves `null` if
 * unsupported or the user cancels.
 */
export async function pickAudioOutputDevice(): Promise<AudioOutputDevice | null> {
  if (!isOutputDevicePickerSupported()) return null;
  const md = navigator.mediaDevices as unknown as {
    selectAudioOutput: () => Promise<MediaDeviceInfo>;
  };
  try {
    const device = await md.selectAudioOutput();
    return { deviceId: device.deviceId, label: device.label || "Selected device" };
  } catch {
    return null; // user cancelled the picker
  }
}

/**
 * Routes every sink-capable target (the `<audio>` element and/or the EQ's
 * AudioContext) to `deviceId`. Returns true if at least one accepted it.
 */
export async function applyAudioOutputDevice(
  deviceId: string,
  targets: Array<HTMLMediaElement | AudioContext | null | undefined>,
): Promise<boolean> {
  let applied = false;
  for (const target of targets) {
    const sink = asSinkSettable(target);
    if (!sink) continue;
    try {
      await sink.setSinkId(deviceId);
      applied = true;
    } catch (err) {
      console.warn("[nyrima:audio] setSinkId failed", err);
    }
  }
  return applied;
}

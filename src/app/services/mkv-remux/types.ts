/**
 * Types shared across the MKV→fMP4 remux pipeline.
 */

export interface VideoTrackInfo {
  trackNumber: number;
  codec: 'avc' | 'hevc';
  codecPrivate: Uint8Array; // AVCDecoderConfigurationRecord or HEVCDecoderConfigurationRecord
  width: number;
  height: number;
  defaultDurationNs: number;
}

export interface AudioTrackInfo {
  trackNumber: number;
  codec: 'aac' | 'flac' | 'opus' | 'ac3';
  /**
   * For AAC: the AudioSpecificConfig bytes. For FLAC: the STREAMINFO metadata
   * block(s). For Opus: the OpusHead packet (with or without "OpusHead"
   * magic). For AC-3: empty (MKV A_AC3 doesn't carry codec-private data;
   * the `dac3` config is derived from `sampleRate` + `channels` instead, so
   * the field can safely be a zero-length array).
   */
  codecPrivate: Uint8Array;
  sampleRate: number;
  channels: number;
  defaultDurationNs: number;
  /** ISO 639-2/B (or whatever the muxer wrote) — `"und"` when missing. */
  language: string;
  /** Free-form name from the MKV `Name` element — `"Japanese 5.1"`, etc. */
  name: string;
}

export interface DemuxedSample {
  trackNumber: number;
  isVideo: boolean;
  /** Presentation timestamp in milliseconds. */
  pts: number;
  /** Duration in milliseconds (0 = unknown, filled in later). */
  duration: number;
  data: Uint8Array;
  isKeyframe: boolean;
}

/** Parsed MKV header information needed to initialise the fMP4 pipeline. */
export interface MkvMediaInfo {
  timecodeScaleNs: number;
  durationMs: number;
  video: VideoTrackInfo;
  /**
   * The audio track currently driving the fMP4 init segment. `undefined` only
   * when the file is video-only or has no codec we support. Re-initing the
   * MSE controller with a different `selectedAudioTrackNumber` swaps this
   * for a different entry of `audioTracks`.
   */
  audio?: AudioTrackInfo;
  /** Every audio track we *could* remux (AAC/FLAC/Opus/AC-3). */
  audioTracks: AudioTrackInfo[];
  firstClusterOffset: number;
}

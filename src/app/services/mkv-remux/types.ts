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
  codec: 'aac' | 'flac' | 'opus';
  codecPrivate: Uint8Array;
  sampleRate: number;
  channels: number;
  defaultDurationNs: number;
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
  audio?: AudioTrackInfo;
  firstClusterOffset: number;
}

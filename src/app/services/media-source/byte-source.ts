/**
 * Byte-range access abstraction for `MkvMseController`. Drive playback reads
 * bytes via Range-fetch (`authedFetch` + `buildMediaUrl`, unchanged); local
 * playback reads the same shapes from a `File` via `Blob.slice()`. The
 * controller branches once on `this.byteSource` instead of duplicating its
 * remux/parse logic per source.
 */

export interface MediaByteSource {
  readonly size: number;
  /** Inclusive byte range [start, end], mirroring an HTTP `Range` header. */
  readRange(
    start: number,
    end: number,
    signal?: AbortSignal,
  ): Promise<{ bytes: Uint8Array; total: number }>;
  /** Open a stream of the remaining bytes starting at `offset`. */
  openStream(
    offset: number,
    signal?: AbortSignal,
  ): Promise<ReadableStreamDefaultReader<Uint8Array>>;
}

export class LocalFileByteSource implements MediaByteSource {
  constructor(private readonly file: File) {}

  get size(): number {
    return this.file.size;
  }

  async readRange(start: number, end: number): Promise<{ bytes: Uint8Array; total: number }> {
    const bytes = new Uint8Array(await this.file.slice(start, end + 1).arrayBuffer());
    return { bytes, total: this.file.size };
  }

  async openStream(offset: number): Promise<ReadableStreamDefaultReader<Uint8Array>> {
    return this.file.slice(offset).stream().getReader();
  }
}

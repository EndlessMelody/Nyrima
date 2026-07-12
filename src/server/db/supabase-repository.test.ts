import { describe, expect, it } from "vitest";
import type { User, UserSettings, CacheRecord } from "./schema";
import { createSupabaseRepository } from "./supabase-repository";

type Row = Record<string, unknown>;

class FakeQuery {
  private filters: Array<[string, unknown]> = [];
  private nullFilters: string[] = [];
  private lteFilters: Array<[string, unknown]> = [];
  private payload: Row | Row[] | null = null;
  private conflictKey = "id";

  constructor(
    private readonly rows: Row[],
    private readonly tableName: string,
  ) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  is(column: string, value: null) {
    if (value === null) this.nullFilters.push(column);
    return this;
  }

  lte(column: string, value: unknown) {
    this.lteFilters.push([column, value]);
    return this;
  }

  order() {
    return this;
  }

  upsert(payload: Row | Row[], opts?: { onConflict?: string }) {
    this.payload = payload;
    this.conflictKey = opts?.onConflict ?? "id";
    return this;
  }

  delete() {
    this.payload = null;
    return {
      eq: (column: string, value: unknown) => {
        const before = this.rows.length;
        for (let i = this.rows.length - 1; i >= 0; i--) {
          if (this.rows[i]?.[column] === value) this.rows.splice(i, 1);
        }
        return Promise.resolve({ data: null, error: null, count: before - this.rows.length });
      },
    };
  }

  async maybeSingle() {
    return { data: this.matchRows()[0] ?? null, error: null };
  }

  async single() {
    if (!this.payload) return { data: this.matchRows()[0] ?? null, error: null };
    const row = Array.isArray(this.payload) ? this.payload[0] : this.payload;
    const columns = this.conflictKey.split(",").map((col) => col.trim());
    const idx = this.rows.findIndex((existing) =>
      columns.every((column) => existing[column] === row[column]),
    );
    if (idx >= 0) this.rows[idx] = { ...this.rows[idx], ...row };
    else this.rows.push(row);
    return { data: row, error: null };
  }

  then(resolve: (value: { data: Row[]; error: null; count: number }) => void) {
    const rows = this.matchRows();
    resolve({ data: rows, error: null, count: rows.length });
  }

  private matchRows(): Row[] {
    return this.rows.filter((row) => {
      const eqOk = this.filters.every(([column, value]) => row[column] === value);
      const nullOk = this.nullFilters.every((column) => row[column] == null);
      const lteOk = this.lteFilters.every(([column, value]) =>
        typeof row[column] === "string" && typeof value === "string"
          ? String(row[column]) <= value
          : Number(row[column]) <= Number(value),
      );
      return eqOk && nullOk && lteOk;
    });
  }
}

class FakeSupabase {
  readonly tables: Record<string, Row[]> = {
    profiles: [],
    user_settings: [],
    player_preferences: [],
    cache_records: [],
  };

  from(tableName: string) {
    this.tables[tableName] ??= [];
    return new FakeQuery(this.tables[tableName], tableName);
  }
}

describe("createSupabaseRepository", () => {
  it("maps profile rows to repository users", async () => {
    const client = new FakeSupabase();
    client.tables.profiles.push({
      id: "user-1",
      email: "a@example.com",
      display_name: "Aoi",
      avatar_url: "https://example.test/a.png",
      method: "google",
      created_at: "2026-05-31T10:00:00.000Z",
      updated_at: "2026-05-31T10:10:00.000Z",
    });

    const repo = createSupabaseRepository(client);
    const user = await repo.users.get("user-1");

    expect(user).toEqual<User>({
      id: "user-1",
      email: "a@example.com",
      displayName: "Aoi",
      avatarUrl: "https://example.test/a.png",
      method: "google",
      createdAt: Date.parse("2026-05-31T10:00:00.000Z"),
      updatedAt: Date.parse("2026-05-31T10:10:00.000Z"),
    });
  });

  it("stores settings with user_id ownership and full app settings payload", async () => {
    const client = new FakeSupabase();
    const repo = createSupabaseRepository(client);

    const saved = await repo.settings.saveSettings({
      userId: "user-1",
      theme: "light",
      autoplayNext: false,
      defaultVolume: 0.42,
      skipSeconds: 30,
      appSettings: {
        subtitleScale: 1.4,
        libraryView: "grid",
      },
      updatedAt: Date.parse("2026-05-31T10:20:00.000Z"),
    });

    expect(client.tables.user_settings[0]).toMatchObject({
      user_id: "user-1",
      theme: "light",
      autoplay_next: false,
      default_volume: 0.42,
      skip_seconds: 30,
      settings: {
        subtitleScale: 1.4,
        libraryView: "grid",
      },
    });

    const loaded = await repo.settings.getSettings("user-1");
    expect(loaded).toEqual<UserSettings>(saved);
  });

  it("stores cache metadata by cache_key and preserves Redis-ready fields", async () => {
    const client = new FakeSupabase();
    const repo = createSupabaseRepository(client);

    const record = await repo.cache.put({
      id: "cache-1",
      userId: "user-1",
      key: "drive-folder:abc",
      cacheType: "drive-folder-metadata",
      source: "drive-listing",
      sourceId: "abc",
      etag: "v1",
      modifiedTime: "2026-05-31T09:00:00.000Z",
      cachedAt: Date.parse("2026-05-31T10:00:00.000Z"),
      expiresAt: Date.parse("2026-05-31T10:05:00.000Z"),
      invalidatedAt: null,
      invalidationReason: null,
      redisKey: "nyrima:user-1:drive-folder:abc",
      sizeBytes: 128,
      createdAt: Date.parse("2026-05-31T10:00:00.000Z"),
      lastAccessedAt: Date.parse("2026-05-31T10:00:00.000Z"),
    });

    expect(client.tables.cache_records[0]).toMatchObject({
      user_id: "user-1",
      cache_key: "drive-folder:abc",
      cache_type: "drive-folder-metadata",
      source_id: "abc",
      redis_key: "nyrima:user-1:drive-folder:abc",
    });

    const loaded = await repo.cache.get("user-1", "drive-folder:abc");
    expect(loaded).toEqual<CacheRecord>(record);
  });
});

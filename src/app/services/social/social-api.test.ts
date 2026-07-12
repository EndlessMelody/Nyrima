import { beforeEach, describe, expect, it, vi } from "vitest";

// social-api imports the shared Supabase singleton directly; swap it for a fake
// via a hoisted holder so each test can install its own client (or none).
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => holder.client,
}));

import {
  SocialAuthRequiredError,
  ensureSocialProfile,
  getMyProfile,
  getProfilesByIds,
  listFolderComments,
  listFriendships,
  postFolderComment,
  respondToFriendRequest,
  searchProfiles,
  sendFriendRequest,
  type FolderComment,
} from "./social-api";

type Row = Record<string, unknown>;
const ISO = "2026-06-18T10:00:00.000Z";

function parseIlike(clause: string): { col: string; needle: string } {
  // "display_name.ilike.%query%"
  const [col, , rawPattern = ""] = clause.split(".");
  return { col, needle: rawPattern.replace(/%/g, "").toLowerCase() };
}

class FakeQuery {
  private filters: Array<[string, unknown]> = [];
  private inFilters: Array<[string, unknown[]]> = [];
  private orPattern: string | null = null;
  private selectStr = "*";
  private payload: Row | null = null;
  private mode: "select" | "insert" | "update" | "delete" = "select";

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string,
  ) {}

  select(sel = "*") {
    this.selectStr = sel;
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.inFilters.push([column, values]);
    return this;
  }
  or(pattern: string) {
    this.orPattern = pattern;
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  insert(payload: Row) {
    this.mode = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: Row) {
    this.mode = "update";
    this.payload = payload;
    return this;
  }
  delete() {
    this.mode = "delete";
    return this;
  }

  private rows(): Row[] {
    return (this.db.tables[this.table] ??= []);
  }

  private matchFilters(row: Row): boolean {
    const eqOk = this.filters.every(([c, v]) => row[c] === v);
    const inOk = this.inFilters.every(([c, vals]) => vals.includes(row[c]));
    let orOk = true;
    if (this.orPattern) {
      const clauses = this.orPattern.split(",").map(parseIlike);
      orOk = clauses.some(({ col, needle }) =>
        String(row[col] ?? "").toLowerCase().includes(needle),
      );
    }
    return eqOk && inOk && orOk;
  }

  private embed(row: Row): Row {
    if (this.selectStr.includes("author:profiles")) {
      const author =
        (this.db.tables.profiles ?? []).find(
          (p) => p.id === row.author_user_id,
        ) ?? null;
      return { ...row, author };
    }
    return row;
  }

  private matched(): Row[] {
    return this.rows().filter((r) => this.matchFilters(r)).map((r) => this.embed(r));
  }

  async single() {
    if (this.mode === "insert") {
      const row: Row = {
        id: this.payload?.id ?? `gen-${this.db.seq++}`,
        created_at: ISO,
        updated_at: ISO,
        ...this.payload,
      };
      this.rows().push(row);
      return { data: this.embed(row), error: null };
    }
    if (this.mode === "update") {
      const hit = this.rows().find((r) => this.matchFilters(r));
      if (hit) Object.assign(hit, this.payload, { updated_at: ISO });
      return { data: hit ? this.embed(hit) : null, error: null };
    }
    return { data: this.matched()[0] ?? null, error: null };
  }

  async maybeSingle() {
    return { data: this.matched()[0] ?? null, error: null };
  }

  then(resolve: (value: { data: Row[] | null; error: null; count?: number }) => void) {
    if (this.mode === "delete") {
      const before = this.rows().length;
      this.db.tables[this.table] = this.rows().filter((r) => !this.matchFilters(r));
      resolve({ data: null, error: null, count: before - this.db.tables[this.table].length });
      return;
    }
    resolve({ data: this.matched(), error: null });
  }
}

class FakeSupabase {
  readonly tables: Record<string, Row[]> = {
    profiles: [],
    friendships: [],
    folder_comments: [],
  };
  seq = 1;

  constructor(public currentUserId: string | null = "user-1") {}

  auth = {
    getSession: async () => ({
      data: {
        session: this.currentUserId ? { user: { id: this.currentUserId } } : null,
      },
      error: null,
    }),
  };

  from(table: string) {
    this.tables[table] ??= [];
    return new FakeQuery(this, table);
  }

  async rpc(name: string, params: Record<string, unknown>) {
    if (name !== "ensure_social_profile") {
      return { data: null, error: { message: `unknown rpc ${name}` } };
    }
    const id = this.currentUserId;
    if (!id) return { data: null, error: { message: "not authenticated" } };
    let row = this.tables.profiles.find((p) => p.id === id);
    if (!row) {
      row = {
        id,
        handle: null,
        display_name: "",
        avatar_url: null,
        created_at: ISO,
        updated_at: ISO,
      };
      this.tables.profiles.push(row);
    }
    if (params.p_handle != null) row.handle = params.p_handle;
    if (params.p_display_name != null && params.p_display_name !== "") {
      row.display_name = params.p_display_name;
    }
    if (params.p_avatar_url != null) row.avatar_url = params.p_avatar_url;
    return { data: row, error: null };
  }
}

beforeEach(() => {
  holder.client = new FakeSupabase();
});

describe("social-api · profiles", () => {
  it("ensureSocialProfile lazily creates the caller's row and maps it", async () => {
    const profile = await ensureSocialProfile({
      handle: "khoa",
      displayName: "Đăng Khoa",
      avatarUrl: "https://example.test/k.png",
    });
    expect(profile).toMatchObject({
      id: "user-1",
      handle: "khoa",
      displayName: "Đăng Khoa",
      avatarUrl: "https://example.test/k.png",
    });

    const loaded = await getMyProfile();
    expect(loaded?.handle).toBe("khoa");
    expect(loaded?.displayName).toBe("Đăng Khoa");
  });

  it("searchProfiles matches handle or display name case-insensitively", async () => {
    const db = holder.client as FakeSupabase;
    db.tables.profiles.push(
      { id: "u1", handle: "khoa", display_name: "Đăng Khoa", created_at: ISO, updated_at: ISO },
      { id: "u2", handle: "aoi", display_name: "Aoi", created_at: ISO, updated_at: ISO },
    );
    const hits = await searchProfiles("kho");
    expect(hits.map((p) => p.id)).toEqual(["u1"]);
  });

  it("getProfilesByIds keys results by id and dedupes input", async () => {
    const db = holder.client as FakeSupabase;
    db.tables.profiles.push(
      { id: "u1", handle: "a", display_name: "A", created_at: ISO, updated_at: ISO },
      { id: "u2", handle: "b", display_name: "B", created_at: ISO, updated_at: ISO },
    );
    const map = await getProfilesByIds(["u1", "u2", "u1"]);
    expect(Object.keys(map).sort()).toEqual(["u1", "u2"]);
    expect(map.u1.handle).toBe("a");
  });
});

describe("social-api · folder comments", () => {
  it("postFolderComment ensures a profile, writes the row, and embeds the author", async () => {
    const comment = await postFolderComment({
      folderId: "drive-folder-1",
      shareId: "share-9",
      body: "  Loved this rip  ",
      profile: { handle: "khoa", displayName: "Đăng Khoa" },
    });

    const db = holder.client as FakeSupabase;
    // Row persisted with the right columns (trimmed body, author = session user).
    expect(db.tables.folder_comments[0]).toMatchObject({
      folder_id: "drive-folder-1",
      share_id: "share-9",
      author_user_id: "user-1",
      body: "Loved this rip",
    });
    // A social profile was lazily created for the author.
    expect(db.tables.profiles.find((p) => p.id === "user-1")?.handle).toBe("khoa");
    // Returned shape is mapped + author embedded.
    expect(comment).toMatchObject<Partial<FolderComment>>({
      folderId: "drive-folder-1",
      shareId: "share-9",
      authorUserId: "user-1",
      body: "Loved this rip",
    });
    expect(comment.author?.handle).toBe("khoa");
  });

  it("listFolderComments maps rows, embeds authors, and can filter by share_id", async () => {
    const db = holder.client as FakeSupabase;
    db.tables.profiles.push({
      id: "user-1",
      handle: "khoa",
      display_name: "Đăng Khoa",
      avatar_url: "https://example.test/k.png",
      created_at: ISO,
      updated_at: ISO,
    });
    db.tables.folder_comments.push(
      { id: "c1", folder_id: "f1", share_id: "s1", author_user_id: "user-1", body: "one", created_at: ISO, updated_at: ISO },
      { id: "c2", folder_id: "f1", share_id: "s2", author_user_id: "user-1", body: "two", created_at: ISO, updated_at: ISO },
    );

    const all = await listFolderComments("f1");
    expect(all.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    expect(all[0].author?.handle).toBe("khoa");

    const onlyS2 = await listFolderComments("f1", { shareId: "s2" });
    expect(onlyS2.map((c) => c.id)).toEqual(["c2"]);
  });
});

describe("social-api · friendships", () => {
  it("sends, lists, and responds to a friend request", async () => {
    const created = await sendFriendRequest("friend-2");
    expect(created).toMatchObject({
      userId: "user-1",
      friendUserId: "friend-2",
      status: "pending",
    });

    const list = await listFriendships();
    expect(list).toHaveLength(1);

    const accepted = await respondToFriendRequest(created.id, "accepted");
    expect(accepted.status).toBe("accepted");
  });
});

describe("social-api · auth gating", () => {
  it("throws SocialAuthRequiredError when no client is configured", async () => {
    holder.client = null;
    await expect(getMyProfile()).rejects.toBeInstanceOf(SocialAuthRequiredError);
  });

  it("throws SocialAuthRequiredError when there is no session", async () => {
    holder.client = new FakeSupabase(null);
    await expect(postFolderComment({ folderId: "f1", body: "hi" })).rejects.toBeInstanceOf(
      SocialAuthRequiredError,
    );
  });
});

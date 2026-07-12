/**
 * Persistence for the local mock auth backend.
 *
 * IMPORTANT: this store lives OUTSIDE the per-account `chrome.storage` shim —
 * it's the registry that decides *which* account is active, so it must persist
 * across account switches under fixed, un-namespaced keys.
 *
 * This is a development stand-in for a real user database. Passwords are stored
 * only as a SHA-256 hash (never plaintext) so a casual localStorage glance
 * doesn't leak them — but this is NOT real auth security. The real backend
 * (VITE_API_BASE_URL) replaces this entirely; see src/server/db.
 */

import type { Account } from "./auth-types";

const ACCOUNTS_KEY = "nyrima:auth:v1:accounts";
const SESSION_KEY = "nyrima:auth:v1:session";

export interface StoredAccount extends Account {
  /** SHA-256 hex of the password. Absent for google-method accounts. */
  passwordHash?: string;
}

interface SessionRecord {
  accountId: string;
  createdAt: number;
}

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota — non-fatal for a dev mock */
  }
}

export function listAccounts(): StoredAccount[] {
  return readJSON<StoredAccount[]>(ACCOUNTS_KEY, []);
}

export function findAccountByEmail(email: string): StoredAccount | undefined {
  const norm = email.trim().toLowerCase();
  return listAccounts().find((a) => a.email.toLowerCase() === norm);
}

export function findAccountById(id: string): StoredAccount | undefined {
  return listAccounts().find((a) => a.id === id);
}

export function upsertAccount(account: StoredAccount): void {
  const accounts = listAccounts();
  const idx = accounts.findIndex((a) => a.id === account.id);
  if (idx >= 0) accounts[idx] = account;
  else accounts.push(account);
  writeJSON(ACCOUNTS_KEY, accounts);
}

export function getSession(): SessionRecord | null {
  return readJSON<SessionRecord | null>(SESSION_KEY, null);
}

export function setSession(accountId: string): void {
  writeJSON(SESSION_KEY, { accountId, createdAt: Date.now() });
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** SHA-256 hex digest. Used to avoid storing plaintext passwords in the mock. */
export async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Strip persistence-only fields before exposing an account to the UI. */
export function toPublicAccount(stored: StoredAccount): Account {
  const { passwordHash: _omit, ...account } = stored;
  void _omit;
  return account;
}

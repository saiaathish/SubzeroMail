import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import initSqlJs, { type Database } from "sql.js";

export type StoredAccount = {
  id: string;
  gmailAddress: string;
  googleSubject: string;
  encryptedRefreshToken: string;
  scopes: string[];
};

export type CachedThread = {
  accountId: string;
  threadId: string;
  latestMessageId: string;
  subject: string;
  participants: string[];
  preview: string;
  unread: boolean;
  gmailLabels: string[];
  bucket: "priority" | "needs_reply" | "waiting" | "other";
  triage?: unknown;
  summary?: unknown;
};

export type StoredOpenLoop = {
  id: string;
  accountId: string;
  threadId: string;
  sourceMessageId: string | null;
  direction: "i_owe" | "they_owe" | "waiting";
  text: string;
  dueAt: string | null;
  confidence: number;
  status: "open" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
};

export type SubzeroStorage = ReturnType<typeof createStorage>;

const schema = `
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    gmail_address TEXT NOT NULL UNIQUE,
    google_subject TEXT NOT NULL UNIQUE,
    encrypted_refresh_token TEXT NOT NULL,
    scopes TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS provider_keys (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    encrypted_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(account_id, provider)
  );
  CREATE TABLE IF NOT EXISTS thread_cache (
    account_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    latest_message_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    participants_json TEXT NOT NULL,
    preview TEXT NOT NULL,
    unread INTEGER NOT NULL,
    gmail_labels_json TEXT NOT NULL,
    bucket TEXT NOT NULL,
    triage_json TEXT,
    summary_json TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(account_id, thread_id)
  );
  CREATE TABLE IF NOT EXISTS open_loops (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    source_message_id TEXT,
    direction TEXT NOT NULL,
    text TEXT NOT NULL,
    due_at TEXT,
    confidence REAL NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    UNIQUE(account_id, thread_id, source_message_id, direction, text)
  );
  CREATE TABLE IF NOT EXISTS voice_profiles (
    account_id TEXT PRIMARY KEY,
    profile_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    account_id TEXT PRIMARY KEY,
    settings_json TEXT NOT NULL
  );
`;

type QueryRow = Record<string, unknown>;

// sql.js's WASM bootstrap is not re-entrant in the Next.js development
// worker. Share one in-flight initialization across account-scoped storage
// instances so concurrent route requests cannot corrupt the loader state.
let sqlRuntimePromise: ReturnType<typeof initSqlJs> | undefined;

async function loadSqlRuntime() {
  sqlRuntimePromise ??= initSqlJs();
  try {
    return await sqlRuntimePromise;
  } catch (error) {
    sqlRuntimePromise = undefined;
    throw error;
  }
}

function now() {
  return new Date().toISOString();
}

function first<T extends QueryRow>(
  db: Database,
  sql: string,
  params: unknown[] = [],
) {
  const rows = query<T>(db, sql, params);
  return rows[0] ?? null;
}

function query<T extends QueryRow>(
  db: Database,
  sql: string,
  params: unknown[] = [],
) {
  const result = db.exec(
    sql,
    params as (string | number | null | Uint8Array)[],
  );
  if (!result[0]) return [] as T[];
  const { columns, values } = result[0];
  return values.map(
    (value) =>
      Object.fromEntries(
        columns.map((column, index) => [column, value[index]]),
      ) as T,
  );
}

async function openDatabase(path: string) {
  // sql.js resolves its bundled WASM relative to its own module in Node/Bun.
  // Supplying a browser-root path here breaks self-hosted and test execution.
  const SQL = await loadSqlRuntime();
  let bytes: Uint8Array | undefined;
  if (path !== ":memory:") {
    try {
      bytes = await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  db.run(schema);
  return db;
}

/**
 * SQLite repository. It stores only encrypted credentials and derived mail state;
 * full raw message bodies intentionally do not belong in this database.
 */
export function createStorage(
  databasePath = process.env.SUBZERO_DATABASE_URL ?? "./data/subzero.db",
) {
  let databasePromise: Promise<Database> | undefined;

  async function db() {
    databasePromise ??= openDatabase(databasePath);
    return databasePromise;
  }

  async function persist() {
    if (databasePath === ":memory:") return;
    const database = await db();
    await mkdir(dirname(databasePath), { recursive: true });
    await writeFile(databasePath, database.export());
  }

  async function mutate(sql: string, params: unknown[] = []) {
    const database = await db();
    database.run(sql, params as (string | number | null | Uint8Array)[]);
    await persist();
  }

  return {
    async upsertAccount(account: StoredAccount) {
      const timestamp = now();
      await mutate(
        `INSERT INTO accounts (id, gmail_address, google_subject, encrypted_refresh_token, scopes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET gmail_address=excluded.gmail_address, google_subject=excluded.google_subject,
         encrypted_refresh_token=excluded.encrypted_refresh_token, scopes=excluded.scopes, updated_at=excluded.updated_at`,
        [
          account.id,
          account.gmailAddress,
          account.googleSubject,
          account.encryptedRefreshToken,
          JSON.stringify(account.scopes),
          timestamp,
          timestamp,
        ],
      );
    },

    async accountById(id: string): Promise<StoredAccount | null> {
      const row = first<{
        id: string;
        gmail_address: string;
        google_subject: string;
        encrypted_refresh_token: string;
        scopes: string;
      }>(await db(), "SELECT * FROM accounts WHERE id = ?", [id]);
      return row
        ? {
            id: row.id,
            gmailAddress: row.gmail_address,
            googleSubject: row.google_subject,
            encryptedRefreshToken: row.encrypted_refresh_token,
            scopes: JSON.parse(row.scopes) as string[],
          }
        : null;
    },

    async saveProviderKey(input: {
      id: string;
      accountId: string;
      provider: string;
      encryptedKey: string;
    }) {
      const timestamp = now();
      await mutate(
        `INSERT INTO provider_keys (id, account_id, provider, encrypted_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, provider) DO UPDATE SET encrypted_key=excluded.encrypted_key, updated_at=excluded.updated_at`,
        [
          input.id,
          input.accountId,
          input.provider,
          input.encryptedKey,
          timestamp,
          timestamp,
        ],
      );
    },

    async providerKey(accountId: string, provider: string) {
      const row = first<{ encrypted_key: string }>(
        await db(),
        "SELECT encrypted_key FROM provider_keys WHERE account_id = ? AND provider = ?",
        [accountId, provider],
      );
      return row?.encrypted_key ?? null;
    },

    async removeProviderKey(accountId: string, provider: string) {
      await mutate(
        "DELETE FROM provider_keys WHERE account_id = ? AND provider = ?",
        [accountId, provider],
      );
    },

    async upsertThread(thread: CachedThread) {
      await mutate(
        `INSERT INTO thread_cache (account_id, thread_id, latest_message_id, subject, participants_json, preview, unread, gmail_labels_json, bucket, triage_json, summary_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, thread_id) DO UPDATE SET latest_message_id=excluded.latest_message_id, subject=excluded.subject,
         participants_json=excluded.participants_json, preview=excluded.preview, unread=excluded.unread, gmail_labels_json=excluded.gmail_labels_json,
         bucket=excluded.bucket, triage_json=excluded.triage_json, summary_json=excluded.summary_json, updated_at=excluded.updated_at`,
        [
          thread.accountId,
          thread.threadId,
          thread.latestMessageId,
          thread.subject,
          JSON.stringify(thread.participants),
          thread.preview,
          thread.unread ? 1 : 0,
          JSON.stringify(thread.gmailLabels),
          thread.bucket,
          JSON.stringify(thread.triage ?? null),
          JSON.stringify(thread.summary ?? null),
          now(),
        ],
      );
    },

    async listThreads(accountId: string): Promise<CachedThread[]> {
      return query<{
        account_id: string;
        thread_id: string;
        latest_message_id: string;
        subject: string;
        participants_json: string;
        preview: string;
        unread: number;
        gmail_labels_json: string;
        bucket: CachedThread["bucket"];
        triage_json: string | null;
        summary_json: string | null;
      }>(
        await db(),
        "SELECT * FROM thread_cache WHERE account_id = ? ORDER BY updated_at DESC",
        [accountId],
      ).map((row) => ({
        accountId: row.account_id,
        threadId: row.thread_id,
        latestMessageId: row.latest_message_id,
        subject: row.subject,
        participants: JSON.parse(row.participants_json),
        preview: row.preview,
        unread: Boolean(row.unread),
        gmailLabels: JSON.parse(row.gmail_labels_json),
        bucket: row.bucket,
        triage: row.triage_json ? JSON.parse(row.triage_json) : undefined,
        summary: row.summary_json ? JSON.parse(row.summary_json) : undefined,
      }));
    },

    async upsertOpenLoop(loop: StoredOpenLoop) {
      await mutate(
        `INSERT INTO open_loops (id, account_id, thread_id, source_message_id, direction, text, due_at, confidence, status, created_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, thread_id, source_message_id, direction, text) DO UPDATE SET due_at=excluded.due_at, confidence=excluded.confidence, status=excluded.status, resolved_at=excluded.resolved_at`,
        [
          loop.id,
          loop.accountId,
          loop.threadId,
          loop.sourceMessageId,
          loop.direction,
          loop.text,
          loop.dueAt,
          loop.confidence,
          loop.status,
          loop.createdAt,
          loop.resolvedAt,
        ],
      );
    },

    async listOpenLoops(accountId: string): Promise<StoredOpenLoop[]> {
      return query<{
        id: string;
        account_id: string;
        thread_id: string;
        source_message_id: string | null;
        direction: StoredOpenLoop["direction"];
        text: string;
        due_at: string | null;
        confidence: number;
        status: StoredOpenLoop["status"];
        created_at: string;
        resolved_at: string | null;
      }>(
        await db(),
        "SELECT * FROM open_loops WHERE account_id = ? ORDER BY created_at DESC",
        [accountId],
      ).map((row) => ({
        id: row.id,
        accountId: row.account_id,
        threadId: row.thread_id,
        sourceMessageId: row.source_message_id,
        direction: row.direction,
        text: row.text,
        dueAt: row.due_at,
        confidence: row.confidence,
        status: row.status,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at,
      }));
    },

    /** Update only a loop owned by this account; no mailbox content is changed. */
    async updateOpenLoop(input: {
      accountId: string;
      id: string;
      direction?: StoredOpenLoop["direction"];
      text?: string;
      dueAt?: string | null;
      status?: StoredOpenLoop["status"];
    }): Promise<StoredOpenLoop | null> {
      const row = first<{
        id: string;
        account_id: string;
        thread_id: string;
        source_message_id: string | null;
        direction: StoredOpenLoop["direction"];
        text: string;
        due_at: string | null;
        confidence: number;
        status: StoredOpenLoop["status"];
        created_at: string;
        resolved_at: string | null;
      }>(
        await db(),
        "SELECT * FROM open_loops WHERE id = ? AND account_id = ?",
        [input.id, input.accountId],
      );
      if (!row) return null;

      const status = input.status ?? row.status;
      const resolvedAt =
        status === "resolved" ? (row.resolved_at ?? now()) : null;
      const direction = input.direction ?? row.direction;
      const text = input.text ?? row.text;
      const dueAt = input.dueAt === undefined ? row.due_at : input.dueAt;

      await mutate(
        `UPDATE open_loops
         SET direction = ?, text = ?, due_at = ?, status = ?, resolved_at = ?
         WHERE id = ? AND account_id = ?`,
        [direction, text, dueAt, status, resolvedAt, input.id, input.accountId],
      );

      return {
        id: row.id,
        accountId: row.account_id,
        threadId: row.thread_id,
        sourceMessageId: row.source_message_id,
        direction,
        text,
        dueAt,
        confidence: row.confidence,
        status,
        createdAt: row.created_at,
        resolvedAt,
      };
    },

    async saveVoiceProfile(accountId: string, profile: unknown) {
      const timestamp = now();
      await mutate(
        `INSERT INTO voice_profiles (account_id, profile_json, created_at, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(account_id) DO UPDATE SET profile_json=excluded.profile_json, updated_at=excluded.updated_at`,
        [accountId, JSON.stringify(profile), timestamp, timestamp],
      );
    },

    async voiceProfile(accountId: string) {
      const row = first<{ profile_json: string }>(
        await db(),
        "SELECT profile_json FROM voice_profiles WHERE account_id = ?",
        [accountId],
      );
      return row ? JSON.parse(row.profile_json) : null;
    },

    /** Deletes only this account's compact derived profile, never Gmail mail. */
    async removeVoiceProfile(accountId: string) {
      await mutate("DELETE FROM voice_profiles WHERE account_id = ?", [
        accountId,
      ]);
    },

    async saveSettings(accountId: string, settings: unknown) {
      await mutate(
        `INSERT INTO settings (account_id, settings_json) VALUES (?, ?)
         ON CONFLICT(account_id) DO UPDATE SET settings_json=excluded.settings_json`,
        [accountId, JSON.stringify(settings)],
      );
    },

    async settings(accountId: string) {
      const row = first<{ settings_json: string }>(
        await db(),
        "SELECT settings_json FROM settings WHERE account_id = ?",
        [accountId],
      );
      return row ? JSON.parse(row.settings_json) : {};
    },

    async close() {
      if (!databasePromise) return;
      const database = await databasePromise;
      await persist();
      database.close();
      databasePromise = undefined;
    },
  };
}

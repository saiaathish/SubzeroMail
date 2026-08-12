import Dexie, { type Table } from "dexie";

import type {
  MessageRecord,
  OpenLoop,
  PendingMutation,
  SyncCursor,
  ThreadRecord,
} from "../../core/src";

export const EXTENSION_DATABASE_NAME = "subzero-mail-extension";

export const extensionSchema = {
  threads: "id, accountId, latestMessageId, bucket, unread, updatedAt",
  messages: "id, accountId, threadId, internalDate, cachedAt",
  loops: "id, accountId, threadId, status, dueAt, createdAt",
  mutations:
    "id, accountId, kind, status, attempts, createdAt, updatedAt, nextAttemptAt",
  sync: "id, accountId, scope, updatedAt",
} as const;

type ExtensionRecord =
  ThreadRecord | MessageRecord | OpenLoop | PendingMutation | SyncCursor;

export interface ExtensionCollection<T extends ExtensionRecord> {
  toArray(): Promise<T[]>;
  first(): Promise<T | undefined>;
  count(): Promise<number>;
  delete(): Promise<number>;
}

export interface ExtensionWhereClause<T extends ExtensionRecord> {
  equals(value: unknown): ExtensionCollection<T>;
  anyOf(values: readonly unknown[]): ExtensionCollection<T>;
}

/** Small common subset shared by Dexie tables and the test memory fallback. */
export interface ExtensionTable<T extends ExtensionRecord> {
  readonly name: string;
  put(value: T): Promise<unknown>;
  add(value: T): Promise<unknown>;
  get(key: string): Promise<T | undefined>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  toArray(): Promise<T[]>;
  count(): Promise<number>;
  bulkPut(values: readonly T[]): Promise<unknown>;
  bulkAdd(values: readonly T[]): Promise<unknown>;
  where(index: string): ExtensionWhereClause<T>;
  orderBy(index: string): { toArray(): Promise<T[]> };
}

export interface ExtensionStore {
  readonly mode: "dexie" | "memory";
  readonly threads: ExtensionTable<ThreadRecord>;
  readonly messages: ExtensionTable<MessageRecord>;
  readonly loops: ExtensionTable<OpenLoop>;
  readonly mutations: ExtensionTable<PendingMutation>;
  readonly sync: ExtensionTable<SyncCursor>;
  putThread(record: ThreadRecord): Promise<void>;
  putMessage(record: MessageRecord): Promise<void>;
  putLoop(record: OpenLoop): Promise<void>;
  putMutation(record: PendingMutation): Promise<void>;
  putSyncCursor(record: SyncCursor): Promise<void>;
  getThread(id: string): Promise<ThreadRecord | undefined>;
  getMessage(id: string): Promise<MessageRecord | undefined>;
  getLoop(id: string): Promise<OpenLoop | undefined>;
  getMutation(id: string): Promise<PendingMutation | undefined>;
  getSyncCursor(id: string): Promise<SyncCursor | undefined>;
  listThreads(accountId?: string): Promise<ThreadRecord[]>;
  listMessages(threadId?: string): Promise<MessageRecord[]>;
  listLoops(accountId?: string): Promise<OpenLoop[]>;
  listMutations(accountId?: string): Promise<PendingMutation[]>;
  clearAll(): Promise<void>;
  close(): void;
}

/**
 * The real extension database. Construction only declares the schema; callers
 * choose when to open it, so importing this module never touches browser APIs.
 */
export class ExtensionDatabase extends Dexie {
  threads!: Table<ThreadRecord, string>;
  messages!: Table<MessageRecord, string>;
  loops!: Table<OpenLoop, string>;
  mutations!: Table<PendingMutation, string>;
  sync!: Table<SyncCursor, string>;

  readonly mode = "dexie" as const;

  constructor(name = EXTENSION_DATABASE_NAME) {
    super(name);
    this.version(1).stores(extensionSchema);
  }

  async putThread(record: ThreadRecord): Promise<void> {
    await this.threads.put(record);
  }

  async putMessage(record: MessageRecord): Promise<void> {
    await this.messages.put(record);
  }

  async putLoop(record: OpenLoop): Promise<void> {
    await this.loops.put(record);
  }

  async putMutation(record: PendingMutation): Promise<void> {
    await this.mutations.put(record);
  }

  async putSyncCursor(record: SyncCursor): Promise<void> {
    await this.sync.put(record);
  }

  getThread(id: string) {
    return this.threads.get(id);
  }

  getMessage(id: string) {
    return this.messages.get(id);
  }

  getLoop(id: string) {
    return this.loops.get(id);
  }

  getMutation(id: string) {
    return this.mutations.get(id);
  }

  getSyncCursor(id: string) {
    return this.sync.get(id);
  }

  listThreads(accountId?: string) {
    return accountId === undefined
      ? this.threads.toArray()
      : this.threads.where("accountId").equals(accountId).toArray();
  }

  listMessages(threadId?: string) {
    return threadId === undefined
      ? this.messages.toArray()
      : this.messages.where("threadId").equals(threadId).toArray();
  }

  listLoops(accountId?: string) {
    return accountId === undefined
      ? this.loops.toArray()
      : this.loops.where("accountId").equals(accountId).toArray();
  }

  listMutations(accountId?: string) {
    return accountId === undefined
      ? this.mutations.toArray()
      : this.mutations.where("accountId").equals(accountId).toArray();
  }

  async clearAll(): Promise<void> {
    await this.transaction(
      "rw",
      this.threads,
      this.messages,
      this.loops,
      this.mutations,
      this.sync,
      async () => {
        await Promise.all([
          this.threads.clear(),
          this.messages.clear(),
          this.loops.clear(),
          this.mutations.clear(),
          this.sync.clear(),
        ]);
      },
    );
  }
}

function clone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return value;
}

class MemoryCollection<
  T extends ExtensionRecord,
> implements ExtensionCollection<T> {
  constructor(
    private readonly read: () => T[],
    private readonly remove: () => number,
  ) {}

  async toArray(): Promise<T[]> {
    return this.read().map(clone);
  }

  async first(): Promise<T | undefined> {
    const value = this.read()[0];
    return value === undefined ? undefined : clone(value);
  }

  async count(): Promise<number> {
    return this.read().length;
  }

  async delete(): Promise<number> {
    return this.remove();
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return Array.isArray(left) && Array.isArray(right)
    ? left.length === right.length &&
        left.every((value, index) => sameValue(value, right[index]))
    : left === right;
}

class MemoryTable<T extends ExtensionRecord> implements ExtensionTable<T> {
  private readonly records = new Map<string, T>();

  constructor(readonly name: string) {}

  private indexValue(record: T, index: string): unknown {
    if (index === "[accountId+scope]") {
      const cursor = record as SyncCursor;
      return [cursor.accountId, cursor.scope];
    }
    return (record as Record<string, unknown>)[index];
  }

  private matching(index: string, value: unknown): T[] {
    return [...this.records.values()].filter((record) =>
      sameValue(this.indexValue(record, index), value),
    );
  }

  private removeMatching(index: string, value: unknown): number {
    const matches = this.matching(index, value);
    for (const record of matches) this.records.delete(record.id);
    return matches.length;
  }

  async put(value: T): Promise<string> {
    this.records.set(value.id, clone(value));
    return value.id;
  }

  async add(value: T): Promise<string> {
    if (this.records.has(value.id)) {
      throw new Error(`Duplicate key: ${value.id}`);
    }
    this.records.set(value.id, clone(value));
    return value.id;
  }

  async get(key: string): Promise<T | undefined> {
    const value = this.records.get(key);
    return value === undefined ? undefined : clone(value);
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key);
  }

  async clear(): Promise<void> {
    this.records.clear();
  }

  async toArray(): Promise<T[]> {
    return [...this.records.values()].map(clone);
  }

  async count(): Promise<number> {
    return this.records.size;
  }

  async bulkPut(values: readonly T[]): Promise<string[]> {
    for (const value of values) await this.put(value);
    return values.map((value) => value.id);
  }

  async bulkAdd(values: readonly T[]): Promise<string[]> {
    for (const value of values) await this.add(value);
    return values.map((value) => value.id);
  }

  where(index: string): ExtensionWhereClause<T> {
    return {
      equals: (value) =>
        new MemoryCollection(
          () => this.matching(index, value),
          () => this.removeMatching(index, value),
        ),
      anyOf: (values) =>
        new MemoryCollection(
          () =>
            [...this.records.values()].filter((record) =>
              values.some((value) =>
                sameValue(this.indexValue(record, index), value),
              ),
            ),
          () => {
            let removed = 0;
            for (const value of values)
              removed += this.removeMatching(index, value);
            return removed;
          },
        ),
    };
  }

  orderBy(index: string) {
    return {
      toArray: async () =>
        [...this.records.values()]
          .sort((left, right) =>
            String(this.indexValue(left, index) ?? "").localeCompare(
              String(this.indexValue(right, index) ?? ""),
            ),
          )
          .map(clone),
    };
  }
}

/** In-memory implementation used when IndexedDB is unavailable in tests/SSR. */
export class MemoryExtensionDatabase implements ExtensionStore {
  readonly mode = "memory" as const;
  readonly threads = new MemoryTable<ThreadRecord>("threads");
  readonly messages = new MemoryTable<MessageRecord>("messages");
  readonly loops = new MemoryTable<OpenLoop>("loops");
  readonly mutations = new MemoryTable<PendingMutation>("mutations");
  readonly sync = new MemoryTable<SyncCursor>("sync");

  async putThread(record: ThreadRecord): Promise<void> {
    await this.threads.put(record);
  }

  async putMessage(record: MessageRecord): Promise<void> {
    await this.messages.put(record);
  }

  async putLoop(record: OpenLoop): Promise<void> {
    await this.loops.put(record);
  }

  async putMutation(record: PendingMutation): Promise<void> {
    await this.mutations.put(record);
  }

  async putSyncCursor(record: SyncCursor): Promise<void> {
    await this.sync.put(record);
  }

  getThread(id: string) {
    return this.threads.get(id);
  }

  getMessage(id: string) {
    return this.messages.get(id);
  }

  getLoop(id: string) {
    return this.loops.get(id);
  }

  getMutation(id: string) {
    return this.mutations.get(id);
  }

  getSyncCursor(id: string) {
    return this.sync.get(id);
  }

  listThreads(accountId?: string) {
    return accountId === undefined
      ? this.threads.toArray()
      : this.threads.where("accountId").equals(accountId).toArray();
  }

  listMessages(threadId?: string) {
    return threadId === undefined
      ? this.messages.toArray()
      : this.messages.where("threadId").equals(threadId).toArray();
  }

  listLoops(accountId?: string) {
    return accountId === undefined
      ? this.loops.toArray()
      : this.loops.where("accountId").equals(accountId).toArray();
  }

  listMutations(accountId?: string) {
    return accountId === undefined
      ? this.mutations.toArray()
      : this.mutations.where("accountId").equals(accountId).toArray();
  }

  async clearAll(): Promise<void> {
    await Promise.all([
      this.threads.clear(),
      this.messages.clear(),
      this.loops.clear(),
      this.mutations.clear(),
      this.sync.clear(),
    ]);
  }

  close(): void {
    // The memory fallback has no external resources to release.
  }
}

export interface ExtensionDatabaseOptions {
  name?: string;
  /** Force the deterministic in-memory implementation in unit tests. */
  mode?: "dexie" | "memory";
}

function hasIndexedDb(): boolean {
  return (
    typeof globalThis === "object" &&
    globalThis !== null &&
    "indexedDB" in globalThis &&
    Boolean(globalThis.indexedDB)
  );
}

export function createExtensionDatabase(
  options: ExtensionDatabaseOptions = {},
): ExtensionStore {
  if (options.mode === "memory" || !hasIndexedDb()) {
    return new MemoryExtensionDatabase();
  }
  return new ExtensionDatabase(options.name) as unknown as ExtensionStore;
}

export interface ChromeStorageAreaLike {
  get(
    keys?: string | readonly string[] | Record<string, unknown> | null,
  ): Promise<Record<string, unknown>> | Record<string, unknown>;
  set(items: Record<string, unknown>): Promise<void> | void;
  remove(keys: string | readonly string[]): Promise<void> | void;
}

export interface ChromeLike {
  storage?: {
    local?: ChromeStorageAreaLike;
    session?: ChromeStorageAreaLike;
    /** Deliberately unused. Secrets and settings never go through sync. */
    sync?: ChromeStorageAreaLike;
  };
}

export interface KeyValueStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface ExtensionStorage {
  /** Persistent non-secret settings backed by chrome.storage.local. */
  readonly persistent: KeyValueStorage;
  /** Ephemeral session state backed by chrome.storage.session. */
  readonly session: KeyValueStorage;
  getSetting<T = unknown>(key: string): Promise<T | undefined>;
  setSetting<T = unknown>(key: string, value: T): Promise<void>;
  removeSetting(key: string): Promise<void>;
  getSession<T = unknown>(key: string): Promise<T | undefined>;
  setSession<T = unknown>(key: string, value: T): Promise<void>;
  removeSession(key: string): Promise<void>;
}

class MemoryStorageArea implements ChromeStorageAreaLike {
  private readonly values = new Map<string, unknown>();

  get(
    keys?: string | readonly string[] | Record<string, unknown> | null,
  ): Record<string, unknown> {
    if (keys === null || keys === undefined) {
      return Object.fromEntries(this.values.entries());
    }
    if (typeof keys === "string") {
      return this.values.has(keys) ? { [keys]: this.values.get(keys) } : {};
    }
    if (Array.isArray(keys)) {
      return Object.fromEntries(
        keys.flatMap((key) =>
          this.values.has(key) ? [[key, this.values.get(key)]] : [],
        ),
      );
    }
    return Object.fromEntries(
      Object.entries(keys).map(([key, defaultValue]) => [
        key,
        this.values.has(key) ? this.values.get(key) : defaultValue,
      ]),
    );
  }

  set(items: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(items)) {
      this.values.set(key, value);
    }
  }

  remove(keys: string | readonly string[]): void {
    for (const key of typeof keys === "string" ? [keys] : keys) {
      this.values.delete(key);
    }
  }
}

export function createMemoryChromeLike(): Required<ChromeLike> {
  return {
    storage: {
      local: new MemoryStorageArea(),
      session: new MemoryStorageArea(),
      sync: new MemoryStorageArea(),
    },
  };
}

function secretSettingKey(key: string): boolean {
  return /(?:secret|token|password|credential|private[-_ ]?key|api[-_ ]?key)/i.test(
    key,
  );
}

function areaStore(area: ChromeStorageAreaLike): KeyValueStorage {
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const values = await area.get(key);
      return values[key] as T | undefined;
    },
    async set<T>(key: string, value: T): Promise<void> {
      await area.set({ [key]: value });
    },
    async remove(key: string): Promise<void> {
      await area.remove(key);
    },
  };
}

/**
 * Create injected Chrome storage adapters. Missing areas use separate memory
 * stores, which keeps settings persistent within the test instance while
 * keeping session values isolated from persistent settings.
 */
export function createExtensionStorage(
  chromeLike?: ChromeLike,
): ExtensionStorage {
  const fallback = createMemoryChromeLike();
  const persistent = areaStore(
    chromeLike?.storage?.local ?? fallback.storage!.local!,
  );
  const session = areaStore(
    chromeLike?.storage?.session ?? fallback.storage!.session!,
  );

  return {
    persistent: {
      async get<T>(key: string) {
        return persistent.get<T>(key);
      },
      async set<T>(key: string, value: T) {
        if (secretSettingKey(key)) {
          throw new Error(
            "Secret-like values belong in the server secret store, not extension settings.",
          );
        }
        await persistent.set(key, value);
      },
      remove: (key) => persistent.remove(key),
    },
    session,
    getSetting: (key) => persistent.get(key),
    setSetting: async (key, value) => {
      if (secretSettingKey(key)) {
        throw new Error(
          "Secret-like values belong in the server secret store, not extension settings.",
        );
      }
      await persistent.set(key, value);
    },
    removeSetting: (key) => persistent.remove(key),
    getSession: (key) => session.get(key),
    setSession: (key, value) => session.set(key, value),
    removeSession: (key) => session.remove(key),
  };
}

export const createChromeStorage = createExtensionStorage;
export const createSettingsStore = createExtensionStorage;

"use client";

import Dexie, { type Table } from "dexie";
import type { InboxThread } from "./demo-data";

class SubzeroBrowserCache extends Dexie {
  threads!: Table<InboxThread, string>;

  constructor() {
    super("subzero-mail-cache");
    this.version(1).stores({ threads: "id, bucket, unread, archived" });
  }
}

const cache = new SubzeroBrowserCache();

export async function cacheThreads(threads: InboxThread[]) {
  await cache.transaction("rw", cache.threads, async () => {
    await cache.threads.clear();
    await cache.threads.bulkPut(threads);
  });
}

export async function loadCachedThreads() {
  return cache.threads.toArray();
}

export async function clearCachedThreads() {
  await cache.transaction("rw", cache.threads, async () => {
    await cache.threads.clear();
  });
}

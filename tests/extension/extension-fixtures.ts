import type { Page } from "@playwright/test";

import {
  cloneDemoThreads,
  type FixtureThread,
} from "../../apps/extension/src/fixtures";

const STATE_KEY = "subzero.extension.state.v1";
const ACCOUNT_ID = "gmail:owner@example.com";

export async function seedConnectedMailbox(
  page: Page,
  theme: "dark" | "light" = "dark",
): Promise<void> {
  await page.evaluate(
    async ({ threads, theme: nextTheme, stateKey }) => {
      const storeIndexes: Record<string, string[]> = {
        threads: [
          "accountId",
          "latestMessageId",
          "bucket",
          "unread",
          "updatedAt",
        ],
        messages: ["accountId", "threadId", "internalDate", "cachedAt"],
        loops: ["accountId", "threadId", "status", "dueAt", "createdAt"],
        mutations: [
          "accountId",
          "kind",
          "status",
          "attempts",
          "createdAt",
          "updatedAt",
          "nextAttemptAt",
        ],
        sync: ["accountId", "scope", "updatedAt"],
      };

      const openDatabase = (version?: number) =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const request =
            version === undefined
              ? indexedDB.open("subzero-mail-extension")
              : indexedDB.open("subzero-mail-extension", version);
          request.onupgradeneeded = () => {
            const database = request.result;
            for (const [name, indexes] of Object.entries(storeIndexes)) {
              if (database.objectStoreNames.contains(name)) continue;
              const store = database.createObjectStore(name, {
                keyPath: "id",
              });
              for (const index of indexes) store.createIndex(index, index);
            }
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });

      let database = await openDatabase();
      const missingStore = Object.keys(storeIndexes).some(
        (name) => !database.objectStoreNames.contains(name),
      );
      if (missingStore) {
        const nextVersion = database.version + 1;
        database.close();
        database = await openDatabase(nextVersion);
      }

      const updatedAt = new Date().toISOString();
      const threadRecords = threads.map((thread) => ({
        id: thread.id,
        accountId: "gmail:owner@example.com",
        latestMessageId: thread.latestMessageId ?? thread.id,
        subject: thread.subject,
        preview: thread.preview,
        unread: thread.unread,
        labelIds: [
          "INBOX",
          ...(thread.unread ? ["UNREAD"] : []),
          ...(thread.starred ? ["STARRED"] : []),
        ],
        participants: [{ name: thread.sender, address: thread.senderEmail }],
        bucket: thread.bucket,
        focusReasons: [thread.reason],
        focusReasonCodes: [],
        updatedAt,
        metadataOnly: false,
      }));

      const messageRecords = threads.flatMap((thread) => {
        const sourceMessages = thread.messages?.length
          ? thread.messages
          : [
              {
                id: thread.latestMessageId ?? thread.id,
                sender: thread.sender,
                senderEmail: thread.senderEmail,
                subject: thread.subject,
                preview: thread.preview,
                timestamp: thread.timestamp,
                htmlBody: thread.htmlBody,
              },
            ];
        return sourceMessages.map((message) => ({
          id: message.id,
          accountId: "gmail:owner@example.com",
          threadId: thread.id,
          subject: message.subject,
          from: { name: message.sender, address: message.senderEmail },
          to: (message.to ?? []).map((address) => ({ address })),
          cc: (message.cc ?? []).map((address) => ({ address })),
          bcc: [],
          sentAt: message.timestamp,
          internalDate: Date.now(),
          snippet: message.preview,
          labelIds: [],
          headers: message.headers ?? {},
          body: message.textBody ?? message.preview,
          ...(message.htmlBody ? { htmlBody: message.htmlBody } : {}),
          cachedAt: updatedAt,
        }));
      });

      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(
          ["threads", "messages", "loops", "mutations", "sync"],
          "readwrite",
        );
        for (const storeName of [
          "threads",
          "messages",
          "loops",
          "mutations",
          "sync",
        ]) {
          transaction.objectStore(storeName).clear();
        }
        for (const record of threadRecords) {
          transaction.objectStore("threads").put(record);
        }
        for (const record of messageRecords) {
          transaction.objectStore("messages").put(record);
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      database.close();

      const extensionChrome = (
        globalThis as typeof globalThis & {
          chrome: {
            storage: { local: { set(value: unknown): Promise<void> } };
          };
        }
      ).chrome;
      await extensionChrome.storage.local.set({
        [stateKey]: {
          theme: nextTheme,
          account: {
            mode: "connected",
            email: "owner@example.com",
            label: "Gmail connected",
            detail: "Connected test account",
          },
          sync: {
            status: "idle",
            lastSyncedAt: updatedAt,
            detail: "Connected test mailbox",
            threadCount: threadRecords.length,
          },
          preferences: { onboardingComplete: true },
        },
      });
    },
    { threads: cloneDemoThreads(), theme, stateKey: STATE_KEY },
  );
}

export { ACCOUNT_ID };

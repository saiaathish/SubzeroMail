import { describe, expect, it } from "vitest";

import {
  classifyFocus,
  createPendingMutation,
  enqueueMutation,
  transitionMutationFailure,
} from "@subzero/core";
import {
  MemoryExtensionDatabase,
  createExtensionStorage,
} from "@subzero/storage/extension";

describe("extension-safe core contracts", () => {
  it("classifies deterministic signals and exposes the reason", () => {
    expect(
      classifyFocus({
        subject: "Could you review this today?",
        preview: "Please send your notes before 5pm.",
        unread: true,
      }),
    ).toMatchObject({
      bucket: "needs_reply",
      reasonCodes: ["unread_direct_request"],
    });

    expect(
      classifyFocus({
        subject: "Issue 42",
        preview: "Unsubscribe from this newsletter.",
        unread: true,
      }).bucket,
    ).toBe("other");
  });

  it("deduplicates mutations and caps retryable failures", () => {
    const mutation = createPendingMutation({
      id: "m-1",
      accountId: "a-1",
      kind: "archive",
      payload: { threadId: "t-1" },
      createdAt: "2026-08-11T12:00:00.000Z",
    });
    const queued = enqueueMutation(enqueueMutation([], mutation), mutation);
    expect(queued).toHaveLength(1);

    const retrying = transitionMutationFailure(
      mutation,
      { status: 503 },
      {
        now: "2026-08-11T12:00:00.000Z",
        baseDelayMs: 100,
        maxAttempts: 3,
      },
    );
    expect(retrying.status).toBe("retrying");
    expect(retrying.nextAttemptAt).toBe("2026-08-11T12:00:00.100Z");

    const failed = transitionMutationFailure(
      mutation,
      { status: 400 },
      {
        now: "2026-08-11T12:00:00.000Z",
      },
    );
    expect(failed.status).toBe("failed");
    expect(failed.failureClass).toBe("permanent");
  });

  it("keeps extension records and session settings separate", async () => {
    const db = new MemoryExtensionDatabase();
    await db.putThread({
      id: "t-1",
      accountId: "a-1",
      latestMessageId: "m-1",
      subject: "Thread",
      preview: "Preview",
      unread: true,
      labelIds: [],
      participants: [],
      bucket: "priority",
      focusReasons: ["Unread active thread"],
      focusReasonCodes: ["unread_active_thread"],
      updatedAt: "2026-08-11T12:00:00.000Z",
      metadataOnly: true,
    });
    expect(await db.listThreads("a-1")).toHaveLength(1);

    const storage = createExtensionStorage();
    await storage.setSetting("theme", "dark");
    await storage.setSession("oauth-state", "ephemeral");
    expect(await storage.getSetting("theme")).toBe("dark");
    expect(await storage.getSession("oauth-state")).toBe("ephemeral");
    await expect(
      storage.setSetting("provider-api-key", "never"),
    ).rejects.toThrow(/server secret store/i);
  });
});

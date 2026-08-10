import { describe, expect, it } from "vitest";
import { createStorage } from "@subzero/storage";

describe("SQLite derived-state storage", () => {
  it("stores metadata only and upserts an open loop without duplication", async () => {
    const storage = createStorage(":memory:");
    await storage.upsertThread({
      accountId: "account-1",
      threadId: "thread-1",
      latestMessageId: "message-2",
      subject: "Contract",
      participants: ["maya@example.com"],
      preview: "Please send the contract.",
      unread: true,
      gmailLabels: ["INBOX"],
      bucket: "needs_reply",
    });
    await storage.upsertOpenLoop({
      id: "loop-1",
      accountId: "account-1",
      threadId: "thread-1",
      sourceMessageId: "message-2",
      direction: "i_owe",
      text: "Send the contract",
      dueAt: null,
      confidence: 0.8,
      status: "open",
      createdAt: "2026-01-01T00:00:00.000Z",
      resolvedAt: null,
    });
    await storage.upsertOpenLoop({
      id: "loop-2",
      accountId: "account-1",
      threadId: "thread-1",
      sourceMessageId: "message-2",
      direction: "i_owe",
      text: "Send the contract",
      dueAt: "2026-01-02T00:00:00.000Z",
      confidence: 0.9,
      status: "open",
      createdAt: "2026-01-01T00:00:00.000Z",
      resolvedAt: null,
    });

    const [thread] = await storage.listThreads("account-1");
    const loops = await storage.listOpenLoops("account-1");
    expect(thread).toMatchObject({
      subject: "Contract",
      preview: "Please send the contract.",
    });
    expect(JSON.stringify(thread)).not.toContain("body");
    expect(loops).toHaveLength(1);
    expect(loops[0]).toMatchObject({
      id: "loop-1",
      confidence: 0.9,
      dueAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("stores only a compact Voice Profile and supports an account-scoped reset", async () => {
    const storage = createStorage(":memory:");
    const rawSentMessage = "Raw sent message content must never be persisted.";
    const profile = {
      formality: "casual" as const,
      averageLength: "short" as const,
      greetingPatterns: ["Hi"],
      signoffPatterns: ["Thanks,"],
      directness: 0.8,
      formattingNotes: ["Use short paragraphs."],
    };

    await storage.saveVoiceProfile("account-1", profile);

    expect(await storage.voiceProfile("account-1")).toEqual(profile);
    expect(
      JSON.stringify(await storage.voiceProfile("account-1")),
    ).not.toContain(rawSentMessage);

    await storage.removeVoiceProfile("account-1");

    expect(await storage.voiceProfile("account-1")).toBeNull();
  });
});

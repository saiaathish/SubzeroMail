import { describe, expect, it } from "vitest";

import { inboxThreadFromApi } from "@/features/inbox/inbox-workspace";

describe("live inbox normalization", () => {
  it("hydrates persisted triage, summaries, reply metadata, and mailbox identity", () => {
    const thread = inboxThreadFromApi({
      id: "thread-1",
      latestMessageId: "message-2",
      subject: "Contract",
      participants: [
        { address: "sender@example.com", name: "Sender" },
        { address: "owner@example.com", name: "Owner" },
      ],
      preview: "Please review.",
      unread: true,
      labelIds: ["INBOX", "UNREAD"],
      bucket: "needs_reply",
      triage: {
        bucket: "needs_reply",
        confidence: 0.9,
        reasons: ["Direct request"],
        sourceMessageIds: ["message-2"],
      },
      summary: {
        summary: "A review is requested.",
        latestDelta: "New request",
        actionRequired: "Review contract",
        deadline: "Thursday",
        sourceMessageIds: ["message-2"],
      },
      mailboxAddress: "owner@example.com",
      messages: [
        {
          id: "message-2",
          from: { address: "sender@example.com", name: "Sender" },
          to: [{ address: "owner@example.com", name: "Owner" }],
          cc: [{ address: "legal@example.com", name: "Legal" }],
          headers: {
            "message-id": "<message-2@example.com>",
            references: "<message-1@example.com>",
          },
          body: "Please review.",
          snippet: "Please review.",
        },
      ],
    });

    expect(thread).toMatchObject({
      mailboxAddress: "owner@example.com",
      bucket: "needs_reply",
      reasons: ["Direct request"],
      summary: {
        sourceMessageIds: ["message-2"],
        cachedForMessageId: "message-2",
      },
      messages: [
        {
          cc: ["Legal <legal@example.com>"],
          headers: {
            "message-id": "<message-2@example.com>",
          },
        },
      ],
    });
  });
});

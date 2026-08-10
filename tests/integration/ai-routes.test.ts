import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireMailRouteContext: vi.fn(),
  settings: vi.fn(),
  providerKey: vi.fn(),
  listThreads: vi.fn(),
  upsertThread: vi.fn(),
  voiceProfile: vi.fn(),
}));

vi.mock("@/app/api/mail/runtime", () => ({
  requireMailRouteContext: mocks.requireMailRouteContext,
}));

vi.mock("@subzero/storage", () => ({
  createStorage: () => ({
    settings: mocks.settings,
    providerKey: mocks.providerKey,
    listThreads: mocks.listThreads,
    upsertThread: mocks.upsertThread,
    voiceProfile: mocks.voiceProfile,
  }),
}));

vi.mock("@subzero/security", () => ({
  decryptSecret: vi.fn(() => "provider-test-key"),
  redactSensitiveText: (value: string) => value,
}));

import { POST as draftReply } from "@/app/api/ai/draft/route";
import { POST as summarizeThread } from "@/app/api/ai/summary/route";
import { POST as triageThread } from "@/app/api/ai/triage/route";

const account = {
  id: "account-1",
  gmailAddress: "owner@example.com",
  googleSubject: "subject-1",
};
const currentMailThread = {
  id: "thread-current",
  latestMessageId: "message-current",
  subject: "Contract review",
  participants: [{ address: "sender@example.com", name: "Sender" }],
  preview: "Could you review the contract?",
  unread: true,
  labelIds: ["INBOX", "UNREAD"],
  metadataOnly: false,
  messages: [
    {
      id: "message-current",
      threadId: "thread-current",
      subject: "Contract review",
      from: { address: "sender@example.com", name: "Sender" },
      to: [{ address: "owner@example.com" }],
      cc: [],
      bcc: [],
      snippet: "Could you review the contract?",
      body: "Could you review the contract before Thursday?",
      labelIds: ["INBOX", "UNREAD"],
      headers: {},
    },
  ],
};

const newsletterThread = {
  ...currentMailThread,
  id: "thread-newsletter",
  latestMessageId: "message-newsletter",
  messages: [
    {
      ...currentMailThread.messages[0],
      id: "message-newsletter",
      threadId: "thread-newsletter",
      from: { address: "newsletter@example.com", name: "Weekly Newsletter" },
      body: "Read this newsletter and unsubscribe whenever you want.",
    },
  ],
};

function request(path: string, body: Record<string, unknown>) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function completion(content: unknown, status = 200) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) } }],
    }),
    { status, headers: { "content-type": "application/json" } },
  );
}

beforeEach(() => {
  mocks.requireMailRouteContext.mockResolvedValue({
    account,
    provider: { getThread: vi.fn().mockResolvedValue(currentMailThread) },
  });
  mocks.settings.mockResolvedValue({
    provider: "openai-compatible",
    model: "test-model",
  });
  mocks.providerKey.mockResolvedValue("encrypted-provider-test-key");
  mocks.listThreads.mockResolvedValue([]);
  mocks.upsertThread.mockResolvedValue(undefined);
  mocks.voiceProfile.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("P0 AI action routes", () => {
  it("bypasses the configured provider for deterministic newsletter triage", async () => {
    mocks.requireMailRouteContext.mockResolvedValue({
      account,
      provider: { getThread: vi.fn().mockResolvedValue(newsletterThread) },
    });
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);

    const response = await triageThread(
      request("/api/ai/triage", { threadId: newsletterThread.id }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        deterministic: true,
        triage: {
          bucket: "other",
          sourceMessageIds: ["message-newsletter"],
        },
      },
    });
    expect(mocks.settings).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("returns a schema-valid three-sentence summary with preserved evidence IDs", async () => {
    const providerFetch = vi.fn(async () =>
      completion({
        summary:
          "The sender requested a contract review. The review is needed before Thursday. No other action is stated.",
        latestDelta: "Review requested before Thursday.",
        actionRequired: "Review the contract.",
        deadline: "Thursday",
        sourceMessageIds: ["message-current"],
      }),
    );
    vi.stubGlobal("fetch", providerFetch);

    const response = await summarizeThread(
      request("/api/ai/summary", { threadId: currentMailThread.id }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      data: { summary: string; sourceMessageIds: string[] };
    };
    expect(body).toMatchObject({
      ok: true,
      data: { sourceMessageIds: ["message-current"] },
    });
    expect(body.data.summary.match(/[.!?](?:\s|$)/g) ?? []).toHaveLength(3);
    expect(providerFetch).toHaveBeenCalledTimes(1);
  });

  it("sends only the current-thread context and user intent to an AI draft provider", async () => {
    let providerRequestBody: BodyInit | null | undefined;
    const providerFetch = vi.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        providerRequestBody = init?.body;
        return completion({ draft: "Thursday works for me." });
      },
    );
    vi.stubGlobal("fetch", providerFetch);

    const response = await draftReply(
      request("/api/ai/draft", {
        threadId: currentMailThread.id,
        intent: "Confirm that Thursday works.",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    await expect(response.text()).resolves.toBe("Thursday works for me.");
    const providerRequest = JSON.parse(String(providerRequestBody)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const input = JSON.parse(
      providerRequest.messages.find((message) => message.role === "user")!
        .content,
    ) as {
      thread: { threadId: string; messages: Array<{ id: string }> };
      intent: string;
      voiceProfile?: unknown;
    };
    expect(input).toMatchObject({
      thread: {
        threadId: "thread-current",
        messages: [expect.objectContaining({ id: "message-current" })],
      },
      intent: "Confirm that Thursday works.",
    });
    expect(input.thread.messages).toHaveLength(1);
    expect(input.voiceProfile).toBeUndefined();
    expect(JSON.stringify(input)).not.toContain("unrelated-mailbox-message");
  });

  it("adds only a schema-valid compact Voice Profile when one is configured", async () => {
    const voiceProfile = {
      formality: "casual",
      averageLength: "short",
      greetingPatterns: ["Hi"],
      signoffPatterns: ["Thanks,"],
      directness: 0.8,
      formattingNotes: ["Keep it concise."],
    };
    mocks.voiceProfile.mockResolvedValue(voiceProfile);
    let providerRequestBody: BodyInit | null | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (
          _input: Parameters<typeof fetch>[0],
          init?: Parameters<typeof fetch>[1],
        ) => {
          providerRequestBody = init?.body;
          return completion({ draft: "Sounds good." });
        },
      ),
    );

    const response = await draftReply(
      request("/api/ai/draft", {
        threadId: currentMailThread.id,
        intent: "Confirm the plan.",
      }),
    );

    expect(response.status).toBe(200);
    const providerRequest = JSON.parse(String(providerRequestBody)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const input = JSON.parse(
      providerRequest.messages.find((message) => message.role === "user")!
        .content,
    ) as { voiceProfile?: typeof voiceProfile };
    expect(input.voiceProfile).toEqual(voiceProfile);
    expect(JSON.stringify(input.voiceProfile)).not.toContain(
      "raw-sent-message",
    );
  });

  it("returns a recoverable error when the draft provider fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 503 })),
    );

    const response = await draftReply(
      request("/api/ai/draft", {
        threadId: currentMailThread.id,
        intent: "Confirm that Thursday works.",
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "AI_UNAVAILABLE", recoverable: true },
    });
  });
});

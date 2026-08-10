import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AIProvider,
  AskInboxEvidence,
  ClassifyInput,
  DraftInput,
  DraftReplyResult,
  OpenLoopInput,
  SummaryInput,
  VoiceProfileInput,
} from "@subzero/ai";
import {
  DemoMailProvider,
  type MailAccount,
  type MailThread,
} from "@subzero/mail";

const mocks = vi.hoisted(() => ({
  configuredAIProvider: vi.fn(),
}));

vi.mock("@/app/api/ai/_shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/api/ai/_shared")>()),
  configuredAIProvider: mocks.configuredAIProvider,
}));

import { POST } from "@/app/api/ai/ask-inbox/route";
import {
  configureMailRouteContextResolver,
  resetMailRouteContextResolverForTests,
} from "@/app/api/mail/runtime";

const account: MailAccount = {
  id: "account-ask-inbox",
  gmailAddress: "owner@example.com",
  googleSubject: "subject-ask-inbox",
};

function thread(input: {
  id: string;
  subject: string;
  from: string;
  body: string;
  messageId: string;
}): MailThread {
  return {
    id: input.id,
    latestMessageId: input.messageId,
    subject: input.subject,
    participants: [{ address: input.from }],
    preview: input.body,
    unread: true,
    labelIds: ["INBOX"],
    metadataOnly: false,
    messages: [
      {
        id: input.messageId,
        threadId: input.id,
        subject: input.subject,
        from: { address: input.from },
        to: [{ address: "owner@example.com" }],
        cc: [],
        bcc: [],
        snippet: input.body,
        body: input.body,
        labelIds: ["INBOX"],
        headers: {},
      },
    ],
  };
}

function askInboxProvider(options: {
  queries: string[];
  answer?: (input: AskInboxEvidence) => {
    answer: string;
    confidence: number;
    sourceMessageIds: string[];
  };
}) {
  const answerInbox = vi.fn(
    async (input: AskInboxEvidence) =>
      options.answer?.(input) ?? {
        answer: "Alex agreed to $4,800 if onboarding is included.",
        confidence: 0.94,
        sourceMessageIds: [input.evidence[0].messageId],
      },
  );
  const notUsed = async () => {
    throw new Error("not used by Ask Inbox");
  };
  return {
    provider: {
      id: "fixture-provider",
      classifyThread: notUsed as (input: ClassifyInput) => Promise<never>,
      summarizeThread: notUsed as (input: SummaryInput) => Promise<never>,
      draftReply: notUsed as (input: DraftInput) => Promise<DraftReplyResult>,
      extractOpenLoops: notUsed as (input: OpenLoopInput) => Promise<never>,
      createVoiceProfile: notUsed as (
        input: VoiceProfileInput,
      ) => Promise<never>,
      generateMailQueries: async () => options.queries,
      answerInbox,
    } satisfies AIProvider,
    answerInbox,
  };
}

function request(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/ai/ask-inbox", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  resetMailRouteContextResolverForTests();
});

describe("P1.1 Ask Inbox route", () => {
  it("retrieves through bounded Gmail queries and returns only verified source mappings", async () => {
    const pricing = thread({
      id: "thread-pricing",
      messageId: "message-price",
      subject: "Re: launch pricing",
      from: "alex@northstar.io",
      body: "$4,800 works if onboarding is included.",
    });
    const unrelated = thread({
      id: "thread-unrelated",
      messageId: "message-unrelated",
      subject: "Team lunch",
      from: "jordan@example.com",
      body: "The cafeteria has a new menu.",
    });
    const mailProvider = new DemoMailProvider({
      account,
      threads: [pricing, unrelated],
    });
    configureMailRouteContextResolver(() => ({
      account,
      provider: mailProvider,
    }));
    const { provider, answerInbox } = askInboxProvider({
      queries: ["from:alex", "pricing"],
    });
    mocks.configuredAIProvider.mockResolvedValue(provider);

    const response = await POST(
      request({ question: "What price did Alex finally agree to?" }),
    );
    const body = (await response.json()) as {
      ok: boolean;
      data: {
        answer: string;
        confidence: number;
        sourceMessageIds: string[];
        sources: Array<{ messageId: string; threadId: string }>;
        retrieval: { queryCount: number; candidateThreadCount: number };
      };
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      data: {
        answer: "Alex agreed to $4,800 if onboarding is included.",
        confidence: 0.94,
        sourceMessageIds: ["message-price"],
        sources: [{ messageId: "message-price", threadId: "thread-pricing" }],
        retrieval: {
          queryCount: 2,
          candidateThreadCount: 1,
          evidenceCount: 1,
        },
      },
    });
    expect(mailProvider.searchQueries).toEqual(["from:alex", "pricing"]);
    expect(answerInbox).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "What price did Alex finally agree to?",
        evidence: [
          expect.objectContaining({
            messageId: "message-price",
            threadId: "thread-pricing",
          }),
        ],
      }),
    );
    expect(JSON.stringify(answerInbox.mock.calls[0][0])).not.toContain(
      "cafeteria",
    );
  });

  it("returns a clear no-evidence state without asking a provider to fabricate an answer", async () => {
    const mailProvider = new DemoMailProvider({
      account,
      threads: [
        thread({
          id: "thread-pricing",
          messageId: "message-price",
          subject: "Pricing",
          from: "alex@northstar.io",
          body: "$4,800 works.",
        }),
      ],
    });
    configureMailRouteContextResolver(() => ({
      account,
      provider: mailProvider,
    }));
    const { provider, answerInbox } = askInboxProvider({
      queries: ["from:missing@example.com"],
    });
    mocks.configuredAIProvider.mockResolvedValue(provider);

    const response = await POST(
      request({ question: "What did a missing sender promise?" }),
    );
    const body = (await response.json()) as {
      ok: boolean;
      data: {
        answer: string;
        confidence: number;
        sourceMessageIds: string[];
        sources: unknown[];
      };
    };

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      answer: "Not enough evidence to answer this from the retrieved mail.",
      confidence: 0,
      sourceMessageIds: [],
      sources: [],
    });
    expect(answerInbox).not.toHaveBeenCalled();
  });

  it("rejects a source ID that the answer model did not receive as evidence", async () => {
    const pricing = thread({
      id: "thread-pricing",
      messageId: "message-price",
      subject: "Pricing",
      from: "alex@northstar.io",
      body: "$4,800 works.",
    });
    const mailProvider = new DemoMailProvider({ account, threads: [pricing] });
    configureMailRouteContextResolver(() => ({
      account,
      provider: mailProvider,
    }));
    const { provider } = askInboxProvider({
      queries: ["pricing"],
      answer: () => ({
        answer: "Alex agreed to $4,800.",
        confidence: 0.9,
        sourceMessageIds: ["not-retrieved"],
      }),
    });
    mocks.configuredAIProvider.mockResolvedValue(provider);

    const response = await POST(
      request({ question: "What price did Alex agree to?" }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "AI_UNAVAILABLE", recoverable: true },
    });
  });
});

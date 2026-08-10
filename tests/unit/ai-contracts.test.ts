import { describe, expect, it } from "vitest";

import {
  AIProviderError,
  AnthropicProvider,
  DeterministicAIProvider,
  GeminiProvider,
  OpenAICompatibleProvider,
  UnavailableAIProvider,
  collectDraft,
  createNotEnoughEvidenceAnswer,
  parseInboxAnswer,
  parseMailQueries,
  parseThreadSummary,
  parseThreadTriage,
} from "@subzero/ai";

const thread = {
  threadId: "thread-1",
  messages: [
    {
      id: "message-1",
      from: "alex@example.com",
      subject: "Pricing",
      text: "Can you send the final price?",
    },
  ],
};

const draftInput = {
  thread,
  intent: "Confirm that Thursday works.",
};

describe("AI provider contracts", () => {
  it("rejects invalid model output before it reaches inbox state", () => {
    expect(() =>
      parseThreadTriage({
        bucket: "not-a-bucket",
        confidence: 2,
        reasons: ["bad"],
        sourceMessageIds: [],
      }),
    ).toThrow(AIProviderError);
  });

  it("requires source IDs for factual outputs but permits explicit no-evidence answers", () => {
    expect(() =>
      parseInboxAnswer({
        answer: "Alex agreed to $500.",
        confidence: 0.9,
        sourceMessageIds: [],
      }),
    ).toThrow(AIProviderError);

    expect(() =>
      parseThreadSummary({
        summary: "Alex agreed to $500.",
        latestDelta: null,
        actionRequired: null,
        deadline: null,
        sourceMessageIds: [],
      }),
    ).toThrow(AIProviderError);

    expect(parseInboxAnswer(createNotEnoughEvidenceAnswer())).toMatchObject({
      confidence: 0,
      sourceMessageIds: [],
    });
  });

  it("rejects summaries longer than three sentences", () => {
    expect(() =>
      parseThreadSummary({
        summary: "One. Two. Three. Four.",
        latestDelta: null,
        actionRequired: null,
        deadline: null,
        sourceMessageIds: ["message-1"],
      }),
    ).toThrow(AIProviderError);
  });

  it("bounds generated Ask Inbox queries to one through three unique queries", async () => {
    const provider = new DeterministicAIProvider();
    const queries = await provider.generateMailQueries({
      question: "What price did Alex agree to?",
    });

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("What price did Alex agree to");
    expect(() => parseMailQueries(["a", "b", "c", "d"])).toThrow(
      AIProviderError,
    );
    expect(() => parseMailQueries(["a", "A"])).toThrow(AIProviderError);
  });

  it("bounds Ask Inbox evidence before it can become a mailbox dump", async () => {
    const provider = new DeterministicAIProvider();
    await expect(
      provider.answerInbox({
        question: "Who am I waiting on?",
        evidence: Array.from({ length: 21 }, (_, index) => ({
          messageId: `message-${index}`,
          threadId: `thread-${index}`,
          text: "A bounded evidence item.",
        })),
      }),
    ).rejects.toMatchObject({ code: "invalid_output", recoverable: true });
  });

  it("returns recoverable provider failures and supports cancellation", async () => {
    const unavailable = new UnavailableAIProvider();
    await expect(unavailable.draftReply(draftInput)).rejects.toMatchObject({
      code: "unavailable",
      recoverable: true,
    });

    const controller = new AbortController();
    const draft = await new DeterministicAIProvider().draftReply({
      ...draftInput,
      signal: controller.signal,
    });
    controller.abort();
    await expect(collectDraft(draft, controller.signal)).rejects.toMatchObject({
      code: "aborted",
      recoverable: true,
    });
  });

  it("keeps provider requests data-only with no tool-call surface", async () => {
    let body: Record<string, unknown> | undefined;
    const fakeFetch: typeof fetch = async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  bucket: "needs_reply",
                  confidence: 0.8,
                  reasons: ["The latest message asks a question."],
                  sourceMessageIds: ["message-1"],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const provider = new OpenAICompatibleProvider({
      apiKey: "test-key",
      model: "test-model",
      baseUrl: "https://provider.invalid/v1",
      fetch: fakeFetch,
    });

    await expect(provider.classifyThread({ thread })).resolves.toMatchObject({
      bucket: "needs_reply",
      sourceMessageIds: ["message-1"],
    });
    expect(body).toBeDefined();
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("functions");
  });

  it("normalizes Anthropic and Gemini JSON responses through the same contract", async () => {
    const triage = {
      bucket: "needs_reply",
      confidence: 0.8,
      reasons: ["The latest message asks a question."],
      sourceMessageIds: ["message-1"],
    };
    const cases = [
      {
        provider: new AnthropicProvider({
          apiKey: "test-key",
          model: "test-model",
          fetch: (async () =>
            new Response(
              JSON.stringify({
                content: [{ type: "text", text: JSON.stringify(triage) }],
              }),
              { status: 200 },
            )) as typeof fetch,
        }),
        id: "anthropic",
      },
      {
        provider: new GeminiProvider({
          apiKey: "test-key",
          model: "test-model",
          fetch: (async () =>
            new Response(
              JSON.stringify({
                candidates: [
                  { content: { parts: [{ text: JSON.stringify(triage) }] } },
                ],
              }),
              { status: 200 },
            )) as typeof fetch,
        }),
        id: "gemini",
      },
    ];

    for (const { provider, id } of cases) {
      await expect(provider.classifyThread({ thread })).resolves.toMatchObject({
        bucket: "needs_reply",
        sourceMessageIds: ["message-1"],
      });
      expect(provider.id).toBe(id);
    }
  });
});

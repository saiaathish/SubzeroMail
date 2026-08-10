import { describe, expect, it, vi } from "vitest";

import type {
  AIProvider,
  AskInboxEvidence,
  AskInboxQuery,
  ClassifyInput,
  DraftInput,
  DraftReplyResult,
  OpenLoopInput,
  SummaryInput,
  VoiceProfileInput,
} from "@subzero/ai";
import type {
  CreateDraftInput,
  ListThreadsInput,
  MailDraft,
  MailProvider,
  MailThread,
  SearchResult,
  SendResult,
} from "@subzero/mail";
import {
  ASK_INBOX_LIMITS,
  AskInboxServiceError,
  answerAskInbox,
  validateAskInboxQuestion,
} from "@/app/api/ai/ask-inbox/service";

function fixtureThread(id: string, messageCount = 1): MailThread {
  return {
    id,
    latestMessageId: `${id}-message-${messageCount}`,
    subject: `Pricing evidence for ${id}`,
    participants: [{ address: "alex@example.com", name: "Alex" }],
    preview: "$4,800 works if onboarding is included.",
    unread: true,
    labelIds: ["INBOX"],
    metadataOnly: false,
    messages: Array.from({ length: messageCount }, (_, index) => ({
      id: `${id}-message-${index + 1}`,
      threadId: id,
      subject: `Pricing evidence for ${id}`,
      from: { address: "alex@example.com", name: "Alex" },
      to: [{ address: "owner@example.com" }],
      cc: [],
      bcc: [],
      snippet: `$4,800 works in message ${index + 1}.`,
      body: `$4,800 works in message ${index + 1}. ${"evidence ".repeat(400)}`,
      labelIds: ["INBOX"],
      headers: {},
    })),
  };
}

function noOpMailProvider(
  search: (
    query: string,
    input?: Pick<ListThreadsInput, "limit" | "pageToken">,
  ) => Promise<SearchResult[]>,
  getThread: (threadId: string) => Promise<MailThread>,
): MailProvider {
  return {
    listThreads: async () => ({ threads: [] }),
    search: (query, input) => search(query, input),
    getThread,
    archiveThread: async () => undefined,
    markRead: async () => undefined,
    markUnread: async () => undefined,
    applyLabel: async () => undefined,
    removeLabel: async () => undefined,
    createDraft: async (_input: CreateDraftInput): Promise<MailDraft> => {
      throw new Error("not used by Ask Inbox");
    },
    sendDraft: async (_draftId: string): Promise<SendResult> => {
      throw new Error("not used by Ask Inbox");
    },
  };
}

function fixtureProvider(input: {
  queries: string[];
  answer?: (request: AskInboxEvidence) => {
    answer: string;
    confidence: number;
    sourceMessageIds: string[];
  };
}) {
  const generateMailQueries = vi.fn(
    async (_input: AskInboxQuery) => input.queries,
  );
  const answerInbox = vi.fn(
    async (request: AskInboxEvidence) =>
      input.answer?.(request) ?? {
        answer: "Alex agreed to $4,800.",
        confidence: 0.9,
        sourceMessageIds: [request.evidence[0].messageId],
      },
  );
  const notUsed = async () => {
    throw new Error("not used by Ask Inbox");
  };
  return {
    provider: {
      id: "fixture",
      classifyThread: notUsed as (input: ClassifyInput) => Promise<never>,
      summarizeThread: notUsed as (input: SummaryInput) => Promise<never>,
      draftReply: notUsed as (input: DraftInput) => Promise<DraftReplyResult>,
      extractOpenLoops: notUsed as (input: OpenLoopInput) => Promise<never>,
      createVoiceProfile: notUsed as (
        input: VoiceProfileInput,
      ) => Promise<never>,
      generateMailQueries,
      answerInbox,
    } satisfies AIProvider,
    generateMailQueries,
    answerInbox,
  };
}

describe("P1.1 Ask Inbox bounded retrieval", () => {
  it("uses at most three Gmail queries, deduplicates candidates, and caps evidence before answering", async () => {
    const threads = Array.from({ length: 13 }, (_, index) =>
      fixtureThread(`thread-${String(index + 1).padStart(2, "0")}`, 3),
    );
    const byId = new Map(threads.map((thread) => [thread.id, thread]));
    const search = vi.fn(async (query: string) => {
      const offset = query === "pricing" ? 0 : query === "alex" ? 4 : 8;
      return threads.slice(offset, offset + 6).map((thread) => ({
        thread: { ...thread, metadataOnly: true, messages: [] },
        matchedMessageIds: [thread.latestMessageId],
      }));
    });
    const getThread = vi.fn(async (threadId: string) => {
      const thread = byId.get(threadId);
      if (!thread) throw new Error("missing fixture thread");
      return thread;
    });
    const mailProvider = noOpMailProvider(search, getThread);
    const { provider, answerInbox } = fixtureProvider({
      queries: ["pricing", "alex", "onboarding"],
    });

    const result = await answerAskInbox({
      provider,
      mailProvider,
      question: "What price did Alex agree to for onboarding?",
    });

    expect(search).toHaveBeenCalledTimes(3);
    expect(search).toHaveBeenNthCalledWith(1, "pricing", {
      limit: ASK_INBOX_LIMITS.maxSearchResultsPerQuery,
    });
    expect(getThread).toHaveBeenCalledTimes(
      ASK_INBOX_LIMITS.maxCandidateThreads,
    );
    expect(answerInbox).toHaveBeenCalledTimes(1);
    const sentEvidence = answerInbox.mock.calls[0][0].evidence;
    expect(sentEvidence).toHaveLength(ASK_INBOX_LIMITS.maxEvidenceItems);
    expect(
      sentEvidence.every(
        (item) => item.text.length <= ASK_INBOX_LIMITS.maxCharactersPerMessage,
      ),
    ).toBe(true);
    expect(
      sentEvidence.reduce((total, item) => total + item.text.length, 0),
    ).toBeLessThanOrEqual(ASK_INBOX_LIMITS.maxEvidenceCharacters);
    expect(result.retrieval).toEqual({
      queryCount: 3,
      candidateThreadCount: 13,
      evidenceCount: ASK_INBOX_LIMITS.maxEvidenceItems,
    });
    expect(result.sources).toEqual([
      {
        messageId: result.answer.sourceMessageIds[0],
        threadId: sentEvidence[0].threadId,
      },
    ]);
  });

  it("returns an explicit no-evidence result without making an answering call", async () => {
    const search = vi.fn(async () => [] as SearchResult[]);
    const getThread = vi.fn(async () => fixtureThread("unused"));
    const { provider, answerInbox } = fixtureProvider({ queries: ["missing"] });

    const result = await answerAskInbox({
      provider,
      mailProvider: noOpMailProvider(search, getThread),
      question: "What was never discussed?",
    });

    expect(answerInbox).not.toHaveBeenCalled();
    expect(getThread).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      answer: {
        answer: "Not enough evidence to answer this from the retrieved mail.",
        confidence: 0,
        sourceMessageIds: [],
      },
      sources: [],
      retrieval: { queryCount: 1, candidateThreadCount: 0, evidenceCount: 0 },
    });
  });

  it("rejects model citations that are not part of the retrieved evidence", async () => {
    const thread = fixtureThread("thread-1");
    const { provider } = fixtureProvider({
      queries: ["pricing"],
      answer: () => ({
        answer: "Alex agreed to $4,800.",
        confidence: 0.9,
        sourceMessageIds: ["invented-message"],
      }),
    });

    await expect(
      answerAskInbox({
        provider,
        mailProvider: noOpMailProvider(
          async () => [
            {
              thread: { ...thread, metadataOnly: true, messages: [] },
              matchedMessageIds: [thread.latestMessageId],
            },
          ],
          async () => thread,
        ),
        question: "What price did Alex agree to?",
      }),
    ).rejects.toBeInstanceOf(AskInboxServiceError);
  });

  it("rejects oversized questions before Gmail or an AI provider is called", async () => {
    const { provider, generateMailQueries } = fixtureProvider({
      queries: ["pricing"],
    });
    const search = vi.fn(async () => [] as SearchResult[]);

    expect(() =>
      validateAskInboxQuestion(
        "x".repeat(ASK_INBOX_LIMITS.maxQuestionCharacters + 1),
      ),
    ).toThrow(AskInboxServiceError);
    await expect(
      answerAskInbox({
        provider,
        mailProvider: noOpMailProvider(search, async () => fixtureThread("x")),
        question: "x".repeat(ASK_INBOX_LIMITS.maxQuestionCharacters + 1),
      }),
    ).rejects.toBeInstanceOf(AskInboxServiceError);
    expect(generateMailQueries).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });
});

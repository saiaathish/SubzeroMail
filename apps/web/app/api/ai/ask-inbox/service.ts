import {
  createNotEnoughEvidenceAnswer,
  MailQueriesSchema,
  type AIProvider,
  type InboxAnswer,
  type InboxEvidence,
} from "@subzero/ai";
import type {
  MailMessage,
  MailProvider,
  MailThread,
  SearchResult,
} from "@subzero/mail";

/**
 * Ask Inbox intentionally uses Gmail retrieval rather than a mailbox mirror or
 * vector database. These caps are part of the privacy boundary: only a small,
 * ranked evidence set can reach a provider.
 */
export const ASK_INBOX_LIMITS = {
  maxQuestionCharacters: 1_000,
  maxSearchResultsPerQuery: 10,
  maxCandidateThreads: 12,
  maxEvidenceItems: 20,
  maxEvidenceCharacters: 40_000,
  maxCharactersPerMessage: 2_000,
} as const;

export type AskInboxSource = {
  messageId: string;
  threadId: string;
};

export type AskInboxResult = {
  answer: InboxAnswer;
  sources: AskInboxSource[];
  retrieval: {
    queryCount: number;
    candidateThreadCount: number;
    evidenceCount: number;
  };
};

export class AskInboxServiceError extends Error {}

type CandidateThread = {
  thread: MailThread;
  matchedMessageIds: Set<string>;
};

type EvidenceCandidate = InboxEvidence & {
  score: number;
  messageIndex: number;
};

const tokenPattern = /[\p{L}\p{N}@._+-]{2,}/gu;

function searchTerms(question: string): string[] {
  const unique = new Set(
    (question.toLowerCase().match(tokenPattern) ?? []).filter(
      (token) =>
        !new Set([
          "about",
          "after",
          "before",
          "from",
          "have",
          "that",
          "this",
          "what",
          "when",
          "where",
          "which",
          "who",
          "with",
          "would",
          "your",
        ]).has(token),
    ),
  );
  return [...unique].slice(0, 16);
}

function scoreText(value: string, terms: readonly string[]): number {
  const normalized = value.toLowerCase();
  return terms.reduce(
    (score, term) => score + (normalized.includes(term) ? 1 : 0),
    0,
  );
}

function scoreThread(thread: MailThread, terms: readonly string[]): number {
  return (
    scoreText(
      [
        thread.subject,
        thread.preview,
        ...thread.participants.map((participant) => participant.address),
      ].join(" "),
      terms,
    ) + (thread.unread ? 0.2 : 0)
  );
}

function messageText(message: MailMessage): string {
  return (message.body ?? message.snippet).trim().replace(/\s+/g, " ");
}

function candidateThreads(results: readonly SearchResult[]): CandidateThread[] {
  const byThreadId = new Map<string, CandidateThread>();
  for (const result of results) {
    const existing = byThreadId.get(result.thread.id);
    if (existing) {
      result.matchedMessageIds.forEach((id) =>
        existing.matchedMessageIds.add(id),
      );
      continue;
    }
    byThreadId.set(result.thread.id, {
      thread: result.thread,
      matchedMessageIds: new Set(result.matchedMessageIds),
    });
  }
  return [...byThreadId.values()];
}

function rankCandidateThreads(
  candidates: readonly CandidateThread[],
  terms: readonly string[],
): CandidateThread[] {
  return [...candidates]
    .map((candidate) => ({
      candidate,
      score:
        scoreThread(candidate.thread, terms) +
        Math.min(candidate.matchedMessageIds.size, 3) * 0.1,
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.candidate.thread.latestMessageId.localeCompare(
          left.candidate.thread.latestMessageId,
        ) ||
        left.candidate.thread.id.localeCompare(right.candidate.thread.id),
    )
    .slice(0, ASK_INBOX_LIMITS.maxCandidateThreads)
    .map(({ candidate }) => candidate);
}

function rankEvidence(
  thread: MailThread,
  matchedMessageIds: ReadonlySet<string>,
  terms: readonly string[],
): EvidenceCandidate[] {
  return thread.messages
    .map((message, messageIndex) => {
      const text = messageText(message);
      if (!text) return null;
      return {
        messageId: message.id,
        threadId: thread.id,
        text: text.slice(0, ASK_INBOX_LIMITS.maxCharactersPerMessage),
        score:
          scoreText(`${message.subject} ${text}`, terms) +
          (matchedMessageIds.has(message.id) ? 4 : 0),
        messageIndex,
      };
    })
    .filter((candidate): candidate is EvidenceCandidate => candidate !== null);
}

function boundedEvidence(
  candidates: readonly EvidenceCandidate[],
): InboxEvidence[] {
  let characters = 0;
  const result: InboxEvidence[] = [];
  for (const candidate of [...candidates].sort(
    (left, right) =>
      right.score - left.score ||
      right.messageIndex - left.messageIndex ||
      left.messageId.localeCompare(right.messageId),
  )) {
    if (result.length >= ASK_INBOX_LIMITS.maxEvidenceItems) break;
    if (
      characters + candidate.text.length >
      ASK_INBOX_LIMITS.maxEvidenceCharacters
    ) {
      continue;
    }
    result.push({
      messageId: candidate.messageId,
      threadId: candidate.threadId,
      text: candidate.text,
    });
    characters += candidate.text.length;
  }
  return result;
}

export function validateAskInboxQuestion(question: string): string {
  const trimmed = question.trim();
  if (!trimmed) {
    throw new AskInboxServiceError("question is required.");
  }
  if (trimmed.length > ASK_INBOX_LIMITS.maxQuestionCharacters) {
    throw new AskInboxServiceError(
      `question must be ${ASK_INBOX_LIMITS.maxQuestionCharacters} characters or fewer.`,
    );
  }
  return trimmed;
}

function verifiedAnswer(
  answer: InboxAnswer,
  evidence: readonly InboxEvidence[],
): AskInboxResult["answer"] {
  const availableIds = new Set(evidence.map((item) => item.messageId));
  const sourceMessageIds = [...new Set(answer.sourceMessageIds)];
  if (sourceMessageIds.some((id) => !availableIds.has(id))) {
    throw new AskInboxServiceError(
      "Ask Inbox received an answer with unsupported source evidence.",
    );
  }
  return { ...answer, sourceMessageIds };
}

/**
 * Retrieves a small evidence set using only provider-generated Gmail queries,
 * then runs a cheap deterministic reranker before asking the provider to answer.
 * It never sends a complete mailbox, raw HTML, or data from unselected threads.
 */
export async function answerAskInbox(input: {
  provider: AIProvider;
  mailProvider: MailProvider;
  question: string;
  signal?: AbortSignal;
}): Promise<AskInboxResult> {
  const question = validateAskInboxQuestion(input.question);
  const queries = MailQueriesSchema.parse(
    await input.provider.generateMailQueries({
      question,
      signal: input.signal,
    }),
  );
  const searchResults = await Promise.all(
    queries.map((query) =>
      input.mailProvider.search(query, {
        limit: ASK_INBOX_LIMITS.maxSearchResultsPerQuery,
      }),
    ),
  );
  const allCandidates = candidateThreads(searchResults.flat());
  const rankedCandidates = rankCandidateThreads(
    allCandidates,
    searchTerms(question),
  );
  const hydratedCandidates = await Promise.all(
    rankedCandidates.map(async (candidate) => ({
      thread: await input.mailProvider.getThread(candidate.thread.id),
      matchedMessageIds: candidate.matchedMessageIds,
    })),
  );
  const evidence = boundedEvidence(
    hydratedCandidates.flatMap(({ thread, matchedMessageIds }) =>
      rankEvidence(thread, matchedMessageIds, searchTerms(question)),
    ),
  );
  const retrieval = {
    queryCount: queries.length,
    candidateThreadCount: allCandidates.length,
    evidenceCount: evidence.length,
  };
  if (evidence.length === 0) {
    return {
      answer: createNotEnoughEvidenceAnswer(),
      sources: [],
      retrieval,
    };
  }

  const answer = verifiedAnswer(
    await input.provider.answerInbox({
      question,
      evidence,
      signal: input.signal,
    }),
    evidence,
  );
  const evidenceById = new Map(evidence.map((item) => [item.messageId, item]));
  return {
    answer,
    sources: answer.sourceMessageIds.map((messageId) => {
      const source = evidenceById.get(messageId);
      if (!source) {
        // verifiedAnswer above makes this branch impossible; retain the guard so
        // source chips can never point at an untrusted or unrelated thread.
        throw new AskInboxServiceError(
          "Ask Inbox source mapping was unavailable.",
        );
      }
      return { messageId, threadId: source.threadId };
    }),
    retrieval,
  };
}

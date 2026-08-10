import z from "zod";

import { AIProviderError, throwIfAborted, toAIProviderError } from "./errors";
import {
  type InboxAnswer,
  type OpenLoopCandidate,
  type ThreadTriage,
  type ThreadSummary,
  type VoiceProfile,
  InboxAnswerSchema,
  MailQueriesSchema,
  OpenLoopCandidateSchema,
  ThreadSummarySchema,
  ThreadTriageSchema,
  VoiceProfileSchema,
} from "./schemas";

export interface MailMessageContext {
  id: string;
  from?: string;
  to?: string[];
  sentAt?: string;
  subject?: string;
  text: string;
}

export interface MailThreadContext {
  threadId: string;
  messages: readonly MailMessageContext[];
}

export interface ClassifyInput {
  thread: MailThreadContext;
  signal?: AbortSignal;
}

export interface SummaryInput {
  thread: MailThreadContext;
  previousSummary?: ThreadSummary;
  signal?: AbortSignal;
}

export interface DraftInput {
  thread: MailThreadContext;
  intent: string;
  voiceProfile?: VoiceProfile;
  signal?: AbortSignal;
}

export interface OpenLoopInput {
  thread: MailThreadContext;
  signal?: AbortSignal;
}

export interface VoiceProfileSample {
  id: string;
  text: string;
}

export interface VoiceProfileInput {
  samples: readonly VoiceProfileSample[];
  signal?: AbortSignal;
}

export interface AskInboxQuery {
  question: string;
  signal?: AbortSignal;
}

export interface InboxEvidence {
  messageId: string;
  threadId: string;
  text: string;
}

export interface AskInboxEvidence {
  question: string;
  /** Top-ranked evidence only. Never pass an entire mailbox. */
  evidence: readonly InboxEvidence[];
  signal?: AbortSignal;
}

export type DraftReplyResult = string | AsyncIterable<string>;

/**
 * Provider-neutral boundary. It has no tool-call surface: providers return
 * validated data or draft text, while mail mutations remain outside this package.
 */
export interface AIProvider {
  readonly id: string;
  classifyThread(input: ClassifyInput): Promise<ThreadTriage>;
  summarizeThread(input: SummaryInput): Promise<ThreadSummary>;
  draftReply(input: DraftInput): Promise<DraftReplyResult>;
  extractOpenLoops(input: OpenLoopInput): Promise<OpenLoopCandidate[]>;
  createVoiceProfile(input: VoiceProfileInput): Promise<VoiceProfile>;
  generateMailQueries(input: AskInboxQuery): Promise<string[]>;
  answerInbox(input: AskInboxEvidence): Promise<InboxAnswer>;
}

const MAX_EVIDENCE_ITEMS = 20;
const MAX_EVIDENCE_CHARACTERS = 50_000;

const assertNonEmpty = (value: string, field: string) => {
  if (!value.trim()) {
    throw new AIProviderError("invalid_output", `${field} must not be empty.`);
  }
};

export const validateClassifyInput = (input: ClassifyInput): void => {
  throwIfAborted(input.signal);
  assertNonEmpty(input.thread.threadId, "threadId");
  if (input.thread.messages.length === 0) {
    throw new AIProviderError(
      "invalid_output",
      "Thread input requires a message.",
    );
  }
};

export const validateSummaryInput = (input: SummaryInput): void =>
  validateClassifyInput(input);

export const validateDraftInput = (input: DraftInput): void => {
  validateClassifyInput(input);
  assertNonEmpty(input.intent, "intent");
};

export const validateOpenLoopInput = (input: OpenLoopInput): void =>
  validateClassifyInput(input);

export const validateVoiceProfileInput = (input: VoiceProfileInput): void => {
  throwIfAborted(input.signal);
  if (input.samples.length < 20 || input.samples.length > 50) {
    throw new AIProviderError(
      "invalid_output",
      "Voice profile creation requires 20–50 sampled sent messages.",
    );
  }
  input.samples.forEach((sample) => {
    assertNonEmpty(sample.id, "voice profile sample id");
    assertNonEmpty(sample.text, "voice profile sample text");
  });
};

export const validateAskInboxQuery = (input: AskInboxQuery): void => {
  throwIfAborted(input.signal);
  assertNonEmpty(input.question, "question");
};

export const validateAskInboxEvidence = (input: AskInboxEvidence): void => {
  throwIfAborted(input.signal);
  assertNonEmpty(input.question, "question");
  if (input.evidence.length > MAX_EVIDENCE_ITEMS) {
    throw new AIProviderError(
      "invalid_output",
      `Ask Inbox evidence is bounded to ${MAX_EVIDENCE_ITEMS} messages.`,
    );
  }
  input.evidence.forEach((item) => {
    assertNonEmpty(item.messageId, "evidence messageId");
    assertNonEmpty(item.threadId, "evidence threadId");
    assertNonEmpty(item.text, "evidence text");
  });
  const evidenceCharacters = input.evidence.reduce(
    (total, item) => total + item.text.length,
    0,
  );
  if (evidenceCharacters > MAX_EVIDENCE_CHARACTERS) {
    throw new AIProviderError(
      "invalid_output",
      "Ask Inbox evidence exceeds the bounded evidence budget.",
    );
  }
};

export const parseProviderOutput = <T>(
  schema: z.ZodType<T>,
  raw: unknown,
  outputName: string,
): T => {
  let value = raw;

  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw new AIProviderError(
        "invalid_output",
        `${outputName} was not valid JSON.`,
        {
          cause: error,
        },
      );
    }
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AIProviderError(
      "invalid_output",
      `${outputName} did not match the required schema: ${parsed.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }

  return parsed.data;
};

export const parseThreadTriage = (raw: unknown): ThreadTriage =>
  parseProviderOutput(ThreadTriageSchema, raw, "Thread triage");

export const parseThreadSummary = (raw: unknown): ThreadSummary =>
  parseProviderOutput(ThreadSummarySchema, raw, "Thread summary");

export const parseInboxAnswer = (raw: unknown): InboxAnswer =>
  parseProviderOutput(InboxAnswerSchema, raw, "Inbox answer");

export const parseOpenLoopCandidates = (raw: unknown): OpenLoopCandidate[] =>
  parseProviderOutput(
    z.array(OpenLoopCandidateSchema),
    raw,
    "Open Loop candidates",
  );

export const parseVoiceProfile = (raw: unknown): VoiceProfile =>
  parseProviderOutput(VoiceProfileSchema, raw, "Voice profile");

export const parseMailQueries = (raw: unknown): string[] =>
  parseProviderOutput(MailQueriesSchema, raw, "Mail queries");

export const isAsyncIterable = (
  value: DraftReplyResult,
): value is AsyncIterable<string> =>
  typeof value !== "string" && Symbol.asyncIterator in value;

export async function* streamText(
  value: string,
  options: { signal?: AbortSignal; chunkSize?: number } = {},
): AsyncIterable<string> {
  const chunkSize = options.chunkSize ?? 64;
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new AIProviderError(
      "invalid_output",
      "Draft stream chunk size must be positive.",
    );
  }

  for (let start = 0; start < value.length; start += chunkSize) {
    throwIfAborted(options.signal);
    yield value.slice(start, start + chunkSize);
  }
}

export const collectDraft = async (
  result: DraftReplyResult,
  signal?: AbortSignal,
): Promise<string> => {
  throwIfAborted(signal);
  if (!isAsyncIterable(result)) {
    return result;
  }

  let draft = "";
  try {
    for await (const chunk of result) {
      throwIfAborted(signal);
      draft += chunk;
    }
  } catch (error) {
    throw toAIProviderError(error);
  }

  return draft;
};

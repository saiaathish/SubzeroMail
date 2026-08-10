import { AIProviderError, throwIfAborted } from "../errors";
import {
  type AIProvider,
  type AskInboxEvidence,
  type AskInboxQuery,
  type ClassifyInput,
  type DraftInput,
  type DraftReplyResult,
  type OpenLoopInput,
  type SummaryInput,
  type VoiceProfileInput,
  streamText,
  validateAskInboxEvidence,
  validateAskInboxQuery,
  validateClassifyInput,
  validateDraftInput,
  validateOpenLoopInput,
  validateSummaryInput,
  validateVoiceProfileInput,
} from "../provider";
import type {
  InboxAnswer,
  OpenLoopCandidate,
  ThreadTriage,
  ThreadSummary,
  VoiceProfile,
} from "../schemas";
import { createNotEnoughEvidenceAnswer } from "../schemas";

export interface DeterministicAIProviderOptions {
  /** Useful for exercising manual-email recovery paths in demo and tests. */
  unavailable?: boolean;
  draft?: string;
  openLoops?: readonly OpenLoopCandidate[];
}

const conciseText = (value: string, fallback: string) => {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return fallback;
  }

  const sentence = trimmed.match(/^.*?[.!?](?:\s|$)/)?.[0] ?? trimmed;
  return sentence.slice(0, 800).trim();
};

const lastMessage = (
  input: ClassifyInput | SummaryInput | DraftInput | OpenLoopInput,
) => input.thread.messages[input.thread.messages.length - 1];

/**
 * Offline, predictable provider. It never performs network I/O and is safe for
 * tests, demos, and provider-outage UI paths.
 */
export class DeterministicAIProvider implements AIProvider {
  readonly id = "deterministic";
  private readonly options: DeterministicAIProviderOptions;

  constructor(options: DeterministicAIProviderOptions = {}) {
    this.options = options;
  }

  private ensureAvailable(signal?: AbortSignal): void {
    throwIfAborted(signal);
    if (this.options.unavailable) {
      throw new AIProviderError(
        "unavailable",
        "AI provider is unavailable. Continue with manual mail actions.",
      );
    }
  }

  async classifyThread(input: ClassifyInput): Promise<ThreadTriage> {
    validateClassifyInput(input);
    this.ensureAvailable(input.signal);
    const message = lastMessage(input);
    const text = `${message.subject ?? ""} ${message.text}`.toLowerCase();
    const bucket = /\b(question|please|can you|could you|need|reply)\b/.test(
      text,
    )
      ? "needs_reply"
      : "other";

    return {
      bucket,
      confidence: 0.5,
      reasons: [
        bucket === "needs_reply"
          ? "The latest message contains a request indicator."
          : "No deterministic priority signal was found.",
      ],
      sourceMessageIds: [message.id],
    };
  }

  async summarizeThread(input: SummaryInput): Promise<ThreadSummary> {
    validateSummaryInput(input);
    this.ensureAvailable(input.signal);
    const message = lastMessage(input);
    return {
      summary: conciseText(
        message.text,
        "No readable message content is available.",
      ),
      latestDelta: null,
      actionRequired: null,
      deadline: null,
      sourceMessageIds: [message.id],
    };
  }

  async draftReply(input: DraftInput): Promise<DraftReplyResult> {
    validateDraftInput(input);
    this.ensureAvailable(input.signal);
    const draft =
      this.options.draft ??
      `Thanks for your message. ${input.intent.trim()}\n\nBest,`;
    return streamText(draft, { signal: input.signal });
  }

  async extractOpenLoops(input: OpenLoopInput): Promise<OpenLoopCandidate[]> {
    validateOpenLoopInput(input);
    this.ensureAvailable(input.signal);
    return [...(this.options.openLoops ?? [])];
  }

  async createVoiceProfile(input: VoiceProfileInput): Promise<VoiceProfile> {
    validateVoiceProfileInput(input);
    this.ensureAvailable(input.signal);
    return {
      formality: "neutral",
      averageLength: "medium",
      greetingPatterns: [],
      signoffPatterns: [],
      directness: 0.5,
      formattingNotes: ["Keep replies concise and clear."],
    };
  }

  async generateMailQueries(input: AskInboxQuery): Promise<string[]> {
    validateAskInboxQuery(input);
    this.ensureAvailable(input.signal);
    const query = input.question
      .trim()
      .replace(/[^\p{L}\p{N}\s@._:+\-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
    return [query || "in:anywhere"];
  }

  async answerInbox(input: AskInboxEvidence): Promise<InboxAnswer> {
    validateAskInboxEvidence(input);
    this.ensureAvailable(input.signal);
    if (input.evidence.length === 0) {
      return createNotEnoughEvidenceAnswer();
    }

    const sourceMessageIds = input.evidence.map((item) => item.messageId);
    return {
      answer: `Found ${sourceMessageIds.length} retrieved message${
        sourceMessageIds.length === 1 ? "" : "s"
      } relevant to this question.`,
      confidence: 0.5,
      sourceMessageIds,
    };
  }
}

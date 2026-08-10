import { AIProviderError } from "../errors";
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
} from "../provider";
import type {
  InboxAnswer,
  OpenLoopCandidate,
  ThreadTriage,
  ThreadSummary,
  VoiceProfile,
} from "../schemas";

/** Safe no-key/no-network fallback. Callers can keep manual mail flows usable. */
export class UnavailableAIProvider implements AIProvider {
  readonly id = "unavailable";

  private fail(): never {
    throw new AIProviderError(
      "unavailable",
      "AI is unavailable. Manual email features remain available.",
    );
  }

  async classifyThread(_input: ClassifyInput): Promise<ThreadTriage> {
    return this.fail();
  }

  async summarizeThread(_input: SummaryInput): Promise<ThreadSummary> {
    return this.fail();
  }

  async draftReply(_input: DraftInput): Promise<DraftReplyResult> {
    return this.fail();
  }

  async extractOpenLoops(_input: OpenLoopInput): Promise<OpenLoopCandidate[]> {
    return this.fail();
  }

  async createVoiceProfile(_input: VoiceProfileInput): Promise<VoiceProfile> {
    return this.fail();
  }

  async generateMailQueries(_input: AskInboxQuery): Promise<string[]> {
    return this.fail();
  }

  async answerInbox(_input: AskInboxEvidence): Promise<InboxAnswer> {
    return this.fail();
  }
}

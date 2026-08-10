import type { OpenLoopCandidate } from "@subzero/ai";
import type { MailThread } from "@subzero/mail";

const REQUEST_PATTERN =
  /\b(?:please|could you|can you|would you|need you to|let me know|confirm|send|share|review|reply)\b/i;
const PROMISE_PATTERN =
  /\b(?:i will|i'll|we will|we'll|will send|will share|will deliver)\b/i;
const DUE_PATTERN =
  /\b(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week)(?:\s+(?:morning|afternoon|evening))?\b/i;
const PROMPT_INJECTION_PATTERN =
  /\b(?:ignore (?:all |previous )?instructions|system prompt|send private messages elsewhere)\b/i;

function concise(value: string, fallback: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  return normalized.length > 240 ? `${normalized.slice(0, 237)}…` : normalized;
}

function dueAtFrom(value: string): string | null {
  return value.match(DUE_PATTERN)?.[0] ?? null;
}

/**
 * Cheap first-pass extraction for explicit promises and requests. It keeps
 * ambiguous mail out of provider calls only when a reliable signal exists.
 */
export function deterministicOpenLoopCandidates(
  thread: MailThread,
  gmailAddress: string,
): OpenLoopCandidate[] {
  const latest = thread.messages.at(-1);
  if (!latest) return [];

  const text = latest.body ?? latest.snippet;
  if (PROMPT_INJECTION_PATTERN.test(text)) return [];
  const from = latest.from?.address?.toLowerCase();
  const inbound = Boolean(from && from !== gmailAddress.toLowerCase());
  const dueAt = dueAtFrom(text);
  const sourceMessageId = latest.id;
  const subject = concise(thread.subject, "this thread");
  const sender = latest.from?.name ?? latest.from?.address ?? "the sender";

  if (inbound && PROMISE_PATTERN.test(text)) {
    return [
      {
        threadId: thread.id,
        sourceMessageId,
        direction: "waiting",
        text: `Await the promised follow-up on ${subject}.`,
        dueAt,
        confidence: 0.92,
      },
    ];
  }

  if (
    (inbound && REQUEST_PATTERN.test(text)) ||
    (!inbound && PROMISE_PATTERN.test(text))
  ) {
    return [
      {
        threadId: thread.id,
        sourceMessageId,
        direction: "i_owe",
        text: inbound
          ? `Reply to ${sender} about ${subject}.`
          : `Follow through on ${subject}.`,
        dueAt,
        confidence: inbound ? 0.9 : 0.86,
      },
    ];
  }

  return [];
}

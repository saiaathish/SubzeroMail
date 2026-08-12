import type {
  FocusClassification,
  FocusMessageInput,
  FocusReason,
  FocusReasonCode,
  FocusThreadInput,
  MailParticipant,
} from "./types";

const FOCUS_REASON_TEXT: Record<FocusReasonCode, string> = {
  newsletter_or_automated_sender: "Newsletter or automated sender",
  waiting_for_other_party: "Follow-up expected from the other party",
  unread_direct_request: "Unread direct request",
  important_label: "Marked important by Gmail",
  unread_active_thread: "Unread active thread",
  no_deterministic_priority_signal: "No deterministic priority signal",
  insufficient_thread_data: "Insufficient thread data; defaulted to Other",
};

const AUTOMATED_PATTERN =
  /(?:newsletter|unsubscribe|no[-_ ]?reply|mailer[-_ ]?daemon|notifications?@|automated message)/i;
const WAITING_PATTERN =
  /\b(?:i will|i'll|we will|we'll|will send|will share|will deliver|no action needed|waiting on)\b/i;
const REQUEST_PATTERN =
  /(?:\?|\b(?:please|could you|can you|would you|need you to|let me know|confirm|send|share|review|reply)\b)/i;

function reason(code: FocusReasonCode): FocusReason {
  return { code, text: FOCUS_REASON_TEXT[code] };
}

function result(
  bucket: FocusClassification["bucket"],
  codes: readonly FocusReasonCode[],
): FocusClassification {
  const reasonDetails = codes.map(reason);
  return {
    bucket,
    reasons: reasonDetails.map((item) => item.text),
    reasonCodes: [...codes],
    reasonDetails,
  };
}

function participantText(participant: MailParticipant | undefined): string {
  if (typeof participant === "string") return participant;
  return participant?.address ?? "";
}

function messageText(message: FocusMessageInput): string {
  return [
    message.subject,
    message.snippet,
    message.body,
    participantText(message.from),
    ...(message.to ?? []).map(participantText),
    ...(message.cc ?? []).map(participantText),
  ]
    .filter(Boolean)
    .join(" ");
}

function normalizedText(input: FocusThreadInput): string {
  return [
    input.subject,
    input.preview,
    ...(input.participants ?? []).map(participantText),
    ...(input.messages ?? []).map(messageText),
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasUsableThreadData(input: FocusThreadInput): boolean {
  return Boolean(
    input.subject?.trim() ||
    input.preview?.trim() ||
    input.labelIds?.length ||
    input.participants?.length ||
    input.messages?.length,
  );
}

/**
 * Classify a thread using stable local rules. The order is deliberate: broad
 * automated-mail signals are removed before request and unread signals run.
 */
export function classifyFocus(
  input: FocusThreadInput | null | undefined,
): FocusClassification {
  try {
    if (!input || !hasUsableThreadData(input)) {
      return result("other", ["insufficient_thread_data"]);
    }

    const labels = new Set(
      (input.labelIds ?? []).map((label) => label.trim().toUpperCase()),
    );
    const text = normalizedText(input);

    if (
      labels.has("CATEGORY_PROMOTIONS") ||
      labels.has("SPAM") ||
      labels.has("TRASH") ||
      AUTOMATED_PATTERN.test(text)
    ) {
      return result("other", ["newsletter_or_automated_sender"]);
    }

    if (WAITING_PATTERN.test(text)) {
      return result("waiting", ["waiting_for_other_party"]);
    }

    if (input.unread === true && REQUEST_PATTERN.test(text)) {
      return result("needs_reply", ["unread_direct_request"]);
    }

    if (labels.has("IMPORTANT")) {
      return result("priority", ["important_label"]);
    }

    if (input.unread === true) {
      return result("priority", ["unread_active_thread"]);
    }

    return result("other", ["no_deterministic_priority_signal"]);
  } catch {
    // Mail is untrusted input. A malformed record must never break the inbox.
    return result("other", ["insufficient_thread_data"]);
  }
}

/** Explicit alias for call sites that want the failure-safe contract by name. */
export const safeClassifyFocus = classifyFocus;

export function focusReasonText(code: FocusReasonCode): string {
  return FOCUS_REASON_TEXT[code];
}

export const focusBuckets = [
  "priority",
  "needs_reply",
  "waiting",
  "other",
] as const;

export type FocusBucket = (typeof focusBuckets)[number];

/** Stable, inspectable reasons emitted by the deterministic classifier. */
export type FocusReasonCode =
  | "newsletter_or_automated_sender"
  | "waiting_for_other_party"
  | "unread_direct_request"
  | "important_label"
  | "unread_active_thread"
  | "no_deterministic_priority_signal"
  | "insufficient_thread_data";

export interface FocusReason {
  code: FocusReasonCode;
  text: string;
}

export interface FocusClassification {
  bucket: FocusBucket;
  /** Human-readable explanations, kept compatible with existing triage data. */
  reasons: readonly string[];
  /** Stable machine-readable counterparts to `reasons`. */
  reasonCodes: readonly FocusReasonCode[];
  reasonDetails: readonly FocusReason[];
}

export type MailParticipant = string | { address: string; name?: string };

export interface FocusMessageInput {
  from?: MailParticipant;
  to?: readonly MailParticipant[];
  cc?: readonly MailParticipant[];
  body?: string;
  snippet?: string;
  subject?: string;
}

/** The metadata and recently opened content needed for local Focus decisions. */
export interface FocusThreadInput {
  subject?: string;
  preview?: string;
  unread?: boolean;
  labelIds?: readonly string[];
  participants?: readonly MailParticipant[];
  messages?: readonly FocusMessageInput[];
}

export interface ThreadRecord extends FocusThreadInput {
  id: string;
  accountId: string;
  latestMessageId: string;
  subject: string;
  preview: string;
  unread: boolean;
  labelIds: string[];
  participants: MailParticipant[];
  bucket: FocusBucket;
  focusReasons: string[];
  focusReasonCodes: FocusReasonCode[];
  historyId?: string;
  updatedAt: string;
  metadataOnly: boolean;
}

export interface MessageRecord {
  id: string;
  accountId: string;
  threadId: string;
  subject: string;
  from?: MailParticipant;
  to: MailParticipant[];
  cc: MailParticipant[];
  bcc: MailParticipant[];
  replyTo?: MailParticipant;
  sentAt?: string;
  internalDate?: number;
  snippet: string;
  labelIds: string[];
  headers: Record<string, string>;
  body?: string;
  htmlBody?: string;
  cachedAt: string;
}

export type OpenLoopDirection = "i_owe" | "they_owe" | "waiting";
export type OpenLoopStatus = "open" | "resolved";

export interface OpenLoop {
  id: string;
  accountId: string;
  threadId: string;
  sourceMessageId: string | null;
  direction: OpenLoopDirection;
  text: string;
  dueAt: string | null;
  confidence: number;
  status: OpenLoopStatus;
  createdAt: string;
  resolvedAt: string | null;
  /** Low-confidence extraction remains a user-reviewed suggestion. */
  suggestion: boolean;
}

export type SyncScope = "mailbox" | "threads" | "messages" | "history";

export interface SyncCursor {
  /** Use `${accountId}:${scope}` so a cursor is one-record-per-sync stream. */
  id: string;
  accountId: string;
  scope: SyncScope;
  cursor: string | null;
  historyId?: string;
  pageToken?: string;
  updatedAt: string;
}

export const mutationKinds = [
  "archive",
  "mark_read",
  "mark_unread",
  "apply_label",
  "remove_label",
  "create_draft",
  "send_draft",
] as const;

export type MutationKind = (typeof mutationKinds)[number];

export interface MutationPayloadByKind {
  archive: { threadId: string };
  mark_read: { threadId: string };
  mark_unread: { threadId: string };
  apply_label: { threadId: string; labelId: string };
  remove_label: { threadId: string; labelId: string };
  create_draft: { threadId?: string; draftId: string };
  send_draft: { draftId: string };
}

export type MutationPayload<K extends MutationKind> = MutationPayloadByKind[K];

export type MutationStatus =
  "pending" | "retrying" | "committed" | "failed" | "reconcile";

export type MutationFailureClass = "retryable" | "permanent";

/** A serializable, account-scoped optimistic mailbox operation. */
export type PendingMutation<K extends MutationKind = MutationKind> =
  K extends MutationKind
    ? {
        id: string;
        accountId: string;
        kind: K;
        payload: MutationPayload<K>;
        status: MutationStatus;
        attempts: number;
        createdAt: string;
        updatedAt: string;
        nextAttemptAt: string | null;
        failureClass?: MutationFailureClass;
        lastErrorCode?: string;
        reconcileReason?: string;
        committedAt?: string;
      }
    : never;

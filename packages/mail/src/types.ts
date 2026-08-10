export type MailBucket = "priority" | "needs_reply" | "waiting" | "other";

/** A single, user-authorized Gmail identity. Subzero v1 supports one only. */
export interface MailAccount {
  id: string;
  gmailAddress: string;
  googleSubject: string;
}

export interface MailAddress {
  address: string;
  name?: string;
}

/**
 * A normalized Gmail message. Bodies are absent until a thread is explicitly
 * opened, so thread-list calls stay metadata-first.
 */
export interface MailMessage {
  id: string;
  threadId: string;
  subject: string;
  from?: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  replyTo?: MailAddress;
  sentAt?: string;
  internalDate?: number;
  snippet: string;
  labelIds: string[];
  headers: Record<string, string>;
  body?: string;
  htmlBody?: string;
}

export interface MailThread {
  id: string;
  latestMessageId: string;
  subject: string;
  participants: MailAddress[];
  preview: string;
  unread: boolean;
  labelIds: string[];
  historyId?: string;
  updatedAt?: string;
  /** True when the body payload was intentionally not requested. */
  metadataOnly: boolean;
  messages: MailMessage[];
  bucket?: MailBucket;
}

export interface ListThreadsInput {
  /** Gmail page token returned by a previous call. */
  pageToken?: string;
  /** Defaults to the PRD-required recent 200 threads. */
  limit?: number;
  labelIds?: string[];
  /** Optional Gmail query. It is sent to Gmail unchanged. */
  query?: string;
}

export interface ThreadPage {
  threads: MailThread[];
  nextPageToken?: string;
  totalEstimate?: number;
}

export interface SearchResult {
  thread: MailThread;
  /** Preserves the Gmail message IDs available to evidence-backed features. */
  matchedMessageIds: string[];
}

export interface CreateDraftInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  /** Present for replies so Gmail keeps the draft in the existing thread. */
  threadId?: string;
  replyToMessageId?: string;
  references?: string[];
}

export interface MailDraft {
  id: string;
  threadId?: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  createdAt: string;
}

export interface SendResult {
  draftId: string;
  messageId: string;
  threadId?: string;
}

/**
 * PRD 12's Gmail contract. Implementations are account-bound; callers cannot
 * select or mutate another account through this interface.
 */
export interface MailProvider {
  listThreads(input?: ListThreadsInput): Promise<ThreadPage>;
  getThread(threadId: string): Promise<MailThread>;
  search(
    query: string,
    input?: Pick<ListThreadsInput, "limit" | "pageToken">,
  ): Promise<SearchResult[]>;
  archiveThread(threadId: string): Promise<void>;
  markRead(threadId: string): Promise<void>;
  markUnread(threadId: string): Promise<void>;
  applyLabel(threadId: string, labelId: string): Promise<void>;
  removeLabel(threadId: string, labelId: string): Promise<void>;
  createDraft(input: CreateDraftInput): Promise<MailDraft>;
  sendDraft(draftId: string): Promise<SendResult>;
}

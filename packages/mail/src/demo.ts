import { MailProviderError, OAuthRevokedError } from "./errors";
import type {
  CreateDraftInput,
  ListThreadsInput,
  MailAccount,
  MailDraft,
  MailMessage,
  MailProvider,
  MailThread,
  SearchResult,
  SendResult,
  ThreadPage,
} from "./types";

export interface DemoMailProviderOptions {
  account: MailAccount;
  threads?: MailThread[];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function updateLabels(
  thread: MailThread,
  update: (labels: string[]) => string[],
): void {
  thread.labelIds = update(thread.labelIds);
  thread.unread = thread.labelIds.includes("UNREAD");
  thread.messages = thread.messages.map((message) => ({
    ...message,
    labelIds: update(message.labelIds),
  }));
}

function matchesDemoQuery(thread: MailThread, query: string): boolean {
  if (query.startsWith("is:unread")) return thread.unread;
  if (query.startsWith("from:")) {
    const sender = query.slice("from:".length).split(/\s/, 1)[0].toLowerCase();
    return thread.messages.some((message) =>
      message.from?.address.toLowerCase().includes(sender),
    );
  }

  const haystack = [
    thread.subject,
    thread.preview,
    ...thread.participants.map((participant) => participant.address),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

/**
 * In-memory deterministic provider for demos and tests. It never contacts an
 * external service and remains bound to its one configured account.
 */
export class DemoMailProvider implements MailProvider {
  readonly account: MailAccount;
  readonly searchQueries: string[] = [];
  private readonly threads = new Map<string, MailThread>();
  private readonly drafts = new Map<string, MailDraft>();
  private nextDraftNumber = 1;
  private oauthRevoked = false;

  constructor(options: DemoMailProviderOptions) {
    this.account = options.account;
    for (const thread of options.threads ?? []) {
      this.threads.set(thread.id, clone(thread));
    }
  }

  setOAuthRevoked(revoked = true): void {
    this.oauthRevoked = revoked;
  }

  async listThreads(input: ListThreadsInput = {}): Promise<ThreadPage> {
    this.assertAuthorized();
    const limit = Math.max(1, input.limit ?? 200);
    const filtered = [...this.threads.values()]
      .filter(
        (thread) =>
          !input.labelIds?.length ||
          input.labelIds.every((label) => thread.labelIds.includes(label)),
      )
      .filter((thread) => !input.query || matchesDemoQuery(thread, input.query))
      .sort((left, right) =>
        (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
      );
    const offset = Number(input.pageToken ?? "0");
    const threads = filtered.slice(offset, offset + limit);
    const nextOffset = offset + threads.length;

    return {
      threads: clone(threads),
      ...(nextOffset < filtered.length
        ? { nextPageToken: String(nextOffset) }
        : {}),
      totalEstimate: filtered.length,
    };
  }

  async getThread(threadId: string): Promise<MailThread> {
    this.assertAuthorized();
    return clone(this.requireThread(threadId));
  }

  async search(
    query: string,
    input: Pick<ListThreadsInput, "limit" | "pageToken"> = {},
  ): Promise<SearchResult[]> {
    this.assertAuthorized();
    this.searchQueries.push(query);
    const page = await this.listThreads({ ...input, query });
    return page.threads.map((thread) => ({
      thread,
      matchedMessageIds: thread.messages.map((message) => message.id),
    }));
  }

  async archiveThread(threadId: string): Promise<void> {
    this.assertAuthorized();
    updateLabels(this.requireThread(threadId), (labels) =>
      labels.filter((label) => label !== "INBOX"),
    );
  }

  async markRead(threadId: string): Promise<void> {
    this.assertAuthorized();
    updateLabels(this.requireThread(threadId), (labels) =>
      labels.filter((label) => label !== "UNREAD"),
    );
  }

  async markUnread(threadId: string): Promise<void> {
    this.assertAuthorized();
    updateLabels(this.requireThread(threadId), (labels) =>
      labels.includes("UNREAD") ? labels : [...labels, "UNREAD"],
    );
  }

  async applyLabel(threadId: string, labelId: string): Promise<void> {
    this.assertAuthorized();
    updateLabels(this.requireThread(threadId), (labels) =>
      labels.includes(labelId) ? labels : [...labels, labelId],
    );
  }

  async removeLabel(threadId: string, labelId: string): Promise<void> {
    this.assertAuthorized();
    updateLabels(this.requireThread(threadId), (labels) =>
      labels.filter((label) => label !== labelId),
    );
  }

  async createDraft(input: CreateDraftInput): Promise<MailDraft> {
    this.assertAuthorized();
    if (input.to.length === 0) {
      throw new MailProviderError(
        "INVALID_DRAFT",
        "At least one recipient is required.",
        false,
      );
    }

    const draft: MailDraft = {
      id: `draft-${this.nextDraftNumber++}`,
      ...(input.threadId ? { threadId: input.threadId } : {}),
      to: [...input.to],
      cc: [...(input.cc ?? [])],
      bcc: [...(input.bcc ?? [])],
      subject: input.subject,
      body: input.body,
      createdAt: new Date(0).toISOString(),
    };
    this.drafts.set(draft.id, draft);
    return clone(draft);
  }

  async sendDraft(draftId: string): Promise<SendResult> {
    this.assertAuthorized();
    const draft = this.drafts.get(draftId);
    if (!draft) {
      throw new MailProviderError("DRAFT_NOT_FOUND", "Draft was not found.");
    }

    const messageId = `sent-${draft.id}`;
    const threadId = draft.threadId ?? `thread-${draft.id}`;
    const sentAt = new Date(0).toISOString();
    const message: MailMessage = {
      id: messageId,
      threadId,
      subject: draft.subject,
      to: draft.to.map((address) => ({ address })),
      cc: draft.cc.map((address) => ({ address })),
      bcc: draft.bcc.map((address) => ({ address })),
      snippet: draft.body,
      body: draft.body,
      labelIds: ["SENT"],
      headers: { subject: draft.subject },
      sentAt,
    };
    const existing = this.threads.get(threadId);
    if (existing) {
      existing.messages.push(message);
      existing.latestMessageId = messageId;
      existing.updatedAt = sentAt;
    } else {
      this.threads.set(threadId, {
        id: threadId,
        latestMessageId: messageId,
        subject: draft.subject,
        participants: draft.to.map((address) => ({ address })),
        preview: draft.body,
        unread: false,
        labelIds: ["SENT"],
        updatedAt: sentAt,
        metadataOnly: false,
        messages: [message],
      });
    }
    this.drafts.delete(draftId);
    return { draftId, messageId, threadId };
  }

  private requireThread(threadId: string): MailThread {
    const thread = this.threads.get(threadId);
    if (!thread) {
      throw new MailProviderError("THREAD_NOT_FOUND", "Thread was not found.");
    }
    return thread;
  }

  private assertAuthorized(): void {
    if (this.oauthRevoked) {
      throw new OAuthRevokedError();
    }
  }
}

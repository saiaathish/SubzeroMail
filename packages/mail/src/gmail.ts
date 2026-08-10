import { google } from "googleapis";

import { MailProviderError, toMailProviderError } from "./errors";
import { normalizeGmailThread, type GmailThreadLike } from "./normalize";
import type {
  CreateDraftInput,
  ListThreadsInput,
  MailAccount,
  MailDraft,
  MailProvider,
  SearchResult,
  SendResult,
  ThreadPage,
} from "./types";

export interface GmailThreadListLike {
  threads?: GmailThreadLike[] | null;
  nextPageToken?: string | null;
  resultSizeEstimate?: number | null;
}

export interface GmailDraftLike {
  id?: string | null;
  message?: { id?: string | null; threadId?: string | null } | null;
}

export interface GmailApiClient {
  users: {
    threads: {
      list(input: {
        userId: "me";
        maxResults: number;
        pageToken?: string;
        labelIds?: string[];
        q?: string;
      }): Promise<{ data: GmailThreadListLike }>;
      get(input: {
        userId: "me";
        id: string;
        format: "metadata" | "full";
        metadataHeaders?: string[];
      }): Promise<{ data: GmailThreadLike }>;
      modify(input: {
        userId: "me";
        id: string;
        requestBody: { addLabelIds?: string[]; removeLabelIds?: string[] };
      }): Promise<unknown>;
    };
    drafts: {
      create(input: {
        userId: "me";
        requestBody: { message: { raw: string; threadId?: string } };
      }): Promise<{ data: GmailDraftLike }>;
      send(input: {
        userId: "me";
        requestBody: { id: string };
      }): Promise<{ data: GmailDraftLike["message"] }>;
    };
  };
}

export interface GmailMailProviderOptions {
  client: GmailApiClient;
  account: MailAccount;
}

const METADATA_HEADERS = [
  "From",
  "To",
  "Cc",
  "Bcc",
  "Reply-To",
  "Subject",
  "Date",
  "Message-ID",
  "In-Reply-To",
  "References",
];
const DEFAULT_THREAD_LIMIT = 200;
const MAX_GMAIL_PAGE_SIZE = 500;

/** Builds an official Google Gmail API client; callers own OAuth configuration. */
export function createGmailApiClient(auth: unknown): GmailApiClient {
  return google.gmail({
    version: "v1",
    auth: auth as never,
  }) as unknown as GmailApiClient;
}

function boundedLimit(limit: number | undefined): number {
  const requested =
    limit !== undefined && Number.isFinite(limit)
      ? limit
      : DEFAULT_THREAD_LIMIT;
  return Math.max(1, Math.min(MAX_GMAIL_PAGE_SIZE, Math.floor(requested)));
}

function assertSafeHeader(value: string, field: string): void {
  if (/\r|\n/.test(value)) {
    throw new MailProviderError("INVALID_DRAFT", `Invalid ${field}.`, false);
  }
}

function formatHeader(
  name: string,
  values: readonly string[],
): string | undefined {
  if (values.length === 0) return undefined;
  values.forEach((value) => assertSafeHeader(value, name));
  return `${name}: ${values.join(", ")}`;
}

/** Encodes a plain-text email into Gmail's required URL-safe base64 format. */
export function encodeGmailDraft(input: CreateDraftInput): string {
  if (input.to.length === 0) {
    throw new MailProviderError(
      "INVALID_DRAFT",
      "At least one recipient is required.",
      false,
    );
  }

  assertSafeHeader(input.subject, "subject");
  const headers = [
    formatHeader("To", input.to),
    formatHeader("Cc", input.cc ?? []),
    formatHeader("Bcc", input.bcc ?? []),
    `Subject: ${input.subject}`,
    input.replyToMessageId
      ? `In-Reply-To: ${input.replyToMessageId}`
      : undefined,
    input.references?.length
      ? `References: ${input.references.join(" ")}`
      : undefined,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
  ].filter((value): value is string => Boolean(value));

  input.references?.forEach((reference) =>
    assertSafeHeader(reference, "references"),
  );
  input.replyToMessageId &&
    assertSafeHeader(input.replyToMessageId, "reply reference");

  const raw = `${headers.join("\r\n")}\r\n\r\n${input.body.replace(/\r?\n/g, "\r\n")}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

/**
 * Account-bound adapter for the official Gmail API. It never accepts a userId
 * argument, preventing accidental multi-account access in the v1 surface.
 */
export class GmailMailProvider implements MailProvider {
  readonly account: MailAccount;

  constructor(private readonly options: GmailMailProviderOptions) {
    this.account = options.account;
  }

  async listThreads(input: ListThreadsInput = {}): Promise<ThreadPage> {
    const page = await this.request(() =>
      this.options.client.users.threads.list({
        userId: "me",
        maxResults: boundedLimit(input.limit),
        ...(input.pageToken ? { pageToken: input.pageToken } : {}),
        ...(input.labelIds?.length ? { labelIds: input.labelIds } : {}),
        ...(input.query !== undefined ? { q: input.query } : {}),
      }),
    );

    const threads = await Promise.all(
      (page.data.threads ?? [])
        .filter((thread): thread is GmailThreadLike & { id: string } =>
          Boolean(thread.id),
        )
        .map((thread) => this.getMetadataThread(thread.id)),
    );

    return {
      threads,
      nextPageToken: page.data.nextPageToken ?? undefined,
      totalEstimate: page.data.resultSizeEstimate ?? undefined,
    };
  }

  async getThread(threadId: string) {
    const response = await this.request(() =>
      this.options.client.users.threads.get({
        userId: "me",
        id: threadId,
        format: "full",
      }),
    );
    return normalizeGmailThread(response.data, { includeBodies: true });
  }

  /** Gmail's query grammar is passed through without rewriting or interpretation. */
  async search(
    query: string,
    input: Pick<ListThreadsInput, "limit" | "pageToken"> = {},
  ): Promise<SearchResult[]> {
    const page = await this.listThreads({ ...input, query });
    return page.threads.map((thread) => ({
      thread,
      matchedMessageIds: thread.messages.map((message) => message.id),
    }));
  }

  async archiveThread(threadId: string): Promise<void> {
    await this.modifyThread(threadId, { removeLabelIds: ["INBOX"] });
  }

  async markRead(threadId: string): Promise<void> {
    await this.modifyThread(threadId, { removeLabelIds: ["UNREAD"] });
  }

  async markUnread(threadId: string): Promise<void> {
    await this.modifyThread(threadId, { addLabelIds: ["UNREAD"] });
  }

  async applyLabel(threadId: string, labelId: string): Promise<void> {
    await this.modifyThread(threadId, { addLabelIds: [labelId] });
  }

  async removeLabel(threadId: string, labelId: string): Promise<void> {
    await this.modifyThread(threadId, { removeLabelIds: [labelId] });
  }

  async createDraft(input: CreateDraftInput): Promise<MailDraft> {
    const response = await this.request(() =>
      this.options.client.users.drafts.create({
        userId: "me",
        requestBody: {
          message: {
            raw: encodeGmailDraft(input),
            ...(input.threadId ? { threadId: input.threadId } : {}),
          },
        },
      }),
    );
    const id = response.data.id;
    if (!id) {
      throw new MailProviderError(
        "GMAIL_API_ERROR",
        "Gmail did not create a draft.",
      );
    }

    return {
      id,
      threadId: response.data.message?.threadId ?? input.threadId,
      to: [...input.to],
      cc: [...(input.cc ?? [])],
      bcc: [...(input.bcc ?? [])],
      subject: input.subject,
      body: input.body,
      createdAt: new Date().toISOString(),
    };
  }

  async sendDraft(draftId: string): Promise<SendResult> {
    const response = await this.request(() =>
      this.options.client.users.drafts.send({
        userId: "me",
        requestBody: { id: draftId },
      }),
    );
    const messageId = response.data?.id;
    if (!messageId) {
      throw new MailProviderError(
        "GMAIL_API_ERROR",
        "Gmail did not send the draft.",
      );
    }

    return {
      draftId,
      messageId,
      threadId: response.data?.threadId ?? undefined,
    };
  }

  private async getMetadataThread(threadId: string) {
    const response = await this.request(() =>
      this.options.client.users.threads.get({
        userId: "me",
        id: threadId,
        format: "metadata",
        metadataHeaders: METADATA_HEADERS,
      }),
    );
    return normalizeGmailThread(response.data);
  }

  private async modifyThread(
    threadId: string,
    requestBody: { addLabelIds?: string[]; removeLabelIds?: string[] },
  ): Promise<void> {
    await this.request(() =>
      this.options.client.users.threads.modify({
        userId: "me",
        id: threadId,
        requestBody,
      }),
    );
  }

  private async request<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw toMailProviderError(error);
    }
  }
}

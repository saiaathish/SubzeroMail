import {
  classifyFocus,
  type MailParticipant,
  type MessageRecord,
  type ThreadRecord,
} from "@subzero/core";
import { ExtensionDatabase } from "@subzero/storage/extension";
import { sanitizeEmailHtml, safeTextFallback } from "@subzero/security/client";

import {
  cloneDemoThreads,
  type FixtureMessage,
  type FixtureThread,
} from "../fixtures";
import { getIdentityToken } from "../platform/oauth";
import { loadExtensionState, updateExtensionState } from "../platform/storage";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 500;
const demoDrafts = new Map<string, GmailDraftInput>();
const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
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
] as const;

type GmailMutationKind = "archive" | "toggle-read" | "toggle-star";

interface GmailHeader {
  name?: string;
  value?: string;
}

interface GmailBody {
  data?: string;
}

interface GmailPart extends GmailBody {
  mimeType?: string;
  body?: GmailBody;
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: {
    mimeType?: string;
    headers?: GmailHeader[];
    body?: GmailBody;
    parts?: GmailPart[];
  };
}

interface GmailThread {
  id: string;
  historyId?: string;
  messages?: GmailMessage[];
}

interface GmailThreadList {
  threads?: Array<{ id?: string; historyId?: string }>;
  nextPageToken?: string;
}

interface GmailProfile {
  emailAddress?: string;
  messagesTotal?: number;
  threadsTotal?: number;
}

interface GmailDraftResponse {
  id?: string;
  message?: {
    id?: string;
    threadId?: string;
  };
}

interface GmailApiError {
  error?: {
    message?: string;
    code?: number;
  };
}

interface GmailLabel {
  id?: string;
  name?: string;
}

interface GmailLabelList {
  labels?: GmailLabel[];
}

export interface GmailProfileSnapshot {
  email: string;
  messagesTotal?: number;
  threadsTotal?: number;
}

export interface GmailDraftInput {
  to: readonly string[];
  subject: string;
  body: string;
  cc?: readonly string[];
  bcc?: readonly string[];
  threadId?: string;
  replyToMessageId?: string;
  references?: readonly string[];
}

export interface GmailDraftResult {
  draftId: string;
  messageId?: string;
  threadId?: string;
}

export interface LiveSyncResult {
  threads: FixtureThread[];
  email: string;
}

export class GmailAdapterError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "GmailAdapterError";
  }
}

export function isGmailAdapterError(
  error: unknown,
): error is GmailAdapterError {
  return error instanceof GmailAdapterError;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeLimit(limit = DEFAULT_LIMIT): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
}

function assertNoLineBreaks(value: string, label: string): void {
  if (/\r|\n/.test(value)) {
    throw new GmailAdapterError(
      "invalid_draft",
      `${label} cannot contain CR or LF characters.`,
    );
  }
}

function assertRecipient(address: string): string {
  const trimmed = address.trim();
  if (!trimmed) {
    throw new GmailAdapterError(
      "invalid_draft",
      "At least one recipient is required.",
    );
  }
  assertNoLineBreaks(trimmed, "Recipient");
  if (!trimmed.includes("@")) {
    throw new GmailAdapterError(
      "invalid_draft",
      "Recipient address must include @.",
    );
  }
  return trimmed;
}

function toBase64UrlUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function formatAddress(participant: MailParticipant): string {
  if (typeof participant === "string") {
    const trimmed = participant.trim();
    if (!trimmed) {
      throw new GmailAdapterError(
        "invalid_draft",
        "Recipient address is required.",
      );
    }
    assertNoLineBreaks(trimmed, "Recipient");
    return trimmed;
  }

  const address = assertRecipient(participant.address);
  const name = participant.name?.trim();
  if (!name) return address;
  assertNoLineBreaks(name, "Recipient name");
  return `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}" <${address}>`;
}

function joinRecipients(values: readonly string[] | undefined): string {
  const recipients = (values ?? []).map((value) => assertRecipient(value));
  return recipients.join(", ");
}

function header(message: GmailMessage, name: string): string {
  return (
    message.payload?.headers?.find(
      (item) => item.name?.toLowerCase() === name.toLowerCase(),
    )?.value ?? ""
  );
}

function parseAddress(value: string): MailParticipant {
  const match = value.match(/^(.*?)\s*<([^>]+)>$/);
  if (!match) return value.trim();

  const name = match[1]?.replace(/^"|"$/g, "").trim();
  const address = match[2]?.trim();
  if (!address) return value.trim();

  return name ? { name, address } : { address };
}

function parseAddressList(value: string | undefined): MailParticipant[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => parseAddress(part));
}

function decodeBody(data: string | undefined): string | undefined {
  if (!data) return undefined;
  try {
    const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

function findPart(
  parts: readonly GmailPart[] | undefined,
  mimeType: string,
): string | undefined {
  for (const part of parts ?? []) {
    if (part.mimeType === mimeType) {
      const value = decodeBody(part.body?.data ?? part.data);
      if (value) return value;
    }

    const nested = findPart(part.parts, mimeType);
    if (nested) return nested;
  }

  return undefined;
}

function messageBody(message: GmailMessage): { text?: string; html?: string } {
  const payload = message.payload;
  if (!payload) return {};

  const direct = decodeBody(payload.body?.data);
  return {
    text:
      payload.mimeType === "text/plain"
        ? direct
        : findPart(payload.parts, "text/plain"),
    html:
      payload.mimeType === "text/html"
        ? direct
        : findPart(payload.parts, "text/html"),
  };
}

function messageHeaders(message: GmailMessage): Record<string, string> {
  const payloadHeaders = message.payload?.headers ?? [];
  const result: Record<string, string> = {};
  for (const item of payloadHeaders) {
    if (item.name && item.value) {
      result[item.name.toLowerCase()] = item.value;
    }
  }
  return result;
}

function normalizeThreadSummary(thread: GmailThread): FixtureThread {
  const messages = [...(thread.messages ?? [])].sort(
    (left, right) =>
      Number(right.internalDate ?? 0) - Number(left.internalDate ?? 0),
  );
  const latest = messages[0];
  if (!latest) {
    return {
      id: thread.id,
      sender: "Unknown sender",
      senderEmail: "",
      subject: "Untitled thread",
      preview: "No message metadata returned by Gmail.",
      timestamp: "",
      bucket: "other",
      unread: false,
      reason: "Insufficient thread data",
      archived: false,
      source: "gmail",
    };
  }

  const from = parseAddress(header(latest, "From"));
  const sender = typeof from === "string" ? from : from.name || from.address;
  const senderEmail = typeof from === "string" ? from : from.address;
  const subject = header(latest, "Subject") || "(no subject)";
  const preview = latest.snippet ?? "";
  const labelIds = [
    ...new Set(messages.flatMap((item) => item.labelIds ?? [])),
  ];
  const focus = classifyFocus({
    subject,
    preview,
    unread: labelIds.includes("UNREAD"),
    labelIds,
    participants: [from],
    messages: messages.map((item) => ({
      from: parseAddress(header(item, "From")),
      subject: header(item, "Subject"),
      snippet: item.snippet,
    })),
  });
  const body = messageBody(latest);

  return {
    id: thread.id,
    sender,
    senderEmail,
    subject,
    preview,
    timestamp: latest.internalDate
      ? new Intl.DateTimeFormat(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(Number(latest.internalDate)))
      : "",
    bucket: focus.bucket,
    unread: labelIds.includes("UNREAD"),
    reason: focus.reasons[0] ?? "No deterministic priority signal",
    archived: !labelIds.includes("INBOX"),
    source: "gmail",
    labelIds,
    latestMessageId: latest.id,
    htmlBody: body.html,
    starred: labelIds.includes("STARRED"),
  };
}

function threadRecordFromSummary(
  thread: FixtureThread,
  accountId: string,
  metadataOnly: boolean,
): ThreadRecord {
  return {
    id: thread.id,
    accountId,
    latestMessageId: thread.latestMessageId ?? thread.id,
    subject: thread.subject,
    preview: thread.preview,
    unread: thread.unread,
    labelIds: thread.labelIds ?? [],
    participants: [{ name: thread.sender, address: thread.senderEmail }],
    bucket: thread.bucket,
    focusReasons: [thread.reason],
    focusReasonCodes: [],
    updatedAt: new Date().toISOString(),
    metadataOnly,
  };
}

function threadSummaryFromRecord(
  record: ThreadRecord,
  htmlBody?: string,
  messages?: FixtureMessage[],
): FixtureThread {
  const participant = record.participants[0];
  const sender =
    typeof participant === "string"
      ? participant
      : participant?.name || participant?.address || "Unknown sender";
  const senderEmail =
    typeof participant === "string"
      ? participant
      : (participant?.address ?? "");

  return {
    id: record.id,
    sender,
    senderEmail,
    subject: record.subject,
    preview: record.preview,
    timestamp: new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
    }).format(new Date(record.updatedAt)),
    bucket: record.bucket,
    unread: record.unread,
    reason: record.focusReasons[0] ?? "No deterministic priority signal",
    archived: !record.labelIds.includes("INBOX"),
    source: "gmail",
    labelIds: record.labelIds,
    latestMessageId: record.latestMessageId,
    starred: record.labelIds.includes("STARRED"),
    ...(htmlBody ? { htmlBody } : {}),
    ...(messages?.length ? { messages } : {}),
  };
}

function displayParticipant(participant: MailParticipant | undefined): string {
  if (!participant) return "Unknown sender";
  return typeof participant === "string"
    ? participant
    : participant.name || participant.address;
}

function addressOfParticipant(
  participant: MailParticipant | undefined,
): string {
  return typeof participant === "string"
    ? participant
    : (participant?.address ?? "");
}

function fixtureMessageFromRecord(record: MessageRecord): FixtureMessage {
  return {
    id: record.id,
    sender: displayParticipant(record.from),
    senderEmail: addressOfParticipant(record.from),
    to: record.to.map(addressOfParticipant).filter(Boolean),
    cc: record.cc.map(addressOfParticipant).filter(Boolean),
    subject: record.subject,
    preview: record.snippet,
    timestamp: record.sentAt ?? "",
    ...(record.htmlBody ? { htmlBody: record.htmlBody } : {}),
    ...(record.body ? { textBody: record.body } : {}),
    headers: record.headers,
  };
}

function messageRecordFromGmail(
  accountId: string,
  message: GmailMessage,
): MessageRecord {
  const headers = messageHeaders(message);
  const body = messageBody(message);
  const htmlBody = body.html ? sanitizeEmailHtml(body.html) : undefined;
  const plainBody =
    body.text ?? (body.html ? safeTextFallback(body.html) : undefined);

  return {
    id: message.id,
    accountId,
    threadId: message.threadId,
    subject: headers.subject ?? "(no subject)",
    ...(headers.from ? { from: parseAddress(headers.from) } : {}),
    to: parseAddressList(headers.to),
    cc: parseAddressList(headers.cc),
    bcc: parseAddressList(headers.bcc),
    ...(headers["reply-to"]
      ? { replyTo: parseAddress(headers["reply-to"]) }
      : {}),
    sentAt: headers.date || undefined,
    internalDate: message.internalDate
      ? Number(message.internalDate)
      : undefined,
    snippet: message.snippet ?? "",
    labelIds: [...new Set(message.labelIds ?? [])],
    headers,
    ...(plainBody ? { body: plainBody } : {}),
    ...(htmlBody ? { htmlBody } : {}),
    cachedAt: new Date().toISOString(),
  };
}

function matchesDemoQuery(thread: FixtureThread, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === "is:unread") return thread.unread;

  if (normalized.startsWith("from:")) {
    const needle = normalized.slice(5).trim();
    return (
      thread.sender.toLowerCase().includes(needle) ||
      thread.senderEmail.toLowerCase().includes(needle)
    );
  }

  return [thread.sender, thread.senderEmail, thread.subject, thread.preview]
    .join(" ")
    .toLowerCase()
    .includes(normalized);
}

async function withDatabase<T>(
  operation: (db: ExtensionDatabase) => Promise<T>,
): Promise<T> {
  const db = new ExtensionDatabase();
  try {
    return await operation(db);
  } finally {
    db.close();
  }
}

async function cacheThreads(
  threads: readonly FixtureThread[],
  accountId: string,
): Promise<void> {
  await withDatabase(async (db) => {
    await db.threads.bulkPut(
      threads.map((thread) => threadRecordFromSummary(thread, accountId, true)),
    );
  });
}

async function cacheFullThread(
  accountId: string,
  thread: GmailThread,
): Promise<FixtureThread> {
  const summary = normalizeThreadSummary(thread);
  const messages = thread.messages ?? [];
  const latest = messages
    .map((message) => messageRecordFromGmail(accountId, message))
    .sort(
      (left, right) => (left.internalDate ?? 0) - (right.internalDate ?? 0),
    );
  const latestMessage = latest[latest.length - 1];
  const htmlBody = latestMessage?.htmlBody;
  const fixtureMessages = latest.map(fixtureMessageFromRecord);

  await withDatabase(async (db) => {
    await db.putThread(
      threadRecordFromSummary(summary, accountId, false) satisfies ThreadRecord,
    );
    await db.messages.bulkPut(latest);
  });

  return threadSummaryFromRecord(
    threadRecordFromSummary(summary, accountId, false),
    htmlBody,
    fixtureMessages,
  );
}

async function loadCachedThread(
  threadId: string,
): Promise<{ thread: FixtureThread; hasHtmlBody: boolean } | undefined> {
  return withDatabase(async (db) => {
    const record = await db.getThread(threadId);
    if (!record) return undefined;

    const messages = await db.listMessages(threadId);
    const latest = [...messages]
      .sort(
        (left, right) => (left.internalDate ?? 0) - (right.internalDate ?? 0),
      )
      .at(-1);
    return {
      thread: threadSummaryFromRecord(
        record,
        latest?.htmlBody,
        messages
          .sort(
            (left, right) =>
              (left.internalDate ?? 0) - (right.internalDate ?? 0),
          )
          .map(fixtureMessageFromRecord),
      ),
      hasHtmlBody: Boolean(latest?.htmlBody),
    };
  });
}

async function loadCachedThreads(
  accountEmail?: string,
  limit = DEFAULT_LIMIT,
): Promise<FixtureThread[]> {
  return withDatabase(async (db) => {
    const records = accountEmail
      ? await db.listThreads(`gmail:${accountEmail}`)
      : await db.listThreads();
    return records
      .map((record) => threadSummaryFromRecord(record))
      .slice(0, normalizeLimit(limit));
  });
}

async function updateCachedThreadLabels(
  threadId: string,
  mutate: (labels: string[]) => string[],
): Promise<void> {
  await withDatabase(async (db) => {
    const record = await db.getThread(threadId);
    if (!record) return;

    const nextLabels = [...new Set(mutate([...record.labelIds]))];
    await db.putThread({
      ...record,
      labelIds: nextLabels,
      unread: nextLabels.includes("UNREAD"),
      updatedAt: new Date().toISOString(),
    });
  });
}

async function updateCachedThreadLabelsBestEffort(
  threadId: string,
  mutate: (labels: string[]) => string[],
): Promise<void> {
  try {
    await updateCachedThreadLabels(threadId, mutate);
  } catch {
    // Gmail remains canonical when IndexedDB is unavailable or being upgraded.
  }
}

class GmailClient {
  constructor(private readonly token: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${GMAIL_API}/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });

    const text = await response.text();
    if (!response.ok) {
      let message = `Gmail request failed (${response.status}).`;
      let code = `gmail_http_${response.status}`;

      if (text) {
        try {
          const body = JSON.parse(text) as GmailApiError;
          if (body.error?.message) message = body.error.message;
          if (body.error?.code) code = `gmail_http_${body.error.code}`;
        } catch {
          // Keep the safe fallback error message.
        }
      }

      throw new GmailAdapterError(code, message, response.status);
    }

    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  async profile(): Promise<GmailProfileSnapshot> {
    const value = await this.request<GmailProfile>("profile");
    if (!value.emailAddress) {
      throw new GmailAdapterError(
        "gmail_profile_missing",
        "Gmail profile had no email address.",
      );
    }

    return {
      email: value.emailAddress,
      messagesTotal: value.messagesTotal,
      threadsTotal: value.threadsTotal,
    };
  }

  private async fetchThreadPage(options: {
    query?: string;
    labelIds?: readonly string[];
    limit?: number;
    pageToken?: string;
    format?: "metadata" | "full";
  }): Promise<GmailThread[]> {
    const params = new URLSearchParams();
    params.set("maxResults", String(normalizeLimit(options.limit)));
    if (options.pageToken) params.set("pageToken", options.pageToken);
    if (options.query !== undefined) params.set("q", options.query);
    for (const labelId of options.labelIds ?? []) {
      params.append("labelIds", labelId);
    }

    const list = await this.request<GmailThreadList>(
      `threads?${params.toString()}`,
    );
    return Promise.all(
      (list.threads ?? [])
        .filter(
          (thread): thread is { id: string } => typeof thread.id === "string",
        )
        .map((thread) =>
          this.getThread(thread.id, options.format ?? "metadata"),
        ),
    );
  }

  async listInboxThreads(limit = DEFAULT_LIMIT): Promise<GmailThread[]> {
    return this.fetchThreadPage({
      labelIds: ["INBOX"],
      limit,
      format: "metadata",
    });
  }

  async searchThreads(
    query: string,
    limit = DEFAULT_LIMIT,
    pageToken?: string,
  ): Promise<GmailThread[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      throw new GmailAdapterError(
        "invalid_search_query",
        "Search query must not be empty.",
      );
    }

    return this.fetchThreadPage({
      query: trimmed,
      limit,
      pageToken,
      format: "metadata",
    });
  }

  async getThread(
    threadId: string,
    format: "metadata" | "full",
  ): Promise<GmailThread> {
    const params = new URLSearchParams({ format });
    if (format === "metadata") {
      for (const headerName of METADATA_HEADERS) {
        params.append("metadataHeaders", headerName);
      }
    }

    return this.request<GmailThread>(
      `threads/${encodeURIComponent(threadId)}?${params.toString()}`,
    );
  }

  async archive(threadId: string): Promise<void> {
    await this.request(`threads/${encodeURIComponent(threadId)}/modify`, {
      method: "POST",
      body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
    });
  }

  async setUnread(threadId: string, unread: boolean): Promise<void> {
    await this.request(`threads/${encodeURIComponent(threadId)}/modify`, {
      method: "POST",
      body: JSON.stringify(
        unread ? { addLabelIds: ["UNREAD"] } : { removeLabelIds: ["UNREAD"] },
      ),
    });
  }

  async setStarred(threadId: string, starred: boolean): Promise<void> {
    await this.request(`threads/${encodeURIComponent(threadId)}/modify`, {
      method: "POST",
      body: JSON.stringify(
        starred
          ? { addLabelIds: ["STARRED"] }
          : { removeLabelIds: ["STARRED"] },
      ),
    });
  }

  private async ensureLabel(name: string): Promise<string> {
    const listed = await this.request<GmailLabelList>("labels");
    const existing = listed.labels?.find((label) => label.name === name)?.id;
    if (existing) return existing;

    const created = await this.request<GmailLabel>("labels", {
      method: "POST",
      body: JSON.stringify({
        name,
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      }),
    });
    if (!created.id) {
      throw new GmailAdapterError(
        "gmail_label_create_failed",
        "Gmail did not create the Subzero label.",
      );
    }
    return created.id;
  }

  async applySubzeroLabel(threadId: string, name: string): Promise<string> {
    const labelId = await this.ensureLabel(name);
    await this.request(`threads/${encodeURIComponent(threadId)}/modify`, {
      method: "POST",
      body: JSON.stringify({ addLabelIds: [labelId] }),
    });
    return labelId;
  }

  async createDraft(input: GmailDraftInput): Promise<GmailDraftResult> {
    const response = await this.request<GmailDraftResponse>("drafts", {
      method: "POST",
      body: JSON.stringify({
        message: {
          raw: buildDraftRawMessage(input),
          ...(input.threadId ? { threadId: input.threadId } : {}),
        },
      }),
    });

    if (!response.id) {
      throw new GmailAdapterError(
        "gmail_draft_create_failed",
        "Gmail did not create a draft.",
      );
    }

    return {
      draftId: response.id,
      messageId: response.message?.id,
      threadId: response.message?.threadId ?? input.threadId,
    };
  }

  async sendDraft(draftId: string): Promise<GmailDraftResult> {
    const response = await this.request<GmailDraftResponse>("drafts/send", {
      method: "POST",
      body: JSON.stringify({ id: draftId }),
    });

    const messageId = response.message?.id ?? response.id;
    if (!messageId) {
      throw new GmailAdapterError(
        "gmail_send_failed",
        "Gmail did not send the draft.",
      );
    }

    return {
      draftId,
      messageId,
      threadId: response.message?.threadId,
    };
  }
}

function buildDraftRawMessage(input: GmailDraftInput): string {
  const to = joinRecipients(input.to);
  if (!to) {
    throw new GmailAdapterError(
      "invalid_draft",
      "At least one recipient is required.",
    );
  }

  const subject = input.subject.trim();
  if (!subject) {
    throw new GmailAdapterError("invalid_draft", "Subject is required.");
  }
  assertNoLineBreaks(subject, "Subject");

  if (!input.body.trim()) {
    throw new GmailAdapterError("invalid_draft", "Body is required.");
  }

  const cc = joinRecipients(input.cc);
  const bcc = joinRecipients(input.bcc);
  const references = (input.references ?? []).map((reference) => {
    const trimmed = reference.trim();
    if (!trimmed) {
      throw new GmailAdapterError(
        "invalid_draft",
        "References cannot contain blank values.",
      );
    }
    assertNoLineBreaks(trimmed, "References");
    return trimmed;
  });

  if (input.threadId !== undefined && !input.threadId.trim()) {
    throw new GmailAdapterError("invalid_draft", "Thread id is required.");
  }

  if (input.replyToMessageId) {
    const replyToMessageId = input.replyToMessageId.trim();
    if (!replyToMessageId) {
      throw new GmailAdapterError(
        "invalid_draft",
        "Reply reference is required when provided.",
      );
    }
    assertNoLineBreaks(replyToMessageId, "Reply reference");
  }

  const headers = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : undefined,
    bcc ? `Bcc: ${bcc}` : undefined,
    `Subject: ${subject}`,
    input.replyToMessageId
      ? `In-Reply-To: ${input.replyToMessageId.trim()}`
      : undefined,
    references.length ? `References: ${references.join(" ")}` : undefined,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
  ].filter((line): line is string => Boolean(line));

  const normalizedBody = input.body.replace(/\r?\n/g, "\r\n");
  return toBase64UrlUtf8(`${headers.join("\r\n")}\r\n\r\n${normalizedBody}`);
}

async function withGmailClient<T>(
  operation: (client: GmailClient, profile: GmailProfileSnapshot) => Promise<T>,
): Promise<T> {
  const token = await getIdentityToken(false);
  const client = new GmailClient(token);
  const profile = await client.profile();
  return operation(client, profile);
}

function isDemoMode(): Promise<boolean> {
  return loadExtensionState().then(
    (state) => state.account.mode !== "connected",
  );
}

export async function getExtensionThreads(
  limit = DEFAULT_LIMIT,
): Promise<FixtureThread[]> {
  const state = await loadExtensionState();
  if (state.account.mode === "connected" && state.account.email) {
    const cached = await loadCachedThreads(state.account.email, limit);
    if (cached.length > 0) return cached;

    // A connected account with an empty cache must never fall back to demo
    // mail. Fetch authoritative Gmail state or surface the auth/network error.
    const synced = await syncGmail(false);
    return synced.threads.slice(0, normalizeLimit(limit));
  }

  return cloneDemoThreads().slice(0, normalizeLimit(limit));
}

export async function getExtensionThread(
  threadId: string,
): Promise<FixtureThread | undefined> {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) {
    throw new GmailAdapterError("invalid_thread_id", "Thread id is required.");
  }

  const state = await loadExtensionState();
  if (state.account.mode === "connected") {
    const cached = await loadCachedThread(normalizedThreadId);
    if (cached?.hasHtmlBody) return cached.thread;

    return withGmailClient(async (client, profile) => {
      const thread = await client.getThread(normalizedThreadId, "full");
      const cachedThread = await cacheFullThread(
        `gmail:${profile.email}`,
        thread,
      );
      return cachedThread;
    });
  }

  return cloneDemoThreads().find((thread) => thread.id === normalizedThreadId);
}

export async function searchGmailThreads(
  query: string,
  limit = DEFAULT_LIMIT,
  pageToken?: string,
): Promise<FixtureThread[]> {
  const state = await loadExtensionState();
  if (state.account.mode === "connected") {
    return withGmailClient(async (client) => {
      const threads = await client.searchThreads(query, limit, pageToken);
      return threads.map((thread) => normalizeThreadSummary(thread));
    });
  }

  return cloneDemoThreads()
    .filter((thread) => matchesDemoQuery(thread, query))
    .slice(0, normalizeLimit(limit));
}

export async function syncGmail(
  _forceRefresh = false,
): Promise<LiveSyncResult> {
  return withGmailClient(async (client, profile) => {
    const threads = await client.listInboxThreads(DEFAULT_LIMIT);
    const normalized = threads.map((thread) => normalizeThreadSummary(thread));
    const accountId = `gmail:${profile.email}`;

    await cacheThreads(normalized, accountId);
    await updateExtensionState({
      account: {
        mode: "connected",
        email: profile.email,
        label: "Gmail connected",
        detail: "Live Gmail API connected with Chrome identity token.",
      },
      sync: {
        status: "idle",
        lastSyncedAt: new Date().toISOString(),
        detail: "Gmail inbox refreshed. Full message bodies load on demand.",
        threadCount: normalized.length,
      },
    });

    return { threads: normalized, email: profile.email };
  });
}

export async function applyGmailMutation(
  kind: GmailMutationKind,
  threadId: string,
  value?: boolean,
): Promise<void> {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) {
    throw new GmailAdapterError("invalid_thread_id", "Thread id is required.");
  }

  await withGmailClient(async (client) => {
    switch (kind) {
      case "archive":
        await client.archive(normalizedThreadId);
        await updateCachedThreadLabelsBestEffort(normalizedThreadId, (labels) =>
          labels.filter((label) => label !== "INBOX"),
        );
        return;
      case "toggle-read":
        await client.setUnread(normalizedThreadId, value === true);
        await updateCachedThreadLabelsBestEffort(
          normalizedThreadId,
          (labels) =>
            value === true
              ? [...labels, "UNREAD"]
              : labels.filter((label) => label !== "UNREAD"),
        );
        return;
      case "toggle-star":
        await client.setStarred(normalizedThreadId, value === true);
        await updateCachedThreadLabelsBestEffort(
          normalizedThreadId,
          (labels) =>
            value === true
              ? [...labels, "STARRED"]
              : labels.filter((label) => label !== "STARRED"),
        );
        return;
      default:
        throw new GmailAdapterError(
          "unsupported_gmail_mutation",
          "That Gmail mutation is not supported.",
        );
    }
  });
}

export type AutoArchiveCategory = "newsletter" | "cold-pitch";
export type AutoLabelCategory = "priority" | "needs_reply" | "waiting";

export interface AutomationResult {
  status: "applied" | "disabled" | "demo";
  threadId: string;
  labelId?: string;
}

export async function applyAutoArchive(
  threadId: string,
  category: AutoArchiveCategory,
): Promise<AutomationResult> {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) {
    throw new GmailAdapterError("invalid_thread_id", "Thread id is required.");
  }
  if (category !== "newsletter" && category !== "cold-pitch") {
    throw new GmailAdapterError(
      "invalid_automation_category",
      "Auto-archive category is not supported.",
    );
  }
  const state = await loadExtensionState();
  if (!state.preferences.enableAutoArchive) {
    return { status: "disabled", threadId: normalizedThreadId };
  }
  if (state.account.mode !== "connected") {
    return { status: "demo", threadId: normalizedThreadId };
  }
  await withGmailClient(async (client) => client.archive(normalizedThreadId));
  await updateCachedThreadLabelsBestEffort(normalizedThreadId, (labels) =>
    labels.filter((label) => label !== "INBOX"),
  );
  return { status: "applied", threadId: normalizedThreadId };
}

export async function applyAutoLabel(
  threadId: string,
  category: AutoLabelCategory,
): Promise<AutomationResult> {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) {
    throw new GmailAdapterError("invalid_thread_id", "Thread id is required.");
  }
  const labelNames: Record<AutoLabelCategory, string> = {
    priority: "Subzero/Priority",
    needs_reply: "Subzero/Needs Reply",
    waiting: "Subzero/Waiting",
  };
  const labelName = labelNames[category];
  if (!labelName) {
    throw new GmailAdapterError(
      "invalid_automation_category",
      "Auto-label category is not supported.",
    );
  }
  const state = await loadExtensionState();
  if (!state.preferences.enableAutoLabels) {
    return { status: "disabled", threadId: normalizedThreadId };
  }
  if (state.account.mode !== "connected") {
    return { status: "demo", threadId: normalizedThreadId };
  }
  const labelId = await withGmailClient((client) =>
    client.applySubzeroLabel(normalizedThreadId, labelName),
  );
  await updateCachedThreadLabelsBestEffort(normalizedThreadId, (labels) => [
    ...new Set([...labels, labelId]),
  ]);
  return { status: "applied", threadId: normalizedThreadId, labelId };
}

export async function createGmailDraft(
  input: GmailDraftInput,
): Promise<GmailDraftResult> {
  if (await isDemoMode()) {
    buildDraftRawMessage(input);
    const draftId = `demo-draft-${
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`
    }`;
    demoDrafts.set(draftId, {
      ...input,
      to: [...input.to],
      ...(input.cc ? { cc: [...input.cc] } : {}),
      ...(input.bcc ? { bcc: [...input.bcc] } : {}),
      ...(input.references ? { references: [...input.references] } : {}),
    });
    return {
      draftId,
      threadId: input.threadId,
    };
  }

  return withGmailClient((client) => client.createDraft(input));
}

export async function sendGmailDraft(
  draftId: string,
): Promise<GmailDraftResult> {
  const normalizedDraftId = draftId.trim();
  if (!normalizedDraftId) {
    throw new GmailAdapterError("invalid_draft_id", "Draft id is required.");
  }

  if (await isDemoMode()) {
    const draft = demoDrafts.get(normalizedDraftId);
    if (!draft) {
      throw new GmailAdapterError("draft_not_found", "Draft was not found.");
    }
    demoDrafts.delete(normalizedDraftId);
    return {
      draftId: normalizedDraftId,
      messageId: `demo-message-${normalizedDraftId.slice("demo-draft-".length)}`,
      threadId: draft.threadId ?? `demo-thread-${normalizedDraftId}`,
    };
  }

  return withGmailClient((client) => client.sendDraft(normalizedDraftId));
}

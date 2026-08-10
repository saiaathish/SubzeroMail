import type { MailAddress, MailMessage, MailThread } from "./types";

export interface GmailHeaderLike {
  name?: string | null;
  value?: string | null;
}

export interface GmailPayloadLike {
  mimeType?: string | null;
  headers?: GmailHeaderLike[] | null;
  body?: { data?: string | null; size?: number | null } | null;
  parts?: GmailPayloadLike[] | null;
}

export interface GmailMessageLike {
  id?: string | null;
  threadId?: string | null;
  labelIds?: string[] | null;
  snippet?: string | null;
  internalDate?: string | null;
  payload?: GmailPayloadLike | null;
}

export interface GmailThreadLike {
  id?: string | null;
  historyId?: string | null;
  snippet?: string | null;
  messages?: GmailMessageLike[] | null;
}

export interface NormalizeGmailThreadOptions {
  /** False for list/search calls. Thread detail sets this true. */
  includeBodies?: boolean;
}

const NORMALIZED_HEADERS = [
  "from",
  "to",
  "cc",
  "bcc",
  "reply-to",
  "subject",
  "date",
  "message-id",
  "in-reply-to",
  "references",
] as const;

function headerMap(
  headers: readonly GmailHeaderLike[] | null | undefined,
): Record<string, string> {
  const all = new Map<string, string>();
  for (const header of headers ?? []) {
    if (header.name && header.value) {
      all.set(header.name.toLowerCase(), header.value);
    }
  }

  return Object.fromEntries(
    NORMALIZED_HEADERS.flatMap((name) => {
      const value = all.get(name);
      return value ? [[name, value]] : [];
    }),
  );
}

export function parseMailAddress(
  value: string | undefined,
): MailAddress | undefined {
  const input = value?.trim();
  if (!input) return undefined;

  const bracketed = input.match(/^(?:\"?([^\"<>]+?)\"?\s*)?<([^>]+)>$/);
  if (bracketed) {
    return {
      address: bracketed[2].trim(),
      ...(bracketed[1]?.trim() ? { name: bracketed[1].trim() } : {}),
    };
  }

  return { address: input };
}

export function parseMailAddressList(value: string | undefined): MailAddress[] {
  if (!value) return [];

  const parts = value.match(/(?:[^,\"]|\"[^\"]*\")+/g) ?? [];
  return parts
    .map((part) => parseMailAddress(part))
    .filter((address): address is MailAddress => Boolean(address));
}

function flattenPayload(
  payload: GmailPayloadLike | null | undefined,
): GmailPayloadLike[] {
  if (!payload) return [];
  return [
    payload,
    ...(payload.parts ?? []).flatMap((part) => flattenPayload(part)),
  ];
}

/** Decodes Gmail's URL-safe base64 body payload without logging it. */
export function decodeGmailBody(
  data: string | null | undefined,
): string | undefined {
  if (!data) return undefined;

  try {
    const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    if (typeof atob === "function") {
      const binary = atob(padded);
      const bytes = Uint8Array.from(binary, (character) =>
        character.charCodeAt(0),
      );
      return new TextDecoder().decode(bytes);
    }

    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return undefined;
  }
}

function bodyForMimeType(
  payload: GmailPayloadLike | null | undefined,
  mimeType: string,
): string | undefined {
  return flattenPayload(payload)
    .filter((part) => part.mimeType?.toLowerCase() === mimeType)
    .map((part) => decodeGmailBody(part.body?.data))
    .find((body): body is string => body !== undefined);
}

function toIsoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function toInternalDate(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const date = Number(value);
  return Number.isFinite(date) ? date : undefined;
}

export function normalizeGmailMessage(
  message: GmailMessageLike,
  options: NormalizeGmailThreadOptions = {},
): MailMessage {
  const headers = headerMap(message.payload?.headers);
  const includeBodies = options.includeBodies === true;
  const body = includeBodies
    ? bodyForMimeType(message.payload, "text/plain")
    : undefined;
  const htmlBody = includeBodies
    ? bodyForMimeType(message.payload, "text/html")
    : undefined;

  return {
    id: message.id ?? "unknown-message",
    threadId: message.threadId ?? "unknown-thread",
    subject: headers.subject ?? "(no subject)",
    from: parseMailAddress(headers.from),
    to: parseMailAddressList(headers.to),
    cc: parseMailAddressList(headers.cc),
    bcc: parseMailAddressList(headers.bcc),
    replyTo: parseMailAddress(headers["reply-to"]),
    sentAt: toIsoDate(headers.date),
    internalDate: toInternalDate(message.internalDate),
    snippet: message.snippet ?? "",
    labelIds: [...(message.labelIds ?? [])],
    headers,
    ...(body !== undefined ? { body } : {}),
    ...(htmlBody !== undefined ? { htmlBody } : {}),
  };
}

function dedupeAddresses(addresses: readonly MailAddress[]): MailAddress[] {
  const seen = new Set<string>();
  return addresses.filter((address) => {
    const key = address.address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeGmailThread(
  thread: GmailThreadLike,
  options: NormalizeGmailThreadOptions = {},
): MailThread {
  const messages = (thread.messages ?? []).map((message) =>
    normalizeGmailMessage(message, options),
  );
  const latest = [...messages]
    .sort((left, right) => (left.internalDate ?? 0) - (right.internalDate ?? 0))
    .at(-1);
  const labels = [...new Set(messages.flatMap((message) => message.labelIds))];
  const participants = dedupeAddresses(
    messages.flatMap(
      (message) =>
        [message.from, ...message.to, ...message.cc].filter(
          Boolean,
        ) as MailAddress[],
    ),
  );
  const threadId = thread.id ?? latest?.threadId ?? "unknown-thread";

  return {
    id: threadId,
    latestMessageId: latest?.id ?? threadId,
    subject:
      messages.find((message) => message.subject)?.subject ?? "(no subject)",
    participants,
    preview: thread.snippet ?? latest?.snippet ?? "",
    unread: labels.includes("UNREAD"),
    labelIds: labels,
    historyId: thread.historyId ?? undefined,
    updatedAt:
      latest?.sentAt ??
      (latest?.internalDate
        ? new Date(latest.internalDate).toISOString()
        : undefined),
    metadataOnly: options.includeBodies !== true,
    messages,
  };
}

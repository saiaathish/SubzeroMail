import {
  AIProviderError,
  AnthropicProvider,
  DeterministicAIProvider,
  GeminiProvider,
  OpenAICompatibleProvider,
  createNotEnoughEvidenceAnswer,
  type AIProvider,
  type AskInboxEvidence,
  type InboxAnswer,
  type MailThreadContext,
  type OpenLoopCandidate,
  type ThreadSummary,
} from "@subzero/ai";
import type {
  OpenLoop,
  OpenLoopDirection,
  OpenLoopStatus,
} from "@subzero/core";
import {
  createExtensionDatabase,
  MemoryExtensionDatabase,
  type ExtensionStore,
} from "@subzero/storage/extension";

import type { FixtureMessage, FixtureThread } from "./fixtures";
import { getExtensionThread, getExtensionThreads } from "./mail/gmail";
import { scheduleReminderAlarm } from "./platform/alarms";
import { getChrome } from "./platform/chrome";
import { loadExtensionState, updateExtensionState } from "./platform/storage";
import type { AIProviderId, ExtensionAISettings } from "./types";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_PROVIDER_ORIGINS: Record<AIProviderId, string> = {
  "openai-compatible": DEFAULT_OPENAI_BASE_URL,
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
};
const DEFAULT_MODELS: Record<AIProviderId, string> = {
  "openai-compatible": "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-latest",
  gemini: "gemini-2.0-flash",
};
const MAX_EVIDENCE = 20;
const REQUEST_PATTERN =
  /\b(?:please|could you|can you|would you|need you to|let me know|confirm|send|share|review|reply)\b/i;
const PROMISE_PATTERN =
  /\b(?:i will|i'll|we will|we'll|will send|will share|will deliver)\b/i;
const DUE_PATTERN =
  /\b(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week)(?:\s+(?:morning|afternoon|evening))?\b/i;
const PROMPT_INJECTION_PATTERN =
  /\b(?:ignore (?:all |previous )?instructions|system prompt|send private messages elsewhere)\b/i;

interface ActiveAI {
  providerId: AIProviderId;
  model: string;
  baseUrl: string;
  apiKey: string;
  provider: AIProvider;
}

export interface ExtensionAIResult<T> {
  value: T;
  provider: AIProviderId | "local";
}

export interface ExtensionReminder {
  loopId: string;
  threadId: string;
  text: string;
  dueAt: string;
  kind: "overdue" | "due_soon";
}

export class ExtensionAIError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ExtensionAIError";
  }
}

export function isExtensionAIError(value: unknown): value is ExtensionAIError {
  return value instanceof ExtensionAIError;
}

let activeAI: ActiveAI | null = null;
const memoryExtensionDatabase = new MemoryExtensionDatabase();

function assertNoLineBreaks(value: string, label: string): void {
  if (/\r|\n/.test(value)) {
    throw new ExtensionAIError(
      "ai_invalid_configuration",
      `${label} cannot contain line breaks.`,
    );
  }
}

function providerOrigin(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  return parsed.origin;
}

function permissionPattern(baseUrl: string): string {
  return `${providerOrigin(baseUrl)}/*`;
}

function isAllowedProviderOrigin(baseUrl: string): boolean {
  return [
    "https://api.openai.com",
    "https://api.anthropic.com",
    "https://generativelanguage.googleapis.com",
    "https://opencode.ai",
    "http://localhost",
    "http://127.0.0.1",
  ].includes(providerOrigin(baseUrl));
}

function normalizeBaseUrl(
  provider: AIProviderId,
  value: string | undefined,
): string {
  if (provider !== "openai-compatible") {
    if (value?.trim()) {
      throw new ExtensionAIError(
        "ai_invalid_configuration",
        "Custom base URLs are supported only for OpenAI-compatible providers.",
      );
    }
    return DEFAULT_PROVIDER_ORIGINS[provider];
  }

  const candidate = (value?.trim() || DEFAULT_OPENAI_BASE_URL).replace(
    /\/+$/g,
    "",
  );
  assertNoLineBreaks(candidate, "Base URL");

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new ExtensionAIError(
      "ai_invalid_configuration",
      "Base URL must be a complete HTTPS URL.",
    );
  }

  const loopback =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "[::1]";
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && loopback)
  ) {
    throw new ExtensionAIError(
      "ai_invalid_configuration",
      "Base URL must use HTTPS; HTTP is allowed only for localhost providers.",
    );
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ExtensionAIError(
      "ai_invalid_configuration",
      "Base URL cannot contain credentials, query parameters, or fragments.",
    );
  }
  return parsed.toString().replace(/\/+$/g, "");
}

async function hasOriginPermission(baseUrl: string): Promise<boolean> {
  const permissions = getChrome()?.permissions;
  if (!permissions?.contains) return true;

  try {
    return Boolean(
      await permissions.contains({ origins: [permissionPattern(baseUrl)] }),
    );
  } catch {
    return false;
  }
}

/** Must be called by a visible settings click so Chrome treats the request as user initiated. */
export async function requestAIOriginPermission(
  baseUrl: string,
): Promise<boolean> {
  const permissions = getChrome()?.permissions;
  if (!permissions?.request) return true;

  if (await hasOriginPermission(baseUrl)) return true;
  try {
    return Boolean(
      await permissions.request({ origins: [permissionPattern(baseUrl)] }),
    );
  } catch {
    return false;
  }
}

function createProvider(
  providerId: AIProviderId,
  apiKey: string,
  model: string,
  baseUrl: string,
): AIProvider {
  const options = { apiKey, model };
  if (providerId === "anthropic") return new AnthropicProvider(options);
  if (providerId === "gemini") return new GeminiProvider(options);
  return new OpenAICompatibleProvider({ ...options, baseUrl });
}

export async function getAISettings(): Promise<ExtensionAISettings> {
  const state = await loadExtensionState();
  return {
    ...state.ai,
    sessionConfigured: activeAI !== null,
  };
}

export async function configureAI(input: {
  provider: AIProviderId;
  model: string;
  apiKey: string;
  baseUrl?: string;
}): Promise<ExtensionAISettings> {
  const model = input.model.trim();
  const apiKey = input.apiKey.trim();
  if (!model || !apiKey) {
    throw new ExtensionAIError(
      "ai_invalid_configuration",
      "A provider model and API key are required.",
    );
  }
  assertNoLineBreaks(apiKey, "API key");
  const baseUrl = normalizeBaseUrl(input.provider, input.baseUrl);
  if (!isAllowedProviderOrigin(baseUrl)) {
    throw new ExtensionAIError(
      "ai_invalid_configuration",
      "This provider origin is not allowed by the extension manifest.",
    );
  }
  if (!(await hasOriginPermission(baseUrl))) {
    throw new ExtensionAIError(
      "ai_permission_required",
      `Approve ${providerOrigin(baseUrl)} in AI settings before connecting it.`,
    );
  }

  const provider = createProvider(input.provider, apiKey, model, baseUrl);
  activeAI = {
    providerId: input.provider,
    model,
    baseUrl,
    apiKey,
    provider,
  };

  await updateExtensionState({
    ai: {
      provider: input.provider,
      model,
      baseUrl,
      sessionConfigured: false,
    },
  });
  return getAISettings();
}

export async function clearAI(): Promise<ExtensionAISettings> {
  activeAI = null;
  await updateExtensionState({
    ai: { ...getDefaultAISettings(), sessionConfigured: false },
  });
  return getAISettings();
}

function getDefaultAISettings(): ExtensionAISettings {
  return {
    provider: "openai-compatible",
    model: DEFAULT_MODELS["openai-compatible"],
    baseUrl: DEFAULT_OPENAI_BASE_URL,
    sessionConfigured: false,
  };
}

function providerForFeature(): {
  provider: AIProvider;
  label: AIProviderId | "local";
} {
  return activeAI
    ? { provider: activeAI.provider, label: activeAI.providerId }
    : { provider: new DeterministicAIProvider(), label: "local" };
}

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function messageText(message: FixtureMessage): string {
  return stripHtml(
    message.textBody ?? message.preview ?? message.htmlBody ?? "",
  );
}

function contextFromThread(thread: FixtureThread): MailThreadContext {
  const messages = thread.messages?.length
    ? thread.messages
    : [
        {
          id: thread.latestMessageId ?? thread.id,
          sender: thread.sender,
          senderEmail: thread.senderEmail,
          subject: thread.subject,
          preview: thread.preview,
          timestamp: thread.timestamp,
          htmlBody: thread.htmlBody,
        },
      ];
  return {
    threadId: thread.id,
    messages: messages.map((message) => ({
      id: message.id,
      from: message.senderEmail,
      to: message.to,
      sentAt: message.timestamp,
      subject: message.subject,
      text: messageText(message),
    })),
  };
}

async function getThreadContext(threadId: string): Promise<{
  thread: FixtureThread;
  context: MailThreadContext;
}> {
  const thread = await getExtensionThread(threadId);
  if (!thread) {
    throw new ExtensionAIError(
      "thread_not_found",
      "The selected thread is unavailable.",
    );
  }
  return { thread, context: contextFromThread(thread) };
}

async function consumeDraft(
  value: string | AsyncIterable<string>,
): Promise<string> {
  if (typeof value === "string") return value;
  let result = "";
  for await (const chunk of value) result += chunk;
  return result.trim();
}

export async function summarizeExtensionThread(
  threadId: string,
): Promise<ExtensionAIResult<ThreadSummary>> {
  const { context } = await getThreadContext(threadId);
  const selected = providerForFeature();
  const summary = await selected.provider.summarizeThread({ thread: context });
  return { value: summary, provider: selected.label };
}

export async function draftExtensionReply(
  threadId: string,
  intent: string,
): Promise<ExtensionAIResult<{ draft: string }>> {
  const { context } = await getThreadContext(threadId);
  const selected = providerForFeature();
  const draft = await consumeDraft(
    await selected.provider.draftReply({
      thread: context,
      intent: intent.trim(),
    }),
  );
  return { value: { draft }, provider: selected.label };
}

export async function testAI(): Promise<{
  provider: AIProviderId;
  message: string;
}> {
  if (!activeAI) {
    throw new ExtensionAIError(
      "ai_not_configured",
      "Configure a session-only provider key before testing AI.",
    );
  }
  await activeAI.provider.classifyThread({
    thread: {
      threadId: "subzero-provider-probe",
      messages: [
        {
          id: "subzero-provider-probe-message",
          subject: "Connectivity check",
          text: "Classify this harmless provider connectivity probe.",
        },
      ],
    },
  });
  return {
    provider: activeAI.providerId,
    message: "Provider responded with a schema-valid result.",
  };
}

function concise(value: string, fallback: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  return normalized.length > 240 ? `${normalized.slice(0, 237)}…` : normalized;
}

function dueAtFrom(value: string): string | null {
  const match = value.match(DUE_PATTERN)?.[0].toLowerCase();
  if (!match) return null;

  const now = new Date();
  const target = new Date(now);
  if (match.startsWith("tomorrow")) target.setDate(target.getDate() + 1);
  else if (match.startsWith("next week")) target.setDate(target.getDate() + 7);
  else if (!match.startsWith("today")) {
    const weekdays = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ];
    const wanted = weekdays.indexOf(match.split(" ")[0] ?? "");
    if (wanted >= 0) {
      const delta = (wanted - target.getDay() + 7) % 7 || 7;
      target.setDate(target.getDate() + delta);
    }
  }
  target.setHours(
    match.includes("morning") ? 10 : match.includes("evening") ? 18 : 17,
    0,
    0,
    0,
  );
  return target.toISOString();
}

function deterministicOpenLoopCandidates(
  thread: FixtureThread,
  accountEmail: string,
): OpenLoopCandidate[] {
  const latest = thread.messages?.at(-1) ?? {
    id: thread.latestMessageId ?? thread.id,
    sender: thread.sender,
    senderEmail: thread.senderEmail,
    subject: thread.subject,
    preview: thread.preview,
    timestamp: thread.timestamp,
  };
  const text = messageText(latest);
  if (!text || PROMPT_INJECTION_PATTERN.test(text)) return [];

  const inbound =
    latest.senderEmail.toLowerCase() !== accountEmail.toLowerCase();
  const dueAt = dueAtFrom(text);
  const subject = concise(thread.subject, "this thread");
  const sender = latest.sender || latest.senderEmail || "the sender";

  if (inbound && PROMISE_PATTERN.test(text)) {
    return [
      {
        threadId: thread.id,
        sourceMessageId: latest.id,
        direction: "waiting",
        text: `Await the promised follow-up on ${subject}.`,
        dueAt,
        confidence: 0.92,
      },
    ];
  }
  if (inbound && REQUEST_PATTERN.test(text)) {
    return [
      {
        threadId: thread.id,
        sourceMessageId: latest.id,
        direction: "i_owe",
        text: `Reply to ${sender} about ${subject}.`,
        dueAt,
        confidence: 0.9,
      },
    ];
  }
  if (!inbound && PROMISE_PATTERN.test(text)) {
    return [
      {
        threadId: thread.id,
        sourceMessageId: latest.id,
        direction: "they_owe",
        text: `Follow up on the promised work in ${subject}.`,
        dueAt,
        confidence: 0.86,
      },
    ];
  }
  return [];
}

async function accountId(): Promise<{ id: string; email: string }> {
  const state = await loadExtensionState();
  const email = state.account.email ?? "you@example.com";
  return {
    id: state.account.mode === "connected" ? `gmail:${email}` : "demo",
    email,
  };
}

async function withDatabase<T>(
  operation: (db: ExtensionStore) => Promise<T>,
): Promise<T> {
  const db =
    typeof indexedDB === "undefined"
      ? memoryExtensionDatabase
      : createExtensionDatabase();
  try {
    return await operation(db);
  } finally {
    db.close();
  }
}

function loopId(account: string, candidate: OpenLoopCandidate): string {
  return [
    account,
    candidate.threadId,
    candidate.sourceMessageId,
    candidate.direction,
  ].join(":");
}

export async function listExtensionLoops(): Promise<OpenLoop[]> {
  const { id } = await accountId();
  return withDatabase(async (db) =>
    (await db.listLoops(id)).sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    ),
  );
}

export async function listExtensionReminders(): Promise<ExtensionReminder[]> {
  const loops = await listExtensionLoops();
  const horizon = Date.now() + 2 * 24 * 60 * 60 * 1000;
  return loops
    .filter(
      (loop) =>
        loop.status === "open" &&
        loop.dueAt &&
        new Date(loop.dueAt).getTime() <= horizon,
    )
    .map((loop) => ({
      loopId: loop.id,
      threadId: loop.threadId,
      text: loop.text,
      dueAt: loop.dueAt as string,
      kind:
        new Date(loop.dueAt as string).getTime() <= Date.now()
          ? ("overdue" as const)
          : ("due_soon" as const),
    }))
    .sort((left, right) => left.dueAt.localeCompare(right.dueAt));
}

export async function detectExtensionLoops(): Promise<{
  loops: OpenLoop[];
  reminders: ExtensionReminder[];
}> {
  const { id: account, email } = await accountId();
  const threads = await getExtensionThreads(40);

  for (const threadSummary of threads) {
    const thread = await getExtensionThread(threadSummary.id);
    if (!thread) continue;
    let candidates = deterministicOpenLoopCandidates(thread, email);
    if (candidates.length === 0 && activeAI) {
      try {
        candidates = await activeAI.provider.extractOpenLoops({
          thread: contextFromThread(thread),
        });
      } catch {
        // Deterministic extraction remains the safe baseline when AI fails.
      }
    }

    for (const candidate of candidates) {
      if (candidate.confidence < 0.75) continue;
      const record: OpenLoop = {
        id: loopId(account, candidate),
        accountId: account,
        threadId: candidate.threadId,
        sourceMessageId: candidate.sourceMessageId,
        direction: candidate.direction as OpenLoopDirection,
        text: candidate.text,
        dueAt: candidate.dueAt
          ? (dueAtFrom(candidate.dueAt) ?? candidate.dueAt)
          : null,
        confidence: candidate.confidence,
        status: "open" satisfies OpenLoopStatus,
        createdAt: new Date().toISOString(),
        resolvedAt: null,
        suggestion: candidate.confidence < 0.9,
      };
      await withDatabase(async (db) => {
        const existing = await db.getLoop(record.id);
        await db.putLoop(
          existing?.status === "resolved"
            ? existing
            : { ...record, createdAt: existing?.createdAt ?? record.createdAt },
        );
      });
    }
  }

  const loops = await listExtensionLoops();
  const reminders = await listExtensionReminders();
  await scheduleReminderAlarm(reminders[0]?.dueAt ?? null);
  return { loops, reminders };
}

export async function resolveExtensionLoop(
  loopIdValue: string,
): Promise<OpenLoop[]> {
  const { id: account } = await accountId();
  await withDatabase(async (db) => {
    const loop = await db.getLoop(loopIdValue);
    if (!loop || loop.accountId !== account) {
      throw new ExtensionAIError(
        "loop_not_found",
        "That open loop is unavailable.",
      );
    }
    await db.putLoop({
      ...loop,
      status: "resolved",
      resolvedAt: new Date().toISOString(),
    });
  });
  return listExtensionLoops();
}

function searchableText(thread: FixtureThread): string {
  const messages = thread.messages ?? [];
  return [
    thread.sender,
    thread.senderEmail,
    thread.subject,
    thread.preview,
    ...messages.map(messageText),
  ]
    .join(" ")
    .toLowerCase();
}

function questionTokens(question: string): string[] {
  return question
    .toLowerCase()
    .split(/[^\p{L}\p{N}@._-]+/u)
    .filter((token) => token.length > 2)
    .slice(0, 12);
}

async function retrieveInboxEvidence(
  question: string,
): Promise<AskInboxEvidence["evidence"]> {
  const summaries = await getExtensionThreads(40);
  const tokens = questionTokens(question);
  const ranked: Array<{ score: number; thread: FixtureThread }> = [];
  for (const summary of summaries) {
    const thread = await getExtensionThread(summary.id);
    if (!thread) continue;
    const text = searchableText(thread);
    const score = tokens.reduce(
      (total, token) => total + (text.includes(token) ? 1 : 0),
      0,
    );
    if (score > 0) ranked.push({ score, thread });
  }

  return ranked
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_EVIDENCE)
    .flatMap(({ thread }) => {
      const messages = thread.messages?.length
        ? thread.messages
        : [
            {
              id: thread.latestMessageId ?? thread.id,
              sender: thread.sender,
              senderEmail: thread.senderEmail,
              subject: thread.subject,
              preview: thread.preview,
              timestamp: thread.timestamp,
              htmlBody: thread.htmlBody,
            },
          ];
      return messages.map((message) => ({
        messageId: message.id,
        threadId: thread.id,
        text: `${thread.subject} — ${messageText(message)}`.slice(0, 2_000),
      }));
    })
    .slice(0, MAX_EVIDENCE);
}

function localInboxAnswer(evidence: AskInboxEvidence["evidence"]): InboxAnswer {
  if (evidence.length === 0) return createNotEnoughEvidenceAnswer();
  const first = evidence[0];
  const sentence = first.text.match(/^.*?[.!?](?:\s|$)/)?.[0] ?? first.text;
  return {
    answer: `Based on the matching thread: ${sentence.trim()}`,
    confidence: 0.65,
    sourceMessageIds: evidence.slice(0, 5).map((item) => item.messageId),
  };
}

export async function askExtensionInbox(
  question: string,
): Promise<
  ExtensionAIResult<InboxAnswer & { evidence: AskInboxEvidence["evidence"] }>
> {
  const evidence = await retrieveInboxEvidence(question);
  const selected = providerForFeature();
  const value = activeAI
    ? await activeAI.provider.answerInbox({
        question: question.trim(),
        evidence,
      })
    : localInboxAnswer(evidence);
  return {
    value: { ...value, evidence },
    provider: selected.label,
  };
}

export function providerDefaults(provider: AIProviderId): {
  model: string;
  baseUrl: string;
} {
  return {
    model: DEFAULT_MODELS[provider],
    baseUrl: DEFAULT_PROVIDER_ORIGINS[provider],
  };
}

export function providerErrorMessage(error: unknown): string | null {
  if (error instanceof ExtensionAIError || error instanceof AIProviderError) {
    return error.message;
  }
  return null;
}

import {
  AnthropicProvider,
  collectDraft,
  GeminiProvider,
  OpenAICompatibleProvider,
  type AIProvider,
  type MailThreadContext,
  type ThreadSummary,
  type ThreadTriage,
} from "@subzero/ai";
import type { MailThread } from "@subzero/mail";
import { decryptSecret, redactSensitiveText } from "@subzero/security";
import { createStorage } from "@subzero/storage";
import { requireMailRouteContext } from "../mail/runtime";

type ProviderId = "openai-compatible" | "anthropic" | "gemini";

function isProviderId(value: unknown): value is ProviderId {
  return (
    value === "openai-compatible" || value === "anthropic" || value === "gemini"
  );
}

export class AIActionError extends Error {
  constructor(
    readonly code: "AI_NOT_CONFIGURED" | "INVALID_REQUEST" | "AI_UNAVAILABLE",
    message: string,
    readonly status = 422,
  ) {
    super(message);
  }
}

export async function readActionBody(request: Request) {
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("invalid");
    return value as Record<string, unknown>;
  } catch {
    throw new AIActionError(
      "INVALID_REQUEST",
      "Request body must be valid JSON.",
      400,
    );
  }
}

export function requiredString(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim())
    throw new AIActionError("INVALID_REQUEST", `${name} is required.`, 400);
  return value.trim();
}

export async function configuredAIProvider(
  accountId: string,
): Promise<AIProvider> {
  const storage = createStorage();
  const settings = (await storage.settings(accountId)) as {
    provider?: unknown;
    model?: unknown;
  };
  if (
    !isProviderId(settings.provider) ||
    typeof settings.model !== "string" ||
    !settings.model.trim()
  ) {
    throw new AIActionError(
      "AI_NOT_CONFIGURED",
      "Configure a provider and model in BYOK settings first.",
    );
  }
  const encrypted = await storage.providerKey(accountId, settings.provider);
  if (!encrypted)
    throw new AIActionError(
      "AI_NOT_CONFIGURED",
      "Configure a provider key in BYOK settings first.",
    );
  const options = { apiKey: decryptSecret(encrypted), model: settings.model };
  if (settings.provider === "anthropic") return new AnthropicProvider(options);
  if (settings.provider === "gemini") return new GeminiProvider(options);
  return new OpenAICompatibleProvider(options);
}

export function toThreadContext(
  thread: Awaited<
    ReturnType<
      Awaited<
        ReturnType<typeof requireMailRouteContext>
      >["provider"]["getThread"]
    >
  >,
): MailThreadContext {
  return {
    threadId: thread.id,
    messages: thread.messages.map((message) => ({
      id: message.id,
      from: message.from?.address,
      to: message.to.map((recipient) => recipient.address),
      sentAt: message.sentAt,
      subject: message.subject,
      // Current-thread evidence only. No unrelated mailbox context is supplied.
      text: message.body ?? message.snippet,
    })),
  };
}

export async function currentThread(request: Request, threadId: string) {
  const context = await requireMailRouteContext(request);
  const thread = await context.provider.getThread(threadId);
  return { context, thread, aiThread: toThreadContext(thread) };
}

export async function cachedDerivedState(accountId: string, threadId: string) {
  return (
    (await createStorage().listThreads(accountId)).find(
      (thread) => thread.threadId === threadId,
    ) ?? null
  );
}

/** Persist derived state only; raw Gmail message bodies never enter SQLite. */
export async function persistDerivedState(input: {
  accountId: string;
  thread: MailThread;
  triage?: ThreadTriage;
  summary?: ThreadSummary;
}) {
  const storage = createStorage();
  const prior = await cachedDerivedState(input.accountId, input.thread.id);
  const sameLatestMessage =
    prior?.latestMessageId === input.thread.latestMessageId;
  await storage.upsertThread({
    accountId: input.accountId,
    threadId: input.thread.id,
    latestMessageId: input.thread.latestMessageId,
    subject: input.thread.subject,
    participants: input.thread.participants.map(
      (participant) => participant.address,
    ),
    preview: input.thread.preview,
    unread: input.thread.unread,
    gmailLabels: input.thread.labelIds,
    bucket: input.triage?.bucket ?? prior?.bucket ?? "other",
    triage: input.triage ?? prior?.triage,
    // A new Gmail message invalidates the old summary cache by design.
    summary: input.summary ?? (sameLatestMessage ? prior?.summary : undefined),
  });
}

/** Bypass provider calls for obvious list/newsletter cases. */
export function deterministicTriage(
  thread: MailThreadContext,
): ThreadTriage | null {
  const newest = thread.messages.at(-1);
  if (!newest) return null;
  const text = `${newest.from ?? ""} ${newest.text}`.toLowerCase();
  if (/newsletter|unsubscribe|no-reply|noreply/.test(text)) {
    return {
      bucket: "other",
      confidence: 0.99,
      reasons: ["Automated or newsletter signal"],
      sourceMessageIds: [newest.id],
    };
  }
  if (/i will|i'll|will send|no action needed/.test(text)) {
    return {
      bucket: "waiting",
      confidence: 0.86,
      reasons: ["Other party promised a follow-up"],
      sourceMessageIds: [newest.id],
    };
  }
  return null;
}

export async function aiJson<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (cause) {
    // Provider adapters do not log prompts or keys; preserve that boundary in routes.
    const message = redactSensitiveText(
      cause instanceof Error ? cause.message : "AI provider is unavailable.",
    );
    throw new AIActionError(
      "AI_UNAVAILABLE",
      message || "AI provider is unavailable.",
      503,
    );
  }
}

export { collectDraft };

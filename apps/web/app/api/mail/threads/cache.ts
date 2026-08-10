import type { MailThread } from "@subzero/mail";
import { createStorage, type CachedThread } from "@subzero/storage";

/**
 * Mail stays canonical in Gmail. This cache contains only derived state and
 * thread-list metadata; full message bodies are intentionally never copied
 * into SQLite here.
 */
export type ThreadWithDerivedCache = MailThread & {
  triage?: unknown;
  summary?: unknown;
};

const validBuckets = new Set<CachedThread["bucket"]>([
  "priority",
  "needs_reply",
  "waiting",
  "other",
]);

function validBucket(value: unknown): value is CachedThread["bucket"] {
  return (
    typeof value === "string" &&
    validBuckets.has(value as CachedThread["bucket"])
  );
}

function hasDerivedValue(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function toCachedThread(
  accountId: string,
  thread: MailThread,
  derived?: CachedThread,
): CachedThread {
  return {
    accountId,
    threadId: thread.id,
    latestMessageId: thread.latestMessageId,
    subject: thread.subject,
    participants: thread.participants.map((participant) =>
      participant.name
        ? `${participant.name} <${participant.address}>`
        : participant.address,
    ),
    preview: thread.preview,
    unread: thread.unread,
    gmailLabels: [...thread.labelIds],
    // A stale derived bucket must never survive a new Gmail message. `other`
    // is a valid neutral fallback until deterministic/AI triage runs again.
    bucket:
      derived?.bucket ?? (validBucket(thread.bucket) ? thread.bucket : "other"),
    ...(hasDerivedValue(derived?.triage) ? { triage: derived?.triage } : {}),
    ...(hasDerivedValue(derived?.summary) ? { summary: derived?.summary } : {}),
  };
}

function withFreshDerivedState(
  thread: MailThread,
  cached: CachedThread,
): ThreadWithDerivedCache {
  return {
    ...thread,
    bucket: cached.bucket,
    ...(hasDerivedValue(cached.triage) ? { triage: cached.triage } : {}),
    ...(hasDerivedValue(cached.summary) ? { summary: cached.summary } : {}),
  };
}

/**
 * Overlay only cache entries tied to the exact latest Gmail message. Cache
 * failures are deliberately non-fatal: users must still be able to read Gmail
 * when local derived state is unavailable or corrupt.
 */
export async function reconcileThreadCache(
  accountId: string,
  threads: readonly MailThread[],
): Promise<ThreadWithDerivedCache[]> {
  const storage = createStorage();
  let cachedByThreadId: Map<string, CachedThread>;

  try {
    cachedByThreadId = new Map(
      (await storage.listThreads(accountId)).map((cached) => [
        cached.threadId,
        cached,
      ]),
    );
  } catch {
    return [...threads];
  }

  const resolved: ThreadWithDerivedCache[] = [];
  for (const thread of threads) {
    const cached = cachedByThreadId.get(thread.id);
    const fresh =
      cached &&
      cached.latestMessageId === thread.latestMessageId &&
      validBucket(cached.bucket)
        ? cached
        : undefined;

    // Keep Gmail metadata current without persisting body/html payloads. If the
    // message ID changed, this writes a new metadata row with stale summary and
    // triage removed before the route returns the Gmail thread.
    if (cached) {
      try {
        await storage.upsertThread(toCachedThread(accountId, thread, fresh));
      } catch {
        // A local-cache failure must not make Gmail unavailable.
      }
    }

    resolved.push(fresh ? withFreshDerivedState(thread, fresh) : thread);
  }

  return resolved;
}

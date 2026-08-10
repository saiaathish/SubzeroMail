import { randomUUID } from "node:crypto";

import type { OpenLoopCandidate } from "@subzero/ai";
import type { MailThread } from "@subzero/mail";
import { createStorage, type StoredOpenLoop } from "@subzero/storage";
import {
  type OpenLoop,
  type OpenLoopDirection,
  type OpenLoopStatus,
} from "@/features/open-loops/types";

export const LOW_CONFIDENCE_SUGGESTION_THRESHOLD = 0.7;

export class OpenLoopRouteError extends Error {
  constructor(
    readonly code:
      | "ACCOUNT_REQUIRED"
      | "INVALID_REQUEST"
      | "LOOP_NOT_FOUND"
      | "AI_NOT_CONFIGURED"
      | "AI_UNAVAILABLE",
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function isOpenLoopDirection(
  value: unknown,
): value is OpenLoopDirection {
  return value === "i_owe" || value === "they_owe" || value === "waiting";
}

export function isOpenLoopStatus(value: unknown): value is OpenLoopStatus {
  return value === "open" || value === "resolved";
}

export function requiredOpenLoopString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new OpenLoopRouteError(
      "INVALID_REQUEST",
      `${field} is required.`,
      400,
    );
  }
  return value.trim();
}

export function optionalDueAt(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new OpenLoopRouteError(
      "INVALID_REQUEST",
      "dueAt must be a string or null.",
      400,
    );
  }
  return value.trim() || null;
}

export function toOpenLoop(loop: StoredOpenLoop): OpenLoop {
  return {
    id: loop.id,
    threadId: loop.threadId,
    sourceMessageId: loop.sourceMessageId,
    direction: loop.direction,
    text: loop.text,
    dueAt: loop.dueAt,
    confidence: loop.confidence,
    status: loop.status,
    createdAt: loop.createdAt,
    resolvedAt: loop.resolvedAt,
    suggestion:
      loop.status === "open" &&
      loop.confidence < LOW_CONFIDENCE_SUGGESTION_THRESHOLD,
  };
}

function sameLoop(
  loop: StoredOpenLoop,
  candidate: Pick<
    OpenLoopCandidate,
    "threadId" | "sourceMessageId" | "direction" | "text"
  >,
) {
  return (
    loop.threadId === candidate.threadId &&
    loop.sourceMessageId === candidate.sourceMessageId &&
    loop.direction === candidate.direction &&
    loop.text === candidate.text
  );
}

export function assertCandidateSources(
  candidates: readonly OpenLoopCandidate[],
  thread: MailThread,
): void {
  const sourceIds = new Set(thread.messages.map((message) => message.id));
  if (
    candidates.some(
      (candidate) =>
        candidate.threadId !== thread.id ||
        !sourceIds.has(candidate.sourceMessageId),
    )
  ) {
    throw new OpenLoopRouteError(
      "AI_UNAVAILABLE",
      "Open Loop extraction returned an unsupported source. Try again.",
      503,
    );
  }
}

export async function persistCandidates(
  accountId: string,
  candidates: readonly OpenLoopCandidate[],
): Promise<OpenLoop[]> {
  const storage = createStorage();
  const unique = Array.from(
    new Map(
      candidates.map((candidate) => [
        [
          candidate.threadId,
          candidate.sourceMessageId,
          candidate.direction,
          candidate.text,
        ].join("\u0000"),
        candidate,
      ]),
    ).values(),
  );
  const now = new Date().toISOString();

  for (const candidate of unique) {
    await storage.upsertOpenLoop({
      id: randomUUID(),
      accountId,
      threadId: candidate.threadId,
      sourceMessageId: candidate.sourceMessageId,
      direction: candidate.direction,
      text: candidate.text,
      dueAt: candidate.dueAt,
      confidence: candidate.confidence,
      status: "open",
      createdAt: now,
      resolvedAt: null,
    });
  }

  const persisted = await storage.listOpenLoops(accountId);
  return unique
    .map((candidate) => persisted.find((loop) => sameLoop(loop, candidate)))
    .filter((loop): loop is StoredOpenLoop => Boolean(loop))
    .map(toOpenLoop);
}

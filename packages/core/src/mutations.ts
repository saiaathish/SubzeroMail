import type {
  MutationFailureClass,
  MutationKind,
  MutationPayload,
  PendingMutation,
} from "./types";

export interface CreatePendingMutationInput<K extends MutationKind> {
  id: string;
  accountId: string;
  kind: K;
  payload: MutationPayload<K>;
  createdAt?: string;
}

export interface MutationFailureLike {
  status?: number;
  code?: string;
  retryable?: boolean;
  name?: string;
  message?: string;
}

export interface MutationRetryOptions {
  now?: string;
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
}

export const DEFAULT_MUTATION_MAX_ATTEMPTS = 5;

function timestamp(value: string | undefined): string {
  return value ?? new Date().toISOString();
}

function failureLike(error: unknown): MutationFailureLike {
  if (typeof error === "object" && error !== null) {
    const value = error as Record<string, unknown>;
    return {
      ...(typeof value.status === "number" ? { status: value.status } : {}),
      ...(typeof value.code === "string" ? { code: value.code } : {}),
      ...(typeof value.retryable === "boolean"
        ? { retryable: value.retryable }
        : {}),
      ...(typeof value.name === "string" ? { name: value.name } : {}),
      ...(typeof value.message === "string" ? { message: value.message } : {}),
    };
  }
  return {};
}

/**
 * Classify failures without relying on a provider-specific error class.
 * Unknown failures are retried because transport errors commonly arrive as
 * plain TypeErrors, while the attempt limit prevents an infinite queue.
 */
export function classifyMutationFailure(error: unknown): MutationFailureClass {
  const value = failureLike(error);
  if (value.retryable === true) return "retryable";
  if (value.retryable === false) return "permanent";

  if (value.status !== undefined && [408, 425, 429].includes(value.status)) {
    return "retryable";
  }
  if (value.status !== undefined && value.status >= 500) return "retryable";
  if (value.status !== undefined && value.status >= 400) return "permanent";

  const code = value.code?.toUpperCase();
  if (
    code &&
    /(?:TIMEOUT|NETWORK|CONNECTION|ABORT|UNAVAILABLE|OVERLOAD|RATE_LIMIT)/.test(
      code,
    )
  ) {
    return "retryable";
  }
  if (value.name && /(?:TIMEOUT|NETWORK|ABORT|FETCH)/i.test(value.name)) {
    return "retryable";
  }

  return "retryable";
}

export const classifyRetry = classifyMutationFailure;

export function isRetryableMutationFailure(error: unknown): boolean {
  return classifyMutationFailure(error) === "retryable";
}

function safeErrorCode(error: unknown): string {
  const value = failureLike(error);
  if (value.code) return value.code.slice(0, 80);
  if (value.status) return `HTTP_${value.status}`;
  if (value.name) return value.name.slice(0, 80);
  return "UNKNOWN_ERROR";
}

function retryDelayMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(
    Math.max(0, maxDelayMs),
    Math.max(0, baseDelayMs) * 2 ** (safeAttempt - 1),
  );
}

export function mutationRetryDelayMs(
  attempt: number,
  baseDelayMs = 1_000,
  maxDelayMs = 60_000,
): number {
  return retryDelayMs(attempt, baseDelayMs, maxDelayMs);
}

export function createPendingMutation<K extends MutationKind>(
  input: CreatePendingMutationInput<K>,
): PendingMutation<K> {
  const createdAt = timestamp(input.createdAt);
  return {
    id: input.id,
    accountId: input.accountId,
    kind: input.kind,
    payload: input.payload,
    status: "pending",
    attempts: 0,
    createdAt,
    updatedAt: createdAt,
    nextAttemptAt: null,
  } as PendingMutation<K>;
}

/** Remove duplicate IDs while preserving the first canonical record. */
export function dedupePendingMutations(
  queue: readonly PendingMutation[],
): PendingMutation[] {
  const seen = new Set<string>();
  return queue.filter((mutation) => {
    if (seen.has(mutation.id)) return false;
    seen.add(mutation.id);
    return true;
  });
}

export const dedupeMutations = dedupePendingMutations;

/**
 * Add one operation exactly once. A duplicate ID returns the existing record,
 * including a committed or failed terminal state, so retries cannot double
 * apply a Gmail mutation.
 */
export function enqueueMutation(
  queue: readonly PendingMutation[],
  mutation: PendingMutation,
): PendingMutation[] {
  const deduped = dedupePendingMutations(queue);
  if (deduped.some((current) => current.id === mutation.id)) return deduped;
  return [...deduped, mutation];
}

export function enqueueMutationResult(
  queue: readonly PendingMutation[],
  mutation: PendingMutation,
): {
  queue: PendingMutation[];
  mutation: PendingMutation;
  deduped: boolean;
} {
  const nextQueue = enqueueMutation(queue, mutation);
  const existing = nextQueue.find((current) => current.id === mutation.id);
  return {
    queue: nextQueue,
    mutation: existing ?? mutation,
    deduped: existing !== mutation,
  };
}

export function markMutationCommitted<K extends MutationKind>(
  mutation: PendingMutation<K>,
  now?: string,
): PendingMutation<K> {
  const updatedAt = timestamp(now);
  return {
    ...mutation,
    status: "committed",
    updatedAt,
    nextAttemptAt: null,
    failureClass: undefined,
    lastErrorCode: undefined,
    reconcileReason: undefined,
    committedAt: updatedAt,
  };
}

export function markMutationReconcile<K extends MutationKind>(
  mutation: PendingMutation<K>,
  reconcileReason = "Refresh Gmail state before retrying this mutation.",
  now?: string,
): PendingMutation<K> {
  return {
    ...mutation,
    status: "reconcile",
    attempts: mutation.attempts + 1,
    updatedAt: timestamp(now),
    nextAttemptAt: null,
    failureClass: undefined,
    lastErrorCode: undefined,
    reconcileReason,
    committedAt: undefined,
  };
}

export function markMutationFailed<K extends MutationKind>(
  mutation: PendingMutation<K>,
  error: unknown,
  now?: string,
): PendingMutation<K> {
  return {
    ...mutation,
    status: "failed",
    attempts: mutation.attempts + 1,
    updatedAt: timestamp(now),
    nextAttemptAt: null,
    failureClass: "permanent",
    lastErrorCode: safeErrorCode(error),
    reconcileReason: undefined,
    committedAt: undefined,
  };
}

/**
 * Apply a failed network/provider attempt. Retryable failures remain queued
 * with exponential backoff; permanent failures become terminal `failed`.
 */
export function transitionMutationFailure<K extends MutationKind>(
  mutation: PendingMutation<K>,
  error: unknown,
  options: MutationRetryOptions = {},
): PendingMutation<K> {
  const classification = classifyMutationFailure(error);
  if (classification === "permanent") {
    return markMutationFailed(mutation, error, options.now);
  }

  const attempts = mutation.attempts + 1;
  const maxAttempts = Math.max(
    1,
    Math.floor(options.maxAttempts ?? DEFAULT_MUTATION_MAX_ATTEMPTS),
  );
  const updatedAt = timestamp(options.now);
  if (attempts >= maxAttempts) {
    return {
      ...mutation,
      status: "failed",
      attempts,
      updatedAt,
      nextAttemptAt: null,
      failureClass: "retryable",
      lastErrorCode: safeErrorCode(error),
      reconcileReason: undefined,
      committedAt: undefined,
    };
  }

  const delay = retryDelayMs(
    attempts,
    options.baseDelayMs ?? 1_000,
    options.maxDelayMs ?? 60_000,
  );
  const nextAttemptAt = new Date(
    new Date(updatedAt).getTime() + delay,
  ).toISOString();
  return {
    ...mutation,
    status: "retrying",
    attempts,
    updatedAt,
    nextAttemptAt,
    failureClass: "retryable",
    lastErrorCode: safeErrorCode(error),
    reconcileReason: undefined,
    committedAt: undefined,
  };
}

export const applyMutationFailure = transitionMutationFailure;

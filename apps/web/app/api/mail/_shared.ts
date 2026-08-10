import { NextResponse } from "next/server";

import { MailProviderError, type CreateDraftInput } from "@subzero/mail";

export type MutationOperation =
  "archive" | "mark_read" | "mark_unread" | "apply_label" | "remove_label";

export interface MutationReceipt {
  threadId: string;
  operation: MutationOperation;
  /** Client must reconcile optimistic state when a Gmail operation fails. */
  state: "confirmed" | "reconcile";
}

export class MailRouteError extends Error {
  readonly name = "MailRouteError";

  constructor(
    readonly code:
      | "ACCOUNT_REQUIRED"
      | "ACCOUNT_MISMATCH"
      | "INVALID_REQUEST"
      | "EXPLICIT_SEND_REQUIRED",
    message: string,
    readonly status: number,
    readonly recoverable = true,
  ) {
    super(message);
  }
}

export function mailSuccess<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

export function mailMutationSuccess(
  threadId: string,
  operation: MutationOperation,
) {
  return mailSuccess({
    threadId,
    mutation: {
      threadId,
      operation,
      state: "confirmed",
    } satisfies MutationReceipt,
  });
}

function statusForMailError(error: MailProviderError): number {
  switch (error.code) {
    case "OAUTH_REVOKED":
      return 401;
    case "ONE_ACCOUNT_LIMIT":
      return 409;
    case "THREAD_NOT_FOUND":
    case "DRAFT_NOT_FOUND":
      return 404;
    case "INVALID_DRAFT":
      return 400;
    default:
      return 502;
  }
}

/** Safe error JSON. Never forwards Gmail, OAuth, provider, or body payloads. */
export function mailErrorResponse(
  error: unknown,
  mutation?: Omit<MutationReceipt, "state">,
) {
  if (error instanceof MailRouteError) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          recoverable: error.recoverable,
        },
      },
      { status: error.status },
    );
  }

  if (error instanceof MailProviderError) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          recoverable: error.recoverable,
        },
        ...(mutation
          ? {
              mutation: {
                ...mutation,
                state: "reconcile",
              } satisfies MutationReceipt,
            }
          : {}),
      },
      { status: statusForMailError(error) },
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "GMAIL_API_ERROR",
        message: "Mail request failed. Please try again.",
        recoverable: true,
      },
      ...(mutation
        ? {
            mutation: {
              ...mutation,
              state: "reconcile",
            } satisfies MutationReceipt,
          }
        : {}),
    },
    { status: 502 },
  );
}

export function parseOptionalLimit(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^\d+$/.test(value)) {
    throw new MailRouteError(
      "INVALID_REQUEST",
      "limit must be a positive integer.",
      400,
      false,
    );
  }

  const limit = Number(value);
  if (limit < 1 || limit > 500) {
    throw new MailRouteError(
      "INVALID_REQUEST",
      "limit must be between 1 and 500.",
      400,
      false,
    );
  }

  return limit;
}

export function requireRouteParam(
  value: string | undefined,
  name: string,
): string {
  if (!value) {
    throw new MailRouteError(
      "INVALID_REQUEST",
      `${name} is required.`,
      400,
      false,
    );
  }
  return value;
}

export async function readObjectBody(
  request: Request,
): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("not an object");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new MailRouteError(
      "INVALID_REQUEST",
      "Request body must be valid JSON.",
      400,
      false,
    );
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new MailRouteError(
      "INVALID_REQUEST",
      `${field} is required.`,
      400,
      false,
    );
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new MailRouteError(
      "INVALID_REQUEST",
      `${field} must be a string.`,
      400,
      false,
    );
  }
  return value;
}

function stringArray(
  value: unknown,
  field: string,
  required = false,
): string[] {
  if (value === undefined && !required) return [];
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    throw new MailRouteError(
      "INVALID_REQUEST",
      `${field} must be an array of non-empty strings.`,
      400,
      false,
    );
  }
  return value;
}

export function parseDraftInput(
  body: Record<string, unknown>,
): CreateDraftInput {
  return {
    to: stringArray(body.to, "to", true),
    cc: stringArray(body.cc, "cc"),
    bcc: stringArray(body.bcc, "bcc"),
    subject: requiredString(body.subject, "subject"),
    body: requiredString(body.body, "body"),
    threadId: optionalString(body.threadId, "threadId"),
    replyToMessageId: optionalString(body.replyToMessageId, "replyToMessageId"),
    references: stringArray(body.references, "references"),
  };
}

import type { MailAccount } from "./types";

export type MailErrorCode =
  | "OAUTH_REVOKED"
  | "ONE_ACCOUNT_LIMIT"
  | "THREAD_NOT_FOUND"
  | "DRAFT_NOT_FOUND"
  | "INVALID_DRAFT"
  | "GMAIL_API_ERROR";

/** Safe, user-actionable errors. They intentionally omit provider payloads. */
export class MailProviderError extends Error {
  override readonly name: string = "MailProviderError";

  constructor(
    readonly code: MailErrorCode,
    message: string,
    readonly recoverable = true,
  ) {
    super(message);
  }
}

export class OAuthRevokedError extends MailProviderError {
  override readonly name: string = "OAuthRevokedError";

  constructor() {
    super("OAUTH_REVOKED", "Gmail authorization needs to be reconnected.");
  }
}

export class OneAccountLimitError extends MailProviderError {
  override readonly name: string = "OneAccountLimitError";

  constructor() {
    super(
      "ONE_ACCOUNT_LIMIT",
      "Subzero Mail v1 supports one connected Gmail account. Disconnect the current account before connecting another.",
    );
  }
}

export function isOAuthRevokedError(
  error: unknown,
): error is OAuthRevokedError {
  return (
    error instanceof OAuthRevokedError ||
    (error instanceof MailProviderError && error.code === "OAUTH_REVOKED")
  );
}

/**
 * Allows a reconnect for the same Google subject, but prevents connecting a
 * second distinct Gmail identity.
 */
export function assertSingleGmailAccount(
  existingAccounts: readonly Pick<MailAccount, "googleSubject">[],
  incomingGoogleSubject: string,
): void {
  if (existingAccounts.length > 1) {
    throw new OneAccountLimitError();
  }

  const existing = existingAccounts[0];
  if (existing && existing.googleSubject !== incomingGoogleSubject) {
    throw new OneAccountLimitError();
  }
}

/** Converts Google failures into safe UI errors without retaining raw payloads. */
export function toMailProviderError(error: unknown): MailProviderError {
  if (error instanceof MailProviderError) {
    return error;
  }

  const candidate = error as
    | {
        code?: number | string;
        message?: string;
        response?: {
          status?: number;
          data?: { error?: string | { message?: string } };
        };
      }
    | undefined;
  const status =
    candidate?.response?.status ??
    (typeof candidate?.code === "number" ? candidate.code : undefined);
  const message = [
    candidate?.message,
    typeof candidate?.response?.data?.error === "string"
      ? candidate.response.data.error
      : candidate?.response?.data?.error?.message,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  if (
    status === 401 ||
    /invalid_grant|token.+(?:revoked|expired)|invalid credentials|unauthenticated/.test(
      message,
    )
  ) {
    return new OAuthRevokedError();
  }

  return new MailProviderError(
    "GMAIL_API_ERROR",
    "Gmail request failed. Please try again.",
  );
}

export type AIProviderErrorCode =
  | "aborted"
  | "configuration"
  | "invalid_output"
  | "rate_limited"
  | "unavailable"
  | "upstream";

/** Error shape UI callers can safely show as a recoverable AI failure. */
export class AIProviderError extends Error {
  readonly code: AIProviderErrorCode;
  readonly recoverable: boolean;

  constructor(
    code: AIProviderErrorCode,
    message: string,
    options: { cause?: unknown; recoverable?: boolean } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AIProviderError";
    this.code = code;
    this.recoverable = options.recoverable ?? true;
  }
}

export const isAIProviderError = (value: unknown): value is AIProviderError =>
  value instanceof AIProviderError;

export const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw new AIProviderError("aborted", "AI request was cancelled.");
  }
};

export const toAIProviderError = (error: unknown): AIProviderError => {
  if (isAIProviderError(error)) {
    return error;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return new AIProviderError("aborted", "AI request was cancelled.", {
      cause: error,
    });
  }

  return new AIProviderError("upstream", "AI provider request failed.", {
    cause: error,
  });
};

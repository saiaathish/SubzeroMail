export const REDACTED_VALUE = "[REDACTED]";

const SENSITIVE_KEY =
  "(?:access[_-]?token|refresh[_-]?token|id[_-]?token|oauth(?:[_-]?(?:token|secret))?|client[_-]?secret|api[_-]?key|apikey|provider[_-]?key|authorization|x[_-]?api[_-]?key|openai[_-]?api[_-]?key|anthropic[_-]?api[_-]?key|gemini[_-]?api[_-]?key)";

const SENSITIVE_KEY_PATTERN = new RegExp(`^${SENSITIVE_KEY}$`, "i");
const SENSITIVE_ASSIGNMENT_PATTERN = new RegExp(
  `((?:["']?${SENSITIVE_KEY}["']?)\\s*[:=]\\s*)(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|[^\\s,;&}\\]]+)`,
  "gi",
);
const AUTHORIZATION_PATTERN =
  /((?:["']?authorization["']?)\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,;\r\n}]+)/gi;
const BEARER_TOKEN_PATTERN = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]+/gi;
const OPENAI_KEY_PATTERN = /\bsk-(?:proj-)?[A-Za-z0-9_-]{8,}\b/g;
const GEMINI_KEY_PATTERN = /\bAIza[0-9A-Za-z_-]{20,}\b/g;
const EMAIL_CONTENT_KEY_PATTERN =
  /^(?:body|html|text|raw|mime|messagebody|message_body|emailbody|email_body|emailhtml|email_html|emailtext|email_text|prompt)$/i;

/** Redact credential-shaped values from strings before they reach logs. */
export function redactSensitiveText(value: string): string {
  if (typeof value !== "string") {
    throw new TypeError("Log text must be a string");
  }

  return value
    .replace(AUTHORIZATION_PATTERN, `$1${REDACTED_VALUE}`)
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, `$1${REDACTED_VALUE}`)
    .replace(BEARER_TOKEN_PATTERN, `$1 ${REDACTED_VALUE}`)
    .replace(OPENAI_KEY_PATTERN, REDACTED_VALUE)
    .replace(GEMINI_KEY_PATTERN, REDACTED_VALUE);
}

/**
 * Produce a log-safe copy without mutating the caller's data. Credential and
 * email-content fields are replaced wholesale; other strings are pattern-redacted.
 */
export function redactForLogs(value: unknown): unknown {
  return redactValue(value, new WeakSet<object>());
}

export function isSensitiveLogKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return "[CIRCULAR]";
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSensitiveText(value.message),
    };
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    redacted[key] =
      isSensitiveLogKey(key) || EMAIL_CONTENT_KEY_PATTERN.test(key)
        ? REDACTED_VALUE
        : redactValue(item, seen);
  }

  return redacted;
}

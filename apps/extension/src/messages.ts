import type {
  AIProviderId,
  ExtensionPreferences,
  GmailPageContext,
  Theme,
} from "./types";

export type ExtensionMessage =
  | { type: "app/get-state" }
  | { type: "app/open" }
  | { type: "app/set-theme"; theme: Theme }
  | { type: "gmail/get-context" }
  | { type: "gmail/context"; context: GmailPageContext }
  | { type: "gmail/open-in-subzero"; threadId?: string }
  | { type: "gmail/open-side-panel"; threadId?: string }
  | {
      type: "settings/update-preferences";
      preferences: Partial<ExtensionPreferences>;
    }
  | { type: "auth/sign-out" }
  | { type: "ai/get-settings" }
  | {
      type: "ai/configure";
      provider: AIProviderId;
      model: string;
      apiKey: string;
      baseUrl?: string;
    }
  | { type: "ai/test" }
  | { type: "ai/clear" }
  | { type: "ai/summarize"; threadId: string }
  | { type: "ai/draft"; threadId: string; intent: string }
  | { type: "ai/ask-inbox"; question: string }
  | { type: "loops/list" }
  | { type: "loops/detect" }
  | { type: "loops/resolve"; loopId: string }
  | { type: "mail/get-threads" }
  | { type: "mail/get-thread"; threadId: string }
  | { type: "mail/search"; query: string }
  | { type: "mail/sync" }
  | { type: "mail/archive"; threadId: string }
  | { type: "mail/toggle-read"; threadId: string; unread: boolean }
  | { type: "mail/toggle-star"; threadId: string; starred: boolean }
  | { type: "mail/star"; threadId: string }
  | { type: "mail/unstar"; threadId: string }
  | {
      type: "mail/auto-archive";
      threadId: string;
      category: "newsletter" | "cold-pitch";
    }
  | {
      type: "mail/auto-label";
      threadId: string;
      category: "priority" | "needs_reply" | "waiting";
    }
  | {
      type: "mail/create-draft";
      threadId?: string;
      to: string[];
      cc?: string[];
      bcc?: string[];
      subject: string;
      body: string;
      replyToMessageId?: string;
      references?: string[];
    }
  | { type: "mail/send-draft"; draftId: string }
  | { type: "oauth/get-redirect-url" }
  | { type: "oauth/start"; authorizationUrl?: string }
  | {
      type: "compose/quick";
      mode: "new" | "reply" | "reply-all";
      threadId?: string;
    };

export interface ExtensionResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export function successResponse<T>(data: T): ExtensionResponse<T> {
  return { ok: true, data };
}

export function errorResponse(
  code: string,
  message: string,
): ExtensionResponse {
  return { ok: false, error: { code, message } };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (!value || typeof value !== "object" || !("type" in value)) return false;

  const message = value as {
    type?: unknown;
    theme?: unknown;
    mode?: unknown;
    threadId?: unknown;
    category?: unknown;
    query?: unknown;
    unread?: unknown;
    starred?: unknown;
    authorizationUrl?: unknown;
    context?: unknown;
    preferences?: unknown;
    provider?: unknown;
    model?: unknown;
    apiKey?: unknown;
    baseUrl?: unknown;
    intent?: unknown;
    question?: unknown;
    loopId?: unknown;
    draftId?: unknown;
    to?: unknown;
    cc?: unknown;
    bcc?: unknown;
    subject?: unknown;
    body?: unknown;
    replyToMessageId?: unknown;
    references?: unknown;
  };

  if (typeof message.type !== "string") return false;

  switch (message.type) {
    case "app/get-state":
    case "app/open":
    case "gmail/get-context":
    case "auth/sign-out":
    case "ai/get-settings":
    case "ai/test":
    case "ai/clear":
    case "loops/list":
    case "loops/detect":
    case "mail/get-threads":
    case "mail/sync":
    case "oauth/get-redirect-url":
      return true;
    case "gmail/context": {
      if (!message.context || typeof message.context !== "object") return false;
      const context = message.context as Partial<GmailPageContext>;
      return (
        (context.tabId === null || typeof context.tabId === "number") &&
        (context.url === null || typeof context.url === "string") &&
        (context.route === null || typeof context.route === "string") &&
        (context.threadId === null || typeof context.threadId === "string") &&
        (context.latestMessageId === null ||
          typeof context.latestMessageId === "string") &&
        typeof context.composeOpen === "boolean" &&
        (context.updatedAt === null || typeof context.updatedAt === "string")
      );
    }
    case "gmail/open-in-subzero":
    case "gmail/open-side-panel":
      return (
        message.threadId === undefined || typeof message.threadId === "string"
      );
    case "settings/update-preferences":
      if (!message.preferences || typeof message.preferences !== "object") {
        return false;
      }
      return Object.entries(
        message.preferences as Record<string, unknown>,
      ).every(([key, value]) => {
        if (key === "experience") {
          return (
            value === "gmail-only" ||
            value === "standalone-only" ||
            value === "both"
          );
        }
        return (
          (key === "onboardingComplete" ||
            key === "showThreadActions" ||
            key === "showComposeAI" ||
            key === "showFocusSignals" ||
            key === "enableSidePanel" ||
            key === "enableOpenLoopSuggestions" ||
            key === "enableAutoLabels" ||
            key === "enableAutoArchive" ||
            key === "enableReminders") &&
          typeof value === "boolean"
        );
      });
    case "app/set-theme":
      return message.theme === "light" || message.theme === "dark";
    case "mail/get-thread":
    case "mail/archive":
    case "mail/star":
    case "mail/unstar":
    case "ai/summarize":
      return typeof message.threadId === "string";
    case "mail/auto-archive":
      return (
        typeof message.threadId === "string" &&
        message.threadId.trim().length > 0 &&
        (message.category === "newsletter" || message.category === "cold-pitch")
      );
    case "mail/auto-label":
      return (
        typeof message.threadId === "string" &&
        message.threadId.trim().length > 0 &&
        (message.category === "priority" ||
          message.category === "needs_reply" ||
          message.category === "waiting")
      );
    case "loops/resolve":
      return typeof message.loopId === "string";
    case "ai/draft":
      return (
        typeof message.threadId === "string" &&
        typeof message.intent === "string" &&
        message.intent.trim().length > 0
      );
    case "ai/ask-inbox":
      return (
        typeof message.question === "string" &&
        message.question.trim().length > 0
      );
    case "ai/configure":
      return (
        (message.provider === "openai-compatible" ||
          message.provider === "anthropic" ||
          message.provider === "gemini") &&
        typeof message.model === "string" &&
        message.model.trim().length > 0 &&
        typeof message.apiKey === "string" &&
        message.apiKey.trim().length > 0 &&
        (message.baseUrl === undefined || typeof message.baseUrl === "string")
      );
    case "mail/search":
      return typeof message.query === "string";
    case "mail/toggle-read":
      return (
        typeof message.threadId === "string" &&
        typeof message.unread === "boolean"
      );
    case "mail/toggle-star":
      return (
        typeof message.threadId === "string" &&
        typeof message.starred === "boolean"
      );
    case "mail/create-draft":
      return (
        Array.isArray(message.to) &&
        message.to.length > 0 &&
        message.to.every(isNonEmptyString) &&
        (message.cc === undefined || isStringArray(message.cc)) &&
        (message.bcc === undefined || isStringArray(message.bcc)) &&
        isNonEmptyString(message.subject) &&
        isNonEmptyString(message.body) &&
        (message.threadId === undefined ||
          typeof message.threadId === "string") &&
        (message.replyToMessageId === undefined ||
          typeof message.replyToMessageId === "string") &&
        (message.references === undefined || isStringArray(message.references))
      );
    case "mail/send-draft":
      return typeof message.draftId === "string";
    case "oauth/start":
      return (
        message.authorizationUrl === undefined ||
        typeof message.authorizationUrl === "string"
      );
    case "compose/quick":
      return (
        message.mode === "new" ||
        message.mode === "reply" ||
        message.mode === "reply-all"
      );
    default:
      return false;
  }
}

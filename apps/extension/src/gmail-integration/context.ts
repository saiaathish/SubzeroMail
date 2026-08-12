import type { GmailPageContext } from "../types";
import { findComposer } from "./selectors";

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function threadIdFromGmailUrl(value: string): string | null {
  const parsed = safeUrl(value);
  if (!parsed || parsed.hostname !== "mail.google.com") return null;

  const hash = parsed.hash.replace(/^#/, "");
  const parts = hash.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const candidate = parts[1]?.split("?")[0]?.trim();
  return candidate && !candidate.includes("=") ? candidate : null;
}

export function routeFromGmailUrl(value: string): string | null {
  const parsed = safeUrl(value);
  if (!parsed || parsed.hostname !== "mail.google.com") return null;
  const hash = parsed.hash.replace(/^#/, "");
  return hash.split("/").filter(Boolean)[0] ?? null;
}

export function deriveGmailContext(
  value: string = globalThis.location?.href ?? "",
  root: Document = document,
): GmailPageContext {
  return {
    tabId: null,
    url: value.startsWith("https://mail.google.com/") ? value : null,
    route: routeFromGmailUrl(value),
    threadId: threadIdFromGmailUrl(value),
    latestMessageId:
      root
        .querySelector<HTMLElement>("[data-message-id]")
        ?.getAttribute("data-message-id") ??
      root
        .querySelector<HTMLElement>("[data-legacy-message-id]")
        ?.getAttribute("data-legacy-message-id") ??
      null,
    composeOpen: findComposer(root) !== null,
    updatedAt: new Date().toISOString(),
  };
}

import { deriveGmailContext } from "./context";
import { sendGmailMessage } from "./messaging";
import {
  closeGmailCommandPalette,
  openGmailCommandPalette,
  renderGmailSurface,
  unmountGmailSurface,
} from "./mounts";
import { DEFAULT_EXTENSION_STATE, type ExtensionPreferences } from "../types";

export interface GmailIntegrationController {
  stop(): void;
}

export function startGmailIntegration(
  root: Document = document,
): GmailIntegrationController {
  let stopped = false;
  let lastKey = "";
  let scheduled = false;
  let reconcileTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let preferences: ExtensionPreferences = DEFAULT_EXTENSION_STATE.preferences;
  let currentContext = DEFAULT_EXTENSION_STATE.gmail;
  const observer =
    typeof MutationObserver === "function"
      ? new MutationObserver((records) => {
          if (
            records.some((record) =>
              Array.from(record.addedNodes).some(
                (node) =>
                  node instanceof Element &&
                  !node.closest?.("[data-subzero-gmail-mount]"),
              ),
            )
          ) {
            schedule();
          }
        })
      : null;

  const reconcile = () => {
    scheduled = false;
    if (stopped) return;
    const context = deriveGmailContext(globalThis.location?.href ?? "", root);
    currentContext = context;
    const key = [
      context.route,
      context.threadId,
      context.composeOpen,
      root.querySelector('[role="main"]') ? "main" : "none",
    ].join("|");
    renderGmailSurface(context, preferences);
    if (key !== lastKey) {
      lastKey = key;
      void sendGmailMessage({ type: "gmail/context", context });
      void sendGmailMessage<{ preferences: ExtensionPreferences }>({
        type: "app/get-state",
      }).then((response) => {
        if (!response.ok || !response.data?.preferences) return;
        preferences = response.data.preferences;
        schedule();
      });
    }
  };

  const schedule = () => {
    if (scheduled || stopped) return;
    scheduled = true;
    reconcileTimer = globalThis.setTimeout(() => {
      reconcileTimer = null;
      reconcile();
    }, 40);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (event.key === "Escape") {
      closeGmailCommandPalette();
      return;
    }
    if (
      target?.matches?.('input, textarea, [contenteditable="true"]') ||
      (!event.metaKey && !event.ctrlKey) ||
      !event.shiftKey ||
      event.key !== "."
    ) {
      return;
    }
    event.preventDefault();
    openGmailCommandPalette(currentContext);
  };

  observer?.observe(root.body ?? root.documentElement, {
    childList: true,
    subtree: true,
  });
  root.addEventListener("keydown", onKeyDown, true);
  const routeTimer = globalThis.setInterval(schedule, 600);
  schedule();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      observer?.disconnect();
      root.removeEventListener("keydown", onKeyDown, true);
      globalThis.clearInterval(routeTimer);
      if (reconcileTimer !== null) globalThis.clearTimeout(reconcileTimer);
      unmountGmailSurface();
    },
  };
}

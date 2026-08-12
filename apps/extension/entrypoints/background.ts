import { defineBackground } from "wxt/utils/define-background";

import {
  listExtensionLoops,
  listExtensionReminders,
  resolveExtensionLoop,
} from "../src/ai";
import { getChrome } from "../src/platform/chrome";
import {
  handleExtensionMessage,
  migrateExtensionState,
} from "../src/message-handler";
import {
  errorResponse,
  isExtensionMessage,
  type ExtensionMessage,
  type ExtensionResponse,
} from "../src/messages";
import type { ChromeMessageSender } from "../src/platform/chrome";
import { REMINDER_ALARM, scheduleReminderAlarm } from "../src/platform/alarms";
import { openOrFocusApp } from "../src/platform/tabs";

const reminderNotifications = new Map<string, string>();

function loopIdFromNotification(notificationId: string): string | null {
  const remembered = reminderNotifications.get(notificationId);
  if (remembered) return remembered;
  const prefix = "subzero-reminder-";
  return notificationId.startsWith(prefix)
    ? notificationId.slice(prefix.length)
    : null;
}

async function openReminderThread(notificationId: string): Promise<void> {
  const loopId = loopIdFromNotification(notificationId);
  if (!loopId) return;
  const loop = (await listExtensionLoops()).find((item) => item.id === loopId);
  await openOrFocusApp(loop?.threadId);
}

async function notifyDueReminder(): Promise<void> {
  const reminders = await listExtensionReminders();
  const reminder = reminders[0];
  await scheduleReminderAlarm(reminder?.dueAt ?? null);
  const notifications = getChrome()?.notifications;
  if (!reminder || !notifications?.create) return;
  const id = `subzero-reminder-${reminder.loopId}`;
  reminderNotifications.set(id, reminder.loopId);
  await notifications.create(id, {
    type: "basic",
    iconUrl: getChrome()?.runtime?.getURL?.("icons/icon-128.png") ?? "",
    title:
      reminder.kind === "overdue"
        ? "Subzero reminder overdue"
        : "Subzero reminder",
    message: reminder.text,
    buttons: [
      { title: "Open thread" },
      { title: "Snooze" },
      { title: "Resolve" },
    ],
    requireInteraction: false,
  });
}

export default defineBackground(() => {
  const chrome = getChrome();

  chrome?.action?.onClicked?.addListener(() => {
    void openOrFocusApp();
  });

  chrome?.runtime?.onMessage?.addListener(
    (message, sender: ChromeMessageSender, sendResponse) => {
      if (!isExtensionMessage(message)) {
        sendResponse(
          errorResponse(
            "invalid_message",
            "The extension message was invalid.",
          ),
        );
        return false;
      }

      let normalizedMessage: ExtensionMessage = message;

      if (normalizedMessage.type === "gmail/context") {
        const senderUrl = sender.tab?.url ?? sender.url;
        const senderTabId = sender.tab?.id;
        if (
          typeof senderUrl !== "string" ||
          !senderUrl.startsWith("https://mail.google.com/") ||
          (normalizedMessage.context.tabId !== null &&
            normalizedMessage.context.tabId !== senderTabId)
        ) {
          sendResponse(
            errorResponse(
              "invalid_sender",
              "Gmail page context must come from mail.google.com.",
            ),
          );
          return false;
        }
        normalizedMessage = {
          ...normalizedMessage,
          context: {
            ...normalizedMessage.context,
            tabId: senderTabId ?? null,
          },
        } satisfies ExtensionMessage;
      }

      if (normalizedMessage.type === "gmail/open-side-panel") {
        const tabId = sender.tab?.id;
        if (
          typeof tabId !== "number" ||
          !sender.tab?.url?.startsWith("https://mail.google.com/") ||
          !chrome?.sidePanel?.open
        ) {
          sendResponse(
            errorResponse(
              "side_panel_unavailable",
              "The Gmail side panel is unavailable in this Chrome profile.",
            ),
          );
          return false;
        }
        void Promise.resolve(chrome.sidePanel.open({ tabId }))
          .then(() => sendResponse({ ok: true, data: { opened: true } }))
          .catch(() =>
            sendResponse(
              errorResponse(
                "side_panel_open_failed",
                "Subzero could not open the Gmail side panel.",
              ),
            ),
          );
        return true;
      }

      void handleExtensionMessage(normalizedMessage)
        .then((response) => sendResponse(response))
        .catch(() =>
          sendResponse(
            errorResponse(
              "background_error",
              "The background service could not complete that action.",
            ),
          ),
        );
      return true;
    },
  );

  chrome?.runtime?.onInstalled?.addListener(() => {
    void migrateExtensionState();
    void chrome?.sidePanel?.setPanelBehavior?.({
      openPanelOnActionClick: false,
    });
  });

  chrome?.notifications?.onButtonClicked?.addListener(
    (notificationId, buttonIndex) => {
      const loopId = loopIdFromNotification(notificationId);
      if (!loopId) return;
      if (buttonIndex === 2) {
        void resolveExtensionLoop(loopId).then(() => notifyDueReminder());
        return;
      }
      if (buttonIndex === 1) {
        void scheduleReminderAlarm(
          new Date(Date.now() + 60 * 60_000).toISOString(),
        );
        return;
      }
      void openReminderThread(notificationId);
    },
  );
  chrome?.notifications?.onClicked?.addListener((notificationId) => {
    void openReminderThread(notificationId);
  });

  chrome?.alarms?.onAlarm?.addListener((alarm) => {
    if (alarm.name === REMINDER_ALARM) {
      void notifyDueReminder();
    }
  });

  void migrateExtensionState();
});

export type BackgroundResponse = ExtensionResponse;

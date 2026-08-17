import {
  clearAI,
  configureAI,
  detectExtensionLoops,
  getAISettings,
  isExtensionAIError,
  askExtensionInbox,
  draftExtensionReply,
  listExtensionLoops,
  listExtensionReminders,
  resolveExtensionLoop,
  summarizeExtensionThread,
  testAI,
} from "./ai";
import { isAIProviderError } from "@subzero/ai";
import {
  errorResponse,
  successResponse,
  type ExtensionMessage,
  type ExtensionResponse,
} from "./messages";
import {
  applyGmailMutation,
  applyAutoArchive,
  applyAutoLabel,
  createGmailDraft,
  getExtensionThread,
  getExtensionThreads,
  isGmailAdapterError,
  searchGmailThreads,
  sendGmailDraft,
  syncGmail,
} from "./mail/gmail";
import {
  clearIdentitySession,
  getIdentityRedirectUrl,
  startIdentityOAuth,
} from "./platform/oauth";
import { ExtensionDatabase } from "@subzero/storage/extension";
import { DEFAULT_EXTENSION_STATE, type ExtensionState } from "./types";
import {
  chromeStorageAdapter,
  EXTENSION_STATE_KEY,
  loadExtensionState,
  updateExtensionState,
} from "./platform/storage";
import { openOrFocusApp } from "./platform/tabs";

type StateWithUnknownFields = {
  account?: {
    mode?: unknown;
    email?: unknown;
    label?: unknown;
    detail?: unknown;
  };
  sync?: { status?: unknown };
  preferences?: { onboardingComplete?: unknown };
};

function hasPersistedStateShape(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const state = value as StateWithUnknownFields;
  return Boolean(
    state.account &&
    typeof state.account === "object" &&
    state.sync &&
    typeof state.sync === "object" &&
    state.preferences &&
    typeof state.preferences === "object",
  );
}

/**
 * Move pre-release fixture state to the real install baseline. This lives at
 * the privileged message boundary because the storage normalizer is shared
 * with fixture-only unit helpers and must retain their legacy values.
 */
export async function migrateExtensionState(): Promise<ExtensionState> {
  const stored = await chromeStorageAdapter.get<unknown>(
    EXTENSION_STATE_KEY,
    undefined,
  );
  const current = await loadExtensionState();
  const account = current.account as StateWithUnknownFields["account"];
  const sync = current.sync as StateWithUnknownFields["sync"];
  const storedState = stored as StateWithUnknownFields | undefined;
  const storedAccountMode = storedState?.account?.mode;
  const storedSyncStatus = storedState?.sync?.status;
  const accountMode = account?.mode;
  const syncStatus = sync?.status;
  const accountIsConnected = accountMode === "connected";
  const accountIsManualOAuth = accountMode === "manual_oauth";
  const accountIsDisconnected = accountMode === "disconnected";
  const accountNeedsReset =
    !accountIsConnected &&
    !accountIsManualOAuth &&
    (!accountIsDisconnected ||
      storedAccountMode === "demo" ||
      account?.email !== null ||
      account?.label === "Demo fixture" ||
      (typeof account?.detail === "string" &&
        account.detail.toLowerCase().includes("fixture")));
  const syncNeedsReset =
    storedSyncStatus === "demo" ||
    (syncStatus !== "syncing" &&
      syncStatus !== "idle" &&
      syncStatus !== "unavailable");
  const shouldPersistBaseline =
    !hasPersistedStateShape(stored) || accountNeedsReset || syncNeedsReset;

  if (!shouldPersistBaseline) return current;

  return updateExtensionState({
    ...(accountNeedsReset ? { account: DEFAULT_EXTENSION_STATE.account } : {}),
    ...(accountNeedsReset || syncNeedsReset
      ? { sync: DEFAULT_EXTENSION_STATE.sync }
      : {}),
    ...(accountNeedsReset
      ? { preferences: { onboardingComplete: false } }
      : {}),
  });
}

function toErrorResponse(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
): ExtensionResponse {
  if (isGmailAdapterError(error)) {
    return errorResponse(error.code, error.message);
  }
  if (isExtensionAIError(error)) {
    return errorResponse(error.code, error.message);
  }
  if (isAIProviderError(error)) {
    return errorResponse(`ai_${error.code}`, error.message);
  }

  return errorResponse(fallbackCode, fallbackMessage);
}

export async function handleExtensionMessage(
  message: ExtensionMessage,
): Promise<ExtensionResponse> {
  await migrateExtensionState();

  switch (message.type) {
    case "app/get-state":
      return successResponse(await loadExtensionState());
    case "app/open":
      return successResponse({ opened: await openOrFocusApp() });
    case "app/set-theme":
      return successResponse(
        await updateExtensionState({ theme: message.theme }),
      );
    case "gmail/get-context":
      return successResponse((await loadExtensionState()).gmail);
    case "gmail/context":
      return successResponse(
        await updateExtensionState({
          gmail: {
            ...message.context,
            updatedAt: message.context.updatedAt ?? new Date().toISOString(),
          },
        }),
      );
    case "gmail/open-in-subzero":
      return successResponse({
        opened: await openOrFocusApp(message.threadId),
      });
    case "settings/update-preferences":
      if (
        message.preferences.onboardingComplete === true &&
        (await loadExtensionState()).account.mode !== "connected"
      ) {
        return errorResponse(
          "onboarding_requires_connection",
          "Connect Gmail before completing onboarding.",
        );
      }
      return successResponse(
        await updateExtensionState({ preferences: message.preferences }),
      );
    case "auth/sign-out": {
      try {
        const current = await loadExtensionState();
        await clearIdentitySession();
        await clearAI();
        const db = new ExtensionDatabase();
        try {
          await db.clearAll();
        } finally {
          db.close();
        }
        const next: Partial<ExtensionState> = {
          theme: current.theme,
          account: DEFAULT_EXTENSION_STATE.account,
          sync: DEFAULT_EXTENSION_STATE.sync,
          ai: DEFAULT_EXTENSION_STATE.ai,
          gmail: DEFAULT_EXTENSION_STATE.gmail,
        };
        return successResponse(await updateExtensionState(next));
      } catch {
        return errorResponse(
          "sign_out_failed",
          "Subzero could not clear the local Gmail session.",
        );
      }
    }
    case "ai/get-settings":
      return successResponse(await getAISettings());
    case "ai/configure":
      try {
        const settings = await configureAI(message);
        return successResponse(settings);
      } catch (error) {
        return toErrorResponse(
          error,
          "ai_configure_failed",
          "The AI provider could not be configured.",
        );
      }
    case "ai/test":
      try {
        return successResponse(await testAI());
      } catch (error) {
        return toErrorResponse(
          error,
          "ai_test_failed",
          "The AI provider did not respond.",
        );
      }
    case "ai/clear":
      return successResponse(await clearAI());
    case "ai/summarize":
      try {
        const result = await summarizeExtensionThread(message.threadId);
        return successResponse({ ...result.value, provider: result.provider });
      } catch (error) {
        return toErrorResponse(
          error,
          "ai_summary_failed",
          "A grounded summary could not be generated.",
        );
      }
    case "ai/draft":
      try {
        const result = await draftExtensionReply(
          message.threadId,
          message.intent,
        );
        return successResponse({ ...result.value, provider: result.provider });
      } catch (error) {
        return toErrorResponse(
          error,
          "ai_draft_failed",
          "An AI draft could not be generated.",
        );
      }
    case "ai/ask-inbox":
      try {
        const result = await askExtensionInbox(message.question);
        return successResponse({ ...result.value, provider: result.provider });
      } catch (error) {
        return toErrorResponse(
          error,
          "ai_ask_inbox_failed",
          "Ask Inbox could not retrieve a grounded answer.",
        );
      }
    case "loops/list":
      return successResponse({
        loops: await listExtensionLoops(),
        reminders: await listExtensionReminders(),
      });
    case "loops/detect":
      try {
        return successResponse(await detectExtensionLoops());
      } catch (error) {
        return toErrorResponse(
          error,
          "loops_detect_failed",
          "Open Loops could not inspect the cached inbox.",
        );
      }
    case "loops/resolve":
      try {
        return successResponse({
          loops: await resolveExtensionLoop(message.loopId),
          reminders: await listExtensionReminders(),
        });
      } catch (error) {
        return toErrorResponse(
          error,
          "loop_resolve_failed",
          "That open loop could not be resolved.",
        );
      }
    case "mail/get-threads":
      return successResponse(await getExtensionThreads());
    case "mail/get-thread": {
      try {
        const thread = await getExtensionThread(message.threadId);
        if (!thread) {
          return errorResponse(
            "gmail_thread_not_found",
            "Gmail thread not found.",
          );
        }

        return successResponse(thread);
      } catch (error) {
        return toErrorResponse(
          error,
          "gmail_get_thread_failed",
          "Gmail thread could not be loaded.",
        );
      }
    }
    case "mail/search":
      try {
        return successResponse({
          query: message.query,
          threads: await searchGmailThreads(message.query),
        });
      } catch (error) {
        return toErrorResponse(
          error,
          "gmail_search_failed",
          "Gmail search failed. Reconnect account and try again.",
        );
      }
    case "mail/sync":
      try {
        return successResponse(await syncGmail(false));
      } catch (error) {
        return toErrorResponse(
          error,
          "gmail_sync_failed",
          "Gmail sync failed. Reconnect account and try again.",
        );
      }
    case "mail/archive":
      try {
        await applyGmailMutation("archive", message.threadId);
        return successResponse({ threadId: message.threadId });
      } catch (error) {
        return toErrorResponse(
          error,
          "gmail_archive_failed",
          "Gmail did not accept archive. Thread should be reconciled.",
        );
      }
    case "mail/auto-archive":
      try {
        return successResponse(
          await applyAutoArchive(message.threadId, message.category),
        );
      } catch (error) {
        return toErrorResponse(
          error,
          "gmail_auto_archive_failed",
          "Gmail did not accept the opt-in auto-archive action.",
        );
      }
    case "mail/auto-label":
      try {
        return successResponse(
          await applyAutoLabel(message.threadId, message.category),
        );
      } catch (error) {
        return toErrorResponse(
          error,
          "gmail_auto_label_failed",
          "Gmail did not accept the opt-in Subzero label action.",
        );
      }
    case "mail/toggle-read":
      try {
        await applyGmailMutation(
          "toggle-read",
          message.threadId,
          message.unread,
        );
        return successResponse({
          threadId: message.threadId,
          unread: message.unread,
        });
      } catch (error) {
        return toErrorResponse(
          error,
          "gmail_read_failed",
          "Gmail did not accept read-state change. Thread should be reconciled.",
        );
      }
    case "mail/toggle-star":
      try {
        await applyGmailMutation(
          "toggle-star",
          message.threadId,
          message.starred,
        );
        return successResponse({
          threadId: message.threadId,
          starred: message.starred,
        });
      } catch (error) {
        return toErrorResponse(
          error,
          "gmail_star_failed",
          "Gmail did not accept star-state change. Thread should be reconciled.",
        );
      }
    case "mail/star":
      try {
        await applyGmailMutation("toggle-star", message.threadId, true);
        return successResponse({ threadId: message.threadId, starred: true });
      } catch (error) {
        return toErrorResponse(
          error,
          "gmail_star_failed",
          "Gmail did not accept star-state change. Thread should be reconciled.",
        );
      }
    case "mail/unstar":
      try {
        await applyGmailMutation("toggle-star", message.threadId, false);
        return successResponse({ threadId: message.threadId, starred: false });
      } catch (error) {
        return toErrorResponse(
          error,
          "gmail_star_failed",
          "Gmail did not accept star-state change. Thread should be reconciled.",
        );
      }
    case "mail/create-draft":
      try {
        return successResponse(await createGmailDraft(message));
      } catch (error) {
        return toErrorResponse(
          error,
          "gmail_draft_create_failed",
          "Gmail did not create the draft.",
        );
      }
    case "mail/send-draft":
      try {
        return successResponse(await sendGmailDraft(message.draftId));
      } catch (error) {
        return toErrorResponse(
          error,
          "gmail_send_failed",
          "Gmail did not send the draft.",
        );
      }
    case "oauth/get-redirect-url":
      return successResponse({ redirectUrl: getIdentityRedirectUrl() });
    case "oauth/start":
      try {
        const auth = await startIdentityOAuth();
        if (auth.status !== "completed") {
          return successResponse(auth);
        }

        try {
          const live = await syncGmail(false);
          return successResponse({ ...auth, ...live });
        } catch {
          return successResponse({
            ...auth,
            status: "completed",
            message:
              "Google authorized Gmail access, but inbox could not be loaded. Try Refresh after checking Gmail permission.",
          });
        }
      } catch (error) {
        return toErrorResponse(
          error,
          "oauth_failed",
          "Google authorization could not complete. No token was stored.",
        );
      }
    case "compose/quick":
      return successResponse({
        mode: message.mode,
        threadId: message.threadId ?? null,
        message:
          "Quick compose is ready. Save a draft or send it explicitly from the composer.",
      });
    default:
      return errorResponse(
        "unsupported_message",
        "That action is not supported.",
      );
  }
}

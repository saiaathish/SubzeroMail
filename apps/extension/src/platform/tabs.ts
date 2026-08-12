import { APP_TAB_ID_KEY, chromeStorageAdapter } from "./storage";
import { getChrome } from "./chrome";

const APP_ENTRYPOINT = "app.html";

/** Open one full-page client tab and reuse it on later toolbar/popup actions. */
export async function openOrFocusApp(threadId?: string): Promise<boolean> {
  const chrome = getChrome();
  const runtime = chrome?.runtime;
  const tabs = chrome?.tabs;

  if (!runtime?.getURL || !tabs?.create || !tabs.get || !tabs.update) {
    return false;
  }

  const appUrl = runtime.getURL(
    threadId?.trim()
      ? `${APP_ENTRYPOINT}?thread=${encodeURIComponent(threadId.trim())}`
      : APP_ENTRYPOINT,
  );
  const storedTabId = await chromeStorageAdapter.get<number | null>(
    APP_TAB_ID_KEY,
    null,
  );

  if (storedTabId !== null) {
    try {
      await tabs.get(storedTabId);
      await tabs.update(storedTabId, {
        active: true,
        ...(threadId?.trim() ? { url: appUrl } : {}),
      });
      return true;
    } catch {
      await chromeStorageAdapter.set(APP_TAB_ID_KEY, null);
    }
  }

  const createdTab = await tabs.create({ url: appUrl, active: true });
  if (createdTab?.id !== undefined) {
    await chromeStorageAdapter.set(APP_TAB_ID_KEY, createdTab.id);
  }
  return true;
}

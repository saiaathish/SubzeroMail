import {
  DEFAULT_EXTENSION_STATE,
  type AccountState,
  type ExtensionAISettings,
  type ExtensionPreferences,
  type GmailPageContext,
  type ExtensionState,
  type SyncState,
  type Theme,
} from "../types";
import { getChrome } from "./chrome";

export const EXTENSION_STATE_KEY = "subzero.extension.state.v1";
export const APP_TAB_ID_KEY = "subzero.extension.app-tab-id";

const memoryStorage = new Map<string, unknown>();

export const chromeStorageAdapter = {
  async get<T>(key: string, fallback: T): Promise<T> {
    const local = getChrome()?.storage?.local;
    if (!local) return (memoryStorage.get(key) as T | undefined) ?? fallback;

    try {
      const result = await local.get(key);
      const value = result?.[key] as T | undefined;
      if (value !== undefined) {
        memoryStorage.set(key, value);
        return value;
      }
    } catch {
      // The in-memory value keeps demo mode usable when Chrome storage is unavailable.
    }

    return (memoryStorage.get(key) as T | undefined) ?? fallback;
  },

  async set<T>(key: string, value: T): Promise<void> {
    memoryStorage.set(key, value);
    const local = getChrome()?.storage?.local;
    if (!local) return;

    try {
      await local.set({ [key]: value });
    } catch {
      // The memory fallback is intentionally sufficient for local demo use.
    }
  },
};

function normalizeState(
  value: Partial<ExtensionState> | null | undefined,
): ExtensionState {
  const account: AccountState = {
    ...DEFAULT_EXTENSION_STATE.account,
    ...(value?.account ?? {}),
  };
  const sync: SyncState = {
    ...DEFAULT_EXTENSION_STATE.sync,
    ...(value?.sync ?? {}),
  };
  const ai: ExtensionAISettings = {
    ...DEFAULT_EXTENSION_STATE.ai,
    ...(value?.ai ?? {}),
    // Keys live only in the background worker's memory. A persisted state
    // value must never imply that a restarted worker still holds a key.
    sessionConfigured: false,
  };
  const gmail: GmailPageContext = {
    ...DEFAULT_EXTENSION_STATE.gmail,
    ...(value?.gmail ?? {}),
  };
  const preferences: ExtensionPreferences = {
    ...DEFAULT_EXTENSION_STATE.preferences,
    ...(value?.preferences ?? {}),
  };

  return {
    theme:
      value?.theme === "light" || value?.theme === "dark"
        ? (value.theme as Theme)
        : DEFAULT_EXTENSION_STATE.theme,
    account,
    sync,
    ai,
    gmail,
    preferences,
  };
}

export async function loadExtensionState(): Promise<ExtensionState> {
  const stored = await chromeStorageAdapter.get<Partial<ExtensionState>>(
    EXTENSION_STATE_KEY,
    {},
  );
  return normalizeState(stored);
}

export async function updateExtensionState(
  patch: Omit<
    Partial<ExtensionState>,
    "account" | "sync" | "gmail" | "preferences"
  > & {
    account?: Partial<AccountState>;
    sync?: Partial<SyncState>;
    gmail?: Partial<GmailPageContext>;
    preferences?: Partial<ExtensionPreferences>;
  },
): Promise<ExtensionState> {
  const current = await loadExtensionState();
  const next = normalizeState({
    ...current,
    ...patch,
    account: { ...current.account, ...(patch.account ?? {}) },
    sync: { ...current.sync, ...(patch.sync ?? {}) },
    gmail: { ...current.gmail, ...(patch.gmail ?? {}) },
    preferences: {
      ...current.preferences,
      ...(patch.preferences ?? {}),
    },
  });
  await chromeStorageAdapter.set(EXTENSION_STATE_KEY, next);
  return next;
}

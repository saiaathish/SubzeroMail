export type Theme = "light" | "dark";

export type AIProviderId = "openai-compatible" | "anthropic" | "gemini";

export interface ExtensionAISettings {
  provider: AIProviderId;
  model: string;
  baseUrl: string;
  /** The API key is intentionally session-only and is never persisted here. */
  sessionConfigured: boolean;
}

export type AccountMode = "disconnected" | "connected" | "manual_oauth";

export interface AccountState {
  mode: AccountMode;
  email: string | null;
  label: string;
  detail: string;
}

export type SyncStatus = "syncing" | "idle" | "unavailable";

export type SubzeroExperience = "gmail-only" | "standalone-only" | "both";

export interface GmailPageContext {
  tabId: number | null;
  url: string | null;
  route: string | null;
  threadId: string | null;
  latestMessageId: string | null;
  composeOpen: boolean;
  updatedAt: string | null;
}

export interface ExtensionPreferences {
  experience: SubzeroExperience;
  onboardingComplete: boolean;
  showThreadActions: boolean;
  showComposeAI: boolean;
  showFocusSignals: boolean;
  enableSidePanel: boolean;
  enableOpenLoopSuggestions: boolean;
  enableAutoLabels: boolean;
  enableAutoArchive: boolean;
  enableReminders: boolean;
}

export interface SyncState {
  status: SyncStatus;
  lastSyncedAt: string | null;
  detail: string;
  threadCount?: number;
}

export interface ExtensionState {
  theme: Theme;
  account: AccountState;
  sync: SyncState;
  ai: ExtensionAISettings;
  gmail: GmailPageContext;
  preferences: ExtensionPreferences;
}

export const DEFAULT_EXTENSION_STATE: ExtensionState = {
  theme: "dark",
  account: {
    mode: "disconnected",
    email: null,
    label: "Gmail not connected",
    detail: "Connect Gmail to load your inbox.",
  },
  sync: {
    status: "unavailable",
    lastSyncedAt: null,
    detail: "Gmail is not connected. Connect an account to sync mail.",
  },
  ai: {
    provider: "openai-compatible",
    model: "gpt-4o-mini",
    baseUrl: "https://api.openai.com/v1",
    sessionConfigured: false,
  },
  gmail: {
    tabId: null,
    url: null,
    route: null,
    threadId: null,
    latestMessageId: null,
    composeOpen: false,
    updatedAt: null,
  },
  preferences: {
    experience: "both",
    onboardingComplete: false,
    showThreadActions: true,
    showComposeAI: true,
    showFocusSignals: true,
    enableSidePanel: true,
    enableOpenLoopSuggestions: true,
    enableAutoLabels: false,
    enableAutoArchive: false,
    enableReminders: true,
  },
};

export interface ChromeStorageArea {
  get(
    keys?: string | string[] | Record<string, unknown> | null,
  ): Promise<Record<string, unknown>> | Record<string, unknown>;
  set(items: Record<string, unknown>): Promise<void> | void;
  remove?(keys: string | string[]): Promise<void> | void;
}

export type ChromeStorageLocal = ChromeStorageArea;

export interface ChromeAlarm {
  name: string;
}

export interface ChromeTab {
  id?: number;
  url?: string;
}

export interface ChromeMessageSender {
  tab?: ChromeTab;
  url?: string;
}

export interface ChromeApi {
  storage?: {
    local?: ChromeStorageLocal;
    session?: ChromeStorageArea;
  };
  permissions?: {
    contains(details: { origins?: string[] }): Promise<boolean> | boolean;
    request(details: { origins?: string[] }): Promise<boolean> | boolean;
  };
  alarms?: {
    create(
      name: string,
      info: { delayInMinutes?: number; periodInMinutes?: number },
    ): Promise<void> | void;
    onAlarm?: { addListener(listener: (alarm: ChromeAlarm) => void): void };
  };
  identity?: {
    getRedirectURL(path?: string): string;
    getProfileUserInfo?():
      | Promise<{ email?: string; id?: string }>
      | { email?: string; id?: string };
    getAuthToken?(details: {
      interactive?: boolean;
      scopes?: string[];
    }): Promise<{ token?: string }> | { token?: string };
    removeCachedAuthToken?(details: { token: string }): Promise<void> | void;
    clearAllCachedAuthTokens?(): Promise<void> | void;
    launchWebAuthFlow?(details: {
      url: string;
      interactive: boolean;
    }): Promise<string> | string;
  };
  runtime?: {
    getURL(path: string): string;
    getManifest?(): {
      oauth2?: { client_id?: string };
    };
    lastError?: { message?: string };
    onInstalled?: { addListener(listener: () => void): void };
    onMessage?: {
      addListener(
        listener: (
          message: unknown,
          sender: ChromeMessageSender,
          sendResponse: (response: unknown) => void,
        ) => boolean | void,
      ): void;
    };
    sendMessage?<TResponse = unknown>(
      message: unknown,
      callback?: (response?: TResponse) => void,
    ): Promise<TResponse> | void;
  };
  action?: {
    onClicked?: { addListener(listener: (tab?: ChromeTab) => void): void };
  };
  sidePanel?: {
    open?(details: { tabId: number }): Promise<void> | void;
    setPanelBehavior?(details: {
      openPanelOnActionClick: boolean;
    }): Promise<void> | void;
  };
  notifications?: {
    create(
      notificationId: string,
      options: {
        type: "basic";
        iconUrl: string;
        title: string;
        message: string;
        buttons?: Array<{ title: string }>;
        requireInteraction?: boolean;
      },
    ): Promise<string> | string;
    onButtonClicked?: {
      addListener(
        listener: (notificationId: string, buttonIndex: number) => void,
      ): void;
    };
    onClicked?: {
      addListener(listener: (notificationId: string) => void): void;
    };
  };
  tabs?: {
    create(properties: {
      url: string;
      active: boolean;
    }): Promise<ChromeTab> | ChromeTab;
    get(tabId: number): Promise<ChromeTab> | ChromeTab;
    update(
      tabId: number,
      properties: { active?: boolean; url?: string },
    ): Promise<ChromeTab> | ChromeTab;
  };
}

export function getChrome(): ChromeApi | undefined {
  return (globalThis as typeof globalThis & { chrome?: ChromeApi }).chrome;
}

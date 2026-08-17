import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deriveGmailContext,
  threadIdFromGmailUrl,
} from "../../apps/extension/src/gmail-integration/context";
import {
  renderGmailSurface,
  unmountGmailSurface,
} from "../../apps/extension/src/gmail-integration/mounts";
import { isExtensionMessage } from "../../apps/extension/src/messages";
import { handleExtensionMessage } from "../../apps/extension/src/message-handler";
import {
  applyAutoArchive,
  applyAutoLabel,
} from "../../apps/extension/src/mail/gmail";
import {
  loadExtensionState,
  updateExtensionState,
} from "../../apps/extension/src/platform/storage";
import { DEFAULT_EXTENSION_STATE } from "../../apps/extension/src/types";
import {
  clearIdentitySession,
  getIdentityToken,
  startIdentityOAuth,
} from "../../apps/extension/src/platform/oauth";
import { ExtensionDatabase } from "@subzero/storage/extension";

const originalChrome = (globalThis as typeof globalThis & { chrome?: unknown })
  .chrome;
const originalPrompt = globalThis.prompt;
const originalFetch = globalThis.fetch;

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function gmailDom(compose = false): void {
  document.body.innerHTML = `
    <div role="main">
      <div role="toolbar" aria-label="Conversation toolbar"></div>
      <h2>Contract review</h2>
      <div role="listitem" aria-label="Unread message from Maya">Maya needs reply</div>
      ${compose ? '<div role="dialog"><div role="textbox" contenteditable="true" aria-label="Message Body"></div></div>' : ""}
    </div>
  `;
}

afterEach(async () => {
  await clearIdentitySession();
  document.body.innerHTML = "";
  (globalThis as typeof globalThis & { chrome?: unknown }).chrome =
    originalChrome;
  globalThis.fetch = originalFetch;
  globalThis.prompt = originalPrompt;
  vi.restoreAllMocks();
  unmountGmailSurface();
});

describe("Gmail route/context adapter", () => {
  it("extracts only thread ids from Gmail routes", () => {
    expect(
      threadIdFromGmailUrl("https://mail.google.com/mail/u/0/#inbox/abc123"),
    ).toBe("abc123");
    expect(
      threadIdFromGmailUrl("https://example.test/#inbox/abc123"),
    ).toBeNull();
    expect(
      threadIdFromGmailUrl("https://mail.google.com/mail/u/0/#inbox"),
    ).toBeNull();
  });

  it("derives compose state without reading message bodies", () => {
    gmailDom(true);
    const context = deriveGmailContext(
      "https://mail.google.com/mail/u/0/#inbox/abc123",
      document,
    );
    expect(context).toMatchObject({
      route: "inbox",
      threadId: "abc123",
      composeOpen: true,
    });
  });
});

describe("Gmail surface lifecycle", () => {
  it("mounts one shadow-root action cluster across Gmail rerenders", () => {
    gmailDom();
    const context = {
      ...DEFAULT_EXTENSION_STATE.gmail,
      url: "https://mail.google.com/mail/u/0/#inbox/abc123",
      route: "inbox",
      threadId: "abc123",
      latestMessageId: null,
      updatedAt: new Date().toISOString(),
    };
    renderGmailSurface(context);
    renderGmailSurface(context);

    expect(
      document.querySelectorAll("[data-subzero-gmail-mount]"),
    ).toHaveLength(1);
    expect(
      document.querySelector("#subzero-gmail-thread-actions")?.shadowRoot,
    ).toBeTruthy();
    expect(
      document.querySelector("#subzero-gmail-thread-actions")?.shadowRoot
        ?.textContent,
    ).toContain("Subzero");
  });

  it("removes all injected UI when Gmail closes the thread", () => {
    gmailDom();
    const context = { ...DEFAULT_EXTENSION_STATE.gmail, threadId: "abc123" };
    renderGmailSurface(context);
    renderGmailSurface({ ...context, threadId: null, route: "inbox" });
    expect(
      document.querySelectorAll("[data-subzero-gmail-mount]"),
    ).toHaveLength(0);
  });

  it("removes stale focus signals when the feature is disabled", () => {
    gmailDom();
    const context = {
      ...DEFAULT_EXTENSION_STATE.gmail,
      route: "inbox",
      threadId: "abc123",
    };
    renderGmailSurface(context, {
      ...DEFAULT_EXTENSION_STATE.preferences,
      showFocusSignals: true,
    });
    expect(
      document.querySelectorAll("[data-subzero-focus-signal]"),
    ).toHaveLength(1);

    renderGmailSurface(context, {
      ...DEFAULT_EXTENSION_STATE.preferences,
      showFocusSignals: false,
    });
    expect(
      document.querySelectorAll("[data-subzero-focus-signal]"),
    ).toHaveLength(0);
  });

  it("keeps draft generation privileged and inserts returned text only after the action", async () => {
    gmailDom(true);
    const sendMessage = vi.fn(
      (_message: unknown, callback: (response: unknown) => void) => {
        callback({ ok: true, data: { draft: "Thanks — Thursday works." } });
      },
    );
    (globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
      runtime: { sendMessage },
    };
    globalThis.prompt = vi.fn(() => "Confirm Thursday works");
    renderGmailSurface({
      ...DEFAULT_EXTENSION_STATE.gmail,
      threadId: "abc123",
      latestMessageId: null,
      route: "inbox",
      composeOpen: true,
    });
    const action = document
      .querySelector("#subzero-gmail-composer")
      ?.shadowRoot?.querySelector("button");
    action?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 10));
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ai/draft", threadId: "abc123" }),
      expect.any(Function),
    );
    expect(
      document.querySelector('[contenteditable="true"]')?.textContent,
    ).toBe("Thanks — Thursday works.");
  });

  it("uses a quick-reply chip intent and inserts the returned editable draft", async () => {
    gmailDom(true);
    const sendMessage = vi.fn(
      (_message: unknown, callback: (response: unknown) => void) => {
        callback({ ok: true, data: { draft: "Thursday works for me." } });
      },
    );
    (globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
      runtime: { sendMessage },
    };
    globalThis.prompt = vi.fn();
    renderGmailSurface({
      ...DEFAULT_EXTENSION_STATE.gmail,
      threadId: "abc123",
      latestMessageId: null,
      route: "inbox",
      composeOpen: true,
    });

    const shadow = document.querySelector(
      "#subzero-gmail-composer",
    )?.shadowRoot;
    expect(
      Array.from(shadow?.querySelectorAll("button") ?? []).map(
        (element) => element.textContent,
      ),
    ).toEqual([
      "✦ Draft with Subzero",
      "Thursday works",
      "Ask for another time",
      "Confirm tomorrow",
    ]);
    const chip = Array.from(shadow?.querySelectorAll("button") ?? []).find(
      (element) => element.textContent === "Thursday works",
    );
    chip?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 10));

    expect(globalThis.prompt).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ai/draft",
        threadId: "abc123",
        intent: "Thursday works",
      }),
      expect.any(Function),
    );
    expect(
      document.querySelector('[contenteditable="true"]')?.textContent,
    ).toBe("Thursday works for me.");
  });
});

describe("Gmail message boundary", () => {
  it("falls back to PKCE when Chrome browser sign-in is disabled", async () => {
    const sessionStore: Record<string, unknown> = {};
    const sessionStorage = {
      get: vi.fn(() => ({ ...sessionStore })),
      set: vi.fn((items: Record<string, unknown>) => {
        Object.assign(sessionStore, items);
      }),
      remove: vi.fn((key: string) => {
        delete sessionStore[key];
      }),
    };
    const getAuthToken = vi
      .fn()
      .mockRejectedValue(new Error("The user turned off browser signin."));
    const launchWebAuthFlow = vi.fn(async ({ url }: { url: string }) => {
      const authorizationUrl = new URL(url);
      expect(authorizationUrl.origin).toBe("https://accounts.google.com");
      expect(authorizationUrl.searchParams.get("client_id")).toBe(
        "extension-client.apps.googleusercontent.com",
      );
      expect(authorizationUrl.searchParams.get("code_challenge")).toMatch(
        /^[A-Za-z0-9_-]{40,}$/,
      );
      expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe(
        "S256",
      );
      return `https://extension-id.chromiumapp.org/subzero-mail?code=fixture-code&state=${encodeURIComponent(authorizationUrl.searchParams.get("state") ?? "")}`;
    });
    (globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
      identity: {
        getRedirectURL: vi.fn(
          () => "https://extension-id.chromiumapp.org/subzero-mail",
        ),
        getAuthToken,
        launchWebAuthFlow,
      },
      runtime: {
        getManifest: vi.fn(() => ({
          oauth2: { client_id: "extension-client.apps.googleusercontent.com" },
        })),
      },
      storage: { session: sessionStorage },
    };
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          access_token: "memory-access-token",
          refresh_token: "memory-refresh-token",
          expires_in: 3600,
        }),
      ),
    ) as typeof fetch;

    await expect(startIdentityOAuth()).resolves.toMatchObject({
      status: "completed",
      message: expect.stringContaining("Google authorized Gmail access"),
    });
    expect(getAuthToken).toHaveBeenCalledWith({
      interactive: true,
      scopes: ["https://www.googleapis.com/auth/gmail.modify"],
    });
    expect(launchWebAuthFlow).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({
        method: "POST",
        body: expect.any(URLSearchParams),
      }),
    );
    const tokenRequest = vi.mocked(globalThis.fetch).mock.calls[0]?.[1];
    const tokenBody = String(tokenRequest?.body ?? "");
    expect(tokenBody).toContain("code=fixture-code");
    expect(tokenBody).toContain("code_verifier=");
    expect(tokenBody).not.toContain("memory-access-token");
    expect(tokenBody).not.toContain("memory-refresh-token");
    expect(sessionStorage.set).toHaveBeenCalledWith(
      expect.objectContaining({
        "subzero.oauth.session": expect.objectContaining({
          accessToken: "memory-access-token",
          refreshToken: "memory-refresh-token",
        }),
      }),
    );
    await expect(getIdentityToken(false)).resolves.toBe("memory-access-token");
    expect(getAuthToken).toHaveBeenCalledTimes(1);

    vi.resetModules();
    const reloadedOAuth =
      await import("../../apps/extension/src/platform/oauth");
    await expect(reloadedOAuth.getIdentityToken(false)).resolves.toBe(
      "memory-access-token",
    );
    expect(getAuthToken).toHaveBeenCalledTimes(1);
  });

  it("rejects a PKCE callback with the wrong state before token exchange", async () => {
    const fetchMock = vi.fn();
    const launchWebAuthFlow = vi.fn(async ({ url }: { url: string }) => {
      new URL(url);
      return `https://extension-id.chromiumapp.org/subzero-mail?code=fixture-code&state=wrong-state`;
    });
    (globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
      identity: {
        getRedirectURL: vi.fn(
          () => "https://extension-id.chromiumapp.org/subzero-mail",
        ),
        launchWebAuthFlow,
      },
      runtime: {
        getManifest: vi.fn(() => ({
          oauth2: { client_id: "extension-client.apps.googleusercontent.com" },
        })),
      },
    };
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(startIdentityOAuth()).resolves.toMatchObject({
      status: "cancelled",
      message: expect.stringContaining("invalid OAuth state"),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the Chrome Identity failure without persisting a token", async () => {
    const getAuthToken = vi
      .fn()
      .mockRejectedValue(
        new Error("OAuth client is not registered for this item ID."),
      );
    (globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
      identity: {
        getRedirectURL: vi.fn(
          () =>
            "https://ipdijfkojgocigfgbljbanaeallaplnp.chromiumapp.org/subzero-mail",
        ),
        getAuthToken,
      },
    };

    await expect(startIdentityOAuth()).resolves.toMatchObject({
      status: "cancelled",
      message: expect.stringContaining(
        "OAuth client is not registered for this item ID.",
      ),
    });
    expect(getAuthToken).toHaveBeenCalledWith({
      interactive: true,
      scopes: ["https://www.googleapis.com/auth/gmail.modify"],
    });
  });

  it("reports an unavailable Chrome Identity token API clearly", async () => {
    (globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
      identity: {
        getRedirectURL: vi.fn(
          () =>
            "https://ipdijfkojgocigfgbljbanaeallaplnp.chromiumapp.org/subzero-mail",
        ),
      },
    };

    await expect(startIdentityOAuth()).resolves.toMatchObject({
      status: "unavailable",
      message: "Chrome identity token API is unavailable in this profile.",
    });
  });

  it("rejects an empty token as a failed authorization", async () => {
    const getAuthToken = vi.fn().mockResolvedValue({ token: "   " });
    (globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
      identity: { getAuthToken },
    };

    await expect(startIdentityOAuth()).resolves.toMatchObject({
      status: "cancelled",
      message: expect.stringContaining(
        "Chrome did not return a Gmail access token.",
      ),
    });
    expect(getAuthToken).toHaveBeenCalledTimes(1);
  });

  it("accepts bounded context and rejects malformed context", () => {
    expect(
      isExtensionMessage({
        type: "gmail/context",
        context: {
          tabId: null,
          url: "https://mail.google.com/mail/u/0/#inbox/abc123",
          route: "inbox",
          threadId: "abc123",
          latestMessageId: null,
          composeOpen: false,
          updatedAt: new Date().toISOString(),
        },
      }),
    ).toBe(true);
    expect(
      isExtensionMessage({
        type: "gmail/context",
        context: { threadId: "abc123", composeOpen: "false" },
      }),
    ).toBe(false);
  });

  it("stores page context through the privileged message handler", async () => {
    const response = await handleExtensionMessage({
      type: "gmail/context",
      context: {
        tabId: 17,
        url: "https://mail.google.com/mail/u/0/#inbox/abc123",
        route: "inbox",
        threadId: "abc123",
        latestMessageId: "message-1",
        composeOpen: false,
        updatedAt: new Date().toISOString(),
      },
    });
    expect(response.ok).toBe(true);
    expect(response.data).toMatchObject({
      gmail: { tabId: 17, threadId: "abc123" },
    });
  });

  it("does not complete onboarding before Gmail is connected", async () => {
    const response = await handleExtensionMessage({
      type: "settings/update-preferences",
      preferences: { onboardingComplete: true },
    });

    expect(response).toEqual({
      ok: false,
      error: {
        code: "onboarding_requires_connection",
        message: "Connect Gmail before completing onboarding.",
      },
    });
    expect((await loadExtensionState()).preferences.onboardingComplete).toBe(
      false,
    );
  });

  it("clears stored Gmail context during sign out", async () => {
    await updateExtensionState({
      account: {
        mode: "connected",
        email: "owner@example.com",
        label: "Gmail connected",
        detail: "Connected test account",
      },
      gmail: {
        tabId: 17,
        url: "https://mail.google.com/mail/u/0/#inbox/abc123",
        route: "inbox",
        threadId: "abc123",
        latestMessageId: "message-1",
        composeOpen: true,
        updatedAt: new Date().toISOString(),
      },
    });
    const clearAll = vi
      .spyOn(ExtensionDatabase.prototype, "clearAll")
      .mockResolvedValue(undefined);
    vi.spyOn(ExtensionDatabase.prototype, "close").mockImplementation(() => {
      // The database is already stubbed closed for this unit boundary.
    });
    const clearTokens = vi.fn().mockResolvedValue(undefined);
    (globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
      identity: { clearAllCachedAuthTokens: clearTokens },
    };

    const response = await handleExtensionMessage({ type: "auth/sign-out" });

    expect(response.ok).toBe(true);
    expect(clearAll).toHaveBeenCalledOnce();
    expect(clearTokens).toHaveBeenCalledOnce();
    expect((await loadExtensionState()).gmail).toEqual(
      DEFAULT_EXTENSION_STATE.gmail,
    );
  });

  it("clears local account state even when Chrome cache clearing fails", async () => {
    await updateExtensionState({
      account: {
        mode: "connected",
        email: "owner@example.com",
        label: "Gmail connected",
        detail: "Connected test account",
      },
    });
    vi.spyOn(ExtensionDatabase.prototype, "clearAll").mockResolvedValue(
      undefined,
    );
    vi.spyOn(ExtensionDatabase.prototype, "close").mockImplementation(() => {
      // The database is already stubbed closed for this unit boundary.
    });
    const clearTokens = vi
      .fn()
      .mockRejectedValue(new Error("Chrome cache unavailable"));
    (globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
      identity: { clearAllCachedAuthTokens: clearTokens },
    };

    const response = await handleExtensionMessage({ type: "auth/sign-out" });

    expect(response.ok).toBe(true);
    expect(clearTokens).toHaveBeenCalledOnce();
    expect((await loadExtensionState()).account.mode).toBe("disconnected");
  });

  it("sends connected-account auto-archive and Subzero label requests", async () => {
    await updateExtensionState({
      account: {
        mode: "connected",
        email: "owner@example.com",
        label: "Gmail connected",
        detail: "Connected test account",
      },
      preferences: {
        enableAutoArchive: true,
        enableAutoLabels: true,
      },
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ emailAddress: "owner@example.com" }),
      )
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(
        jsonResponse({ emailAddress: "owner@example.com" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          labels: [{ id: "Label_priority", name: "Subzero/Priority" }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({}));
    globalThis.fetch = fetchMock;
    (globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
      identity: {
        getAuthToken: vi.fn().mockResolvedValue({ token: "test-token" }),
      },
    };

    const archive = await applyAutoArchive("thread-archive", "newsletter");
    const label = await applyAutoLabel("thread-label", "priority");

    expect(archive).toEqual({ status: "applied", threadId: "thread-archive" });
    expect(label).toEqual({
      status: "applied",
      threadId: "thread-label",
      labelId: "Label_priority",
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      "https://gmail.googleapis.com/gmail/v1/users/me/threads/thread-archive/modify",
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      "https://gmail.googleapis.com/gmail/v1/users/me/labels",
      "https://gmail.googleapis.com/gmail/v1/users/me/threads/thread-label/modify",
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      removeLabelIds: ["INBOX"],
    });
    expect(JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body))).toEqual({
      addLabelIds: ["Label_priority"],
    });
  });
});

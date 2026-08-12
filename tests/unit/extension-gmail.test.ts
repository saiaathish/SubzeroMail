import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyAutoArchive,
  applyAutoLabel,
  applyGmailMutation,
  createGmailDraft,
} from "../../apps/extension/src/mail/gmail";
import { isExtensionMessage } from "../../apps/extension/src/messages";
import {
  DEFAULT_EXTENSION_STATE,
  type ExtensionState,
} from "../../apps/extension/src/types";
import {
  loadExtensionState,
  updateExtensionState,
} from "../../apps/extension/src/platform/storage";

const originalFetch = globalThis.fetch;
const originalChrome = (globalThis as typeof globalThis & { chrome?: unknown })
  .chrome;

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function setState(patch: Partial<ExtensionState>) {
  await updateExtensionState({
    ...DEFAULT_EXTENSION_STATE,
    ...patch,
    account: {
      ...DEFAULT_EXTENSION_STATE.account,
      ...(patch.account ?? {}),
    },
    sync: {
      ...DEFAULT_EXTENSION_STATE.sync,
      ...(patch.sync ?? {}),
    },
  });
}

afterEach(async () => {
  globalThis.fetch = originalFetch;
  (globalThis as typeof globalThis & { chrome?: unknown }).chrome =
    originalChrome;
  await setState({ account: DEFAULT_EXTENSION_STATE.account });
  vi.restoreAllMocks();
});

describe("extension Gmail contracts", () => {
  it("rejects header injection before any Gmail request", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    await expect(
      createGmailDraft({
        to: ["maya@atlas.studio"],
        subject: "unsafe\nBcc: attacker@example.com",
        body: "Hello",
      }),
    ).rejects.toMatchObject({ code: "invalid_draft" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the account-bound Gmail endpoints for star mutations", async () => {
    await setState({
      account: {
        mode: "connected",
        email: "you@example.com",
        label: "Gmail connected",
        detail: "test",
      },
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ emailAddress: "you@example.com" }))
      .mockResolvedValueOnce(jsonResponse({}));
    globalThis.fetch = fetchMock;
    (globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
      identity: {
        getAuthToken: vi.fn().mockResolvedValue({ token: "test-token" }),
      },
    };

    await applyGmailMutation("toggle-star", "thread-123", true);

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/threads/thread-123/modify",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      addLabelIds: ["STARRED"],
    });
  });

  it("creates a URL-safe UTF-8 Gmail draft and keeps reply headers in-thread", async () => {
    await setState({
      account: {
        mode: "connected",
        email: "you@example.com",
        label: "Gmail connected",
        detail: "test",
      },
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ emailAddress: "you@example.com" }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "draft-123",
          message: { id: "message-123", threadId: "thread-123" },
        }),
      );
    globalThis.fetch = fetchMock;
    (globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
      identity: {
        getAuthToken: vi.fn().mockResolvedValue({ token: "test-token" }),
      },
    };

    const draft = await createGmailDraft({
      threadId: "thread-123",
      replyToMessageId: "<message-123@example.com>",
      to: ["maya@atlas.studio"],
      subject: "Re: Thursday review",
      body: "Thanks — I will send it today.",
    });

    const request = fetchMock.mock.calls[1]?.[1];
    const payload = JSON.parse(String(request?.body)) as {
      message: { raw: string; threadId: string };
    };
    const decoded = Buffer.from(payload.message.raw, "base64url").toString(
      "utf8",
    );

    expect(draft).toMatchObject({
      draftId: "draft-123",
      messageId: "message-123",
      threadId: "thread-123",
    });
    expect(payload.message.threadId).toBe("thread-123");
    expect(decoded).toContain("In-Reply-To: <message-123@example.com>");
    expect(decoded).toContain("Thanks — I will send it today.");
    expect(decoded).not.toContain("\nBcc:");
  });
});

describe("extension message boundary", () => {
  it("accepts supported draft, star, and search messages", () => {
    expect(
      isExtensionMessage({
        type: "mail/toggle-star",
        threadId: "thread-1",
        starred: true,
      }),
    ).toBe(true);
    expect(
      isExtensionMessage({ type: "mail/search", query: "from:maya" }),
    ).toBe(true);
    expect(
      isExtensionMessage({
        type: "mail/create-draft",
        to: ["maya@atlas.studio"],
        subject: "Hello",
        body: "World",
      }),
    ).toBe(true);
  });

  it("rejects malformed mutation and draft payloads", () => {
    expect(
      isExtensionMessage({
        type: "mail/toggle-star",
        threadId: "thread-1",
        starred: "true",
      }),
    ).toBe(false);
    expect(
      isExtensionMessage({
        type: "mail/create-draft",
        to: [],
        subject: "Hello",
        body: "World",
      }),
    ).toBe(false);
  });

  it("keeps state readable after each isolated setup", async () => {
    const state = await loadExtensionState();
    // Disconnected is the fresh-user state; fixture helpers remain isolated
    // below and must not imply a user-facing demo inbox.
    expect(state.account.mode).not.toBe("connected");
    expect(state.account.label).not.toBe("Demo fixture");
  });

  it("keeps opt-in automation disabled and side-effect free by default", async () => {
    const archive = await applyAutoArchive(
      "fixture-maya-contract",
      "newsletter",
    );
    const label = await applyAutoLabel("fixture-maya-contract", "priority");
    expect(archive).toMatchObject({
      status: "disabled",
      threadId: "fixture-maya-contract",
    });
    expect(label).toMatchObject({
      status: "disabled",
      threadId: "fixture-maya-contract",
    });
  });

  it("rejects malformed automation messages at the boundary", () => {
    expect(
      isExtensionMessage({
        type: "mail/auto-archive",
        threadId: "thread-1",
        category: "social",
      }),
    ).toBe(false);
    expect(
      isExtensionMessage({
        type: "mail/auto-label",
        threadId: "thread-1",
        category: "priority",
      }),
    ).toBe(true);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockAIActionError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly status = 422,
    ) {
      super(message);
    }
  }

  return {
    AIActionError: MockAIActionError,
    requireMailRouteContext: vi.fn(),
    configuredAIProvider: vi.fn(),
    aiJson: vi.fn(async (operation: () => Promise<unknown>) => operation()),
    search: vi.fn(),
    getThread: vi.fn(),
    createVoiceProfile: vi.fn(),
    storage: {
      voiceProfile: vi.fn(),
      saveVoiceProfile: vi.fn(),
      removeVoiceProfile: vi.fn(),
    },
  };
});

vi.mock("@subzero/storage", () => ({ createStorage: () => mocks.storage }));
vi.mock("@/app/api/mail/runtime", () => ({
  requireMailRouteContext: mocks.requireMailRouteContext,
}));
vi.mock("@/app/api/ai/_shared", () => ({
  AIActionError: mocks.AIActionError,
  aiJson: mocks.aiJson,
  configuredAIProvider: mocks.configuredAIProvider,
}));

import { GET, POST } from "@/app/api/settings/voice-profile/route";

const trustedAccount = {
  id: "trusted-account",
  gmailAddress: "owner@example.com",
  googleSubject: "trusted-subject",
};

const compactProfile = {
  formality: "casual" as const,
  averageLength: "short" as const,
  greetingPatterns: ["Hi"],
  signoffPatterns: ["Thanks,"],
  directness: 0.8,
  formattingNotes: ["Use short paragraphs."],
};

function sentThread(index: number, metadataOnly = false) {
  const id = `sent-thread-${index}`;
  const messageId = `sent-message-${index}`;
  return {
    id,
    latestMessageId: messageId,
    subject: `Sent subject ${index}`,
    participants: [{ address: "recipient@example.com" }],
    preview: `Private sent sample ${index}`,
    unread: false,
    labelIds: ["SENT"],
    metadataOnly,
    messages: [
      {
        id: messageId,
        threadId: id,
        subject: `Sent subject ${index}`,
        from: { address: trustedAccount.gmailAddress },
        to: [{ address: "recipient@example.com" }],
        cc: [],
        bcc: [],
        snippet: `Private sent sample ${index}`,
        body: `Private raw sent sample body ${index}`,
        labelIds: ["SENT"],
        headers: {},
      },
    ],
  };
}

function sentResults(count: number, metadataOnly = false) {
  return Array.from({ length: count }, (_, index) => {
    const thread = sentThread(index + 1, metadataOnly);
    return {
      thread,
      matchedMessageIds: thread.messages.map((item) => item.id),
    };
  });
}

function request(body: Record<string, unknown>, cookie?: string) {
  return new Request("http://localhost/api/settings/voice-profile", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireMailRouteContext.mockResolvedValue({
    account: trustedAccount,
    provider: {
      account: trustedAccount,
      search: mocks.search,
      getThread: mocks.getThread,
    },
  });
  mocks.search.mockResolvedValue(sentResults(20));
  mocks.getThread.mockImplementation(async (threadId: string) =>
    sentResults(50, true)
      .map((result) => result.thread)
      .find((thread) => thread.id === threadId),
  );
  mocks.createVoiceProfile.mockResolvedValue(compactProfile);
  mocks.configuredAIProvider.mockResolvedValue({
    createVoiceProfile: mocks.createVoiceProfile,
  });
  mocks.storage.voiceProfile.mockResolvedValue(null);
  mocks.storage.saveVoiceProfile.mockResolvedValue(undefined);
  mocks.storage.removeVoiceProfile.mockResolvedValue(undefined);
});

describe("P1.3 Voice Profile route", () => {
  it("requires explicit opt-in before Gmail search or provider access", async () => {
    const response = await POST(
      request({ action: "create", optIn: false, sampleCount: 20 }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "OPT_IN_REQUIRED", recoverable: true },
    });
    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.configuredAIProvider).not.toHaveBeenCalled();
  });

  it("derives one compact profile from a bounded 20-message sent-mail sample without storing raw samples", async () => {
    // Gmail search returns metadata-first threads in production; the route must
    // fetch only this bounded candidate set to access readable sent bodies.
    mocks.search.mockResolvedValue(sentResults(20, true));

    const response = await POST(
      request(
        { action: "create", optIn: true, sampleCount: 20 },
        "subzero_account_id=attacker-account",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { profile: compactProfile },
    });
    expect(mocks.search).toHaveBeenCalledWith("in:sent", { limit: 50 });
    expect(mocks.getThread).toHaveBeenCalledTimes(20);
    expect(mocks.createVoiceProfile).toHaveBeenCalledTimes(1);
    const providerInput = mocks.createVoiceProfile.mock.calls[0][0] as {
      samples: Array<{ id: string; text: string }>;
    };
    expect(providerInput.samples).toHaveLength(20);
    expect(providerInput.samples[0]).toEqual({
      id: "sent-message-1",
      text: "Private raw sent sample body 1",
    });
    expect(mocks.storage.saveVoiceProfile).toHaveBeenCalledWith(
      "trusted-account",
      compactProfile,
    );
    expect(
      JSON.stringify(mocks.storage.saveVoiceProfile.mock.calls),
    ).not.toContain("Private raw sent sample body 1");
  });

  it("returns a recoverable error when fewer than 20 sent messages are available", async () => {
    mocks.search.mockResolvedValue(sentResults(19));

    const response = await POST(
      request({ action: "create", optIn: true, sampleCount: 20 }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "INSUFFICIENT_SAMPLES", recoverable: true },
    });
    expect(mocks.createVoiceProfile).not.toHaveBeenCalled();
    expect(mocks.storage.saveVoiceProfile).not.toHaveBeenCalled();
  });

  it("lets the user inspect, edit, and reset only the trusted account profile", async () => {
    mocks.storage.voiceProfile.mockResolvedValue(compactProfile);

    const inspect = await GET(
      new Request("http://localhost/api/settings/voice-profile"),
    );
    expect(inspect.status).toBe(200);
    await expect(inspect.json()).resolves.toEqual({
      ok: true,
      data: { configured: true, profile: compactProfile },
    });

    const edited = { ...compactProfile, directness: 0.6 };
    const save = await POST(
      request({ action: "save", optIn: true, profile: edited }),
    );
    expect(save.status).toBe(200);
    await expect(save.json()).resolves.toEqual({
      ok: true,
      data: { profile: edited },
    });
    expect(mocks.storage.saveVoiceProfile).toHaveBeenLastCalledWith(
      trustedAccount.id,
      edited,
    );

    const reset = await POST(request({ action: "reset" }));
    expect(reset.status).toBe(200);
    await expect(reset.json()).resolves.toEqual({
      ok: true,
      data: { configured: false, profile: null },
    });
    expect(mocks.storage.removeVoiceProfile).toHaveBeenCalledWith(
      trustedAccount.id,
    );
  });
});

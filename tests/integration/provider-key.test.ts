import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireMailRouteContext: vi.fn(),
  storage: {
    providerKey: vi.fn(),
    saveProviderKey: vi.fn(),
    settings: vi.fn(),
    saveSettings: vi.fn(),
    removeProviderKey: vi.fn(),
  },
}));

vi.mock("@subzero/storage", () => ({ createStorage: () => mocks.storage }));
vi.mock("@/app/api/mail/runtime", () => ({
  requireMailRouteContext: mocks.requireMailRouteContext,
}));

import { GET, POST } from "@/app/api/settings/provider-key/route";
import { encryptSecret } from "@subzero/security";

const trustedAccount = {
  id: "trusted-account",
  gmailAddress: "owner@example.com",
  googleSubject: "trusted-subject",
};

function settingsRequest(
  body: Record<string, unknown>,
  cookie?: string,
): Request {
  return new Request("http://localhost/api/settings/provider-key", {
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
  vi.stubEnv("SUBZERO_DEMO_MODE", "true");
  vi.stubEnv("SUBZERO_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  mocks.storage.settings.mockResolvedValue({});
  mocks.requireMailRouteContext.mockResolvedValue({
    account: trustedAccount,
    provider: { account: trustedAccount },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("BYOK route security contract", () => {
  it("stores only encrypted provider keys for the trusted mail-context account", async () => {
    const response = await POST(
      settingsRequest(
        {
          action: "save",
          provider: "openai-compatible",
          model: "model",
          key: "sk-secret-value",
        },
        "subzero_account_id=attacker-account",
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.requireMailRouteContext).toHaveBeenCalledTimes(1);
    expect(mocks.storage.saveProviderKey).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "trusted-account",
        encryptedKey: expect.not.stringContaining("sk-secret-value"),
      }),
    );
    expect(JSON.stringify(await response.json())).not.toContain(
      "sk-secret-value",
    );
  });

  it("rejects raw-cookie requests when no trusted mail context resolves", async () => {
    mocks.requireMailRouteContext.mockRejectedValue(new Error("untrusted"));

    const response = await GET(
      new Request(
        "http://localhost/api/settings/provider-key?provider=openai-compatible",
        { headers: { cookie: "subzero_account_id=attacker-account" } },
      ),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Connect Gmail before configuring a provider key.",
    });
    expect(mocks.storage.providerKey).not.toHaveBeenCalled();
  });

  it("reports configured status without returning encrypted key material", async () => {
    mocks.storage.providerKey.mockResolvedValue("encrypted-key-material");

    const response = await GET(
      new Request(
        "http://localhost/api/settings/provider-key?provider=openai-compatible",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ configured: true });
    expect(mocks.storage.providerKey).toHaveBeenCalledWith(
      "trusted-account",
      "openai-compatible",
    );
  });

  it("keeps invalid-key errors useful without echoing the key", async () => {
    const response = await POST(
      settingsRequest({
        action: "test",
        provider: "openai-compatible",
        model: "model",
        key: "invalid-secret",
      }),
    );

    expect(response.status).toBe(422);
    expect(JSON.stringify(await response.json())).not.toContain(
      "invalid-secret",
    );
  });

  it("persists a custom base URL for OpenAI-compatible providers", async () => {
    const response = await POST(
      settingsRequest({
        action: "save",
        provider: "openai-compatible",
        model: "model",
        key: "sk-secret-value",
        baseUrl: "https://opencode.ai/zen/go/v1",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.storage.saveSettings).toHaveBeenCalledWith(
      "trusted-account",
      expect.objectContaining({
        provider: "openai-compatible",
        model: "model",
        baseUrl: "https://opencode.ai/zen/go/v1",
      }),
    );
  });

  it("rejects custom base URLs for non-OpenAI providers", async () => {
    const response = await POST(
      settingsRequest({
        action: "save",
        provider: "anthropic",
        model: "model",
        key: "sk-ant-secret-value",
        baseUrl: "https://example.com",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error:
        "A custom base URL is only supported for OpenAI-compatible providers.",
    });
  });

  it("rejects malformed base URLs", async () => {
    const response = await POST(
      settingsRequest({
        action: "save",
        provider: "openai-compatible",
        model: "model",
        key: "sk-secret-value",
        baseUrl: "not a url",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Base URL must be a valid http(s) URL.",
    });
  });

  it("tests with the stored key and stored base URL when neither is submitted", async () => {
    mocks.storage.providerKey.mockResolvedValue(encryptSecret("sk-stored"));
    mocks.storage.settings.mockResolvedValue({
      provider: "openai-compatible",
      model: "model",
      baseUrl: "https://opencode.ai/zen/go/v1",
    });

    const response = await POST(
      settingsRequest({
        action: "test",
        provider: "openai-compatible",
        model: "model",
      }),
    );

    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain("sk-stored");
  });

  it("returns the stored model and base URL for a configured OpenAI-compatible key", async () => {
    mocks.storage.providerKey.mockResolvedValue("encrypted-key-material");
    mocks.storage.settings.mockResolvedValue({
      provider: "openai-compatible",
      model: "deepseek-v4-flash",
      baseUrl: "https://opencode.ai/zen/go/v1",
    });

    const response = await GET(
      new Request(
        "http://localhost/api/settings/provider-key?provider=openai-compatible",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      configured: true,
      model: "deepseek-v4-flash",
      baseUrl: "https://opencode.ai/zen/go/v1",
    });
  });
});

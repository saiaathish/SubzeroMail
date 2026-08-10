import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireMailRouteContext: vi.fn(),
  storage: {
    settings: vi.fn(),
    saveSettings: vi.fn(),
  },
}));

vi.mock("@subzero/storage", () => ({ createStorage: () => mocks.storage }));
vi.mock("@/app/api/mail/runtime", () => ({
  requireMailRouteContext: mocks.requireMailRouteContext,
}));

import { GET, PUT } from "@/app/api/settings/focus-rules/route";

const account = {
  id: "focus-account",
  gmailAddress: "owner@example.com",
  googleSubject: "focus-subject",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireMailRouteContext.mockResolvedValue({
    account,
    provider: { account },
  });
  mocks.storage.settings.mockResolvedValue({
    provider: "openai-compatible",
    model: "model",
  });
});

afterEach(() => vi.restoreAllMocks());

describe("custom Focus rule route", () => {
  it("reads account-scoped rules without trusting a client account id", async () => {
    mocks.storage.settings.mockResolvedValue({
      focusRules: [
        {
          id: "r1",
          bucket: "other",
          field: "any",
          pattern: "newsletters",
          enabled: true,
        },
      ],
    });
    const response = await GET(
      new Request("http://localhost/api/settings/focus-rules", {
        headers: { cookie: "subzero_account_id=attacker" },
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { rules: [{ id: "r1" }] },
    });
    expect(mocks.requireMailRouteContext).toHaveBeenCalledTimes(1);
    expect(mocks.storage.settings).toHaveBeenCalledWith("focus-account");
  });

  it("validates, de-duplicates, and persists inspectable rules while retaining settings", async () => {
    const response = await PUT(
      new Request("http://localhost/api/settings/focus-rules", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rules: [
            {
              id: "r1",
              bucket: "priority",
              field: "from",
              pattern: "@school.edu",
              enabled: true,
            },
          ],
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.storage.saveSettings).toHaveBeenCalledWith(
      "focus-account",
      expect.objectContaining({
        provider: "openai-compatible",
        focusRules: [
          {
            id: "r1",
            bucket: "priority",
            field: "from",
            pattern: "@school.edu",
            enabled: true,
          },
        ],
      }),
    );
    const duplicate = await PUT(
      new Request("http://localhost/api/settings/focus-rules", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rules: [
            { bucket: "other", field: "any", pattern: "newsletters" },
            { bucket: "other", field: "any", pattern: "NEWSLETTERS" },
          ],
        }),
      }),
    );
    expect(duplicate.status).toBe(400);
  });
});

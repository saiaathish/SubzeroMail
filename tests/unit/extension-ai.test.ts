import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cloneDemoThreads } from "../../apps/extension/src/fixtures";
import {
  askExtensionInbox,
  clearAI,
  configureAI,
  detectExtensionLoops,
  draftExtensionReply,
  listExtensionLoops,
  setExtensionAIMailSourceForTests,
  summarizeExtensionThread,
} from "../../apps/extension/src/ai";
import {
  DEFAULT_EXTENSION_STATE,
  type ExtensionState,
} from "../../apps/extension/src/types";
import { updateExtensionState } from "../../apps/extension/src/platform/storage";
import { loadExtensionState } from "../../apps/extension/src/platform/storage";

async function resetExtensionState(): Promise<void> {
  await clearAI();
  await updateExtensionState({
    ...DEFAULT_EXTENSION_STATE,
    account: {
      mode: "connected",
      email: "owner@example.com",
      label: "Gmail connected",
      detail: "Connected deterministic test mailbox",
    },
    sync: {
      status: "idle",
      lastSyncedAt: new Date().toISOString(),
      detail: "Connected deterministic test mailbox",
      threadCount: cloneDemoThreads().length,
    },
    ai: DEFAULT_EXTENSION_STATE.ai,
  } satisfies ExtensionState);
}

beforeEach(async () => {
  // jsdom exposes a partial IndexedDB global without a usable implementation.
  // Force the AI unit boundary onto its private in-memory store; the extension
  // browser tests cover the real IndexedDB cache separately.
  vi.stubGlobal("indexedDB", undefined);
  const threads = cloneDemoThreads();
  setExtensionAIMailSourceForTests({
    getThreads: async () => threads,
    getThread: async (threadId) =>
      threads.find((thread) => thread.id === threadId),
  });
  await resetExtensionState();
});

afterEach(async () => {
  await clearAI();
  await updateExtensionState(DEFAULT_EXTENSION_STATE);
  setExtensionAIMailSourceForTests(null);
  vi.unstubAllGlobals();
});

describe("extension local AI surfaces", () => {
  it("summarizes and drafts from sanitized fixture context without a provider key", async () => {
    const summary = await summarizeExtensionThread("fixture-maya-contract");
    expect(summary.provider).toBe("local");
    expect(summary.value.sourceMessageIds).toContain(
      "fixture-maya-contract-message",
    );
    expect(summary.value.summary).toContain("Could you send");

    const draft = await draftExtensionReply(
      "fixture-maya-contract",
      "Confirm Thursday works and ask for the final clause.",
    );
    expect(draft.provider).toBe("local");
    expect(draft.value.draft).toContain("Confirm Thursday");
  });

  it("answers Ask Inbox from bounded source evidence", async () => {
    const result = await askExtensionInbox("What price did Alex agree to?");
    expect(result.provider).toBe("local");
    expect(result.value.answer).toContain("$4,800");
    expect(result.value.sourceMessageIds).toContain("fixture-alex-pricing");
    expect(result.value.evidence.length).toBeGreaterThan(0);
  });

  it("keeps BYOK keys in the background session and rejects unsafe origins", async () => {
    await expect(
      configureAI({
        provider: "openai-compatible",
        model: "local-model",
        apiKey: "session-secret",
        baseUrl: "http://remote.example/v1",
      }),
    ).rejects.toMatchObject({ code: "ai_invalid_configuration" });

    await expect(
      configureAI({
        provider: "openai-compatible",
        model: "local-model",
        apiKey: "session-secret",
        baseUrl: "https://provider.example/v1",
      }),
    ).rejects.toMatchObject({ code: "ai_invalid_configuration" });
    const settings = await configureAI({
      provider: "openai-compatible",
      model: "local-model",
      apiKey: "session-secret",
      baseUrl: "https://opencode.ai/zen/go/v1",
    });
    expect(settings.sessionConfigured).toBe(true);
    expect(JSON.stringify(await loadExtensionState())).not.toContain(
      "session-secret",
    );
  });

  it("detects and persists explicit request loops locally", async () => {
    const result = await detectExtensionLoops();
    expect(result.loops.some((loop) => loop.direction === "i_owe")).toBe(true);
    expect(result.loops.some((loop) => loop.direction === "waiting")).toBe(
      true,
    );
    expect((await listExtensionLoops()).length).toBeGreaterThanOrEqual(2);
  });
});

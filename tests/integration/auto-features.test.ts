import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  configuredAIProvider: vi.fn(),
}));

vi.mock("@/app/api/ai/_shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/api/ai/_shared")>();
  return { ...actual, configuredAIProvider: mocks.configuredAIProvider };
});

import {
  DemoMailProvider,
  type MailAccount,
  type MailThread,
} from "@subzero/mail";
import { createStorage } from "@subzero/storage";
import { POST as autoDraft } from "@/app/api/ai/auto-draft/route";
import { POST as autoArchive } from "@/app/api/mail/auto-archive/route";
import { POST as saveAutoArchiveSetting } from "@/app/api/settings/auto-archive/route";
import {
  configureMailRouteContextResolver,
  resetMailRouteContextResolverForTests,
} from "@/app/api/mail/runtime";

const account: MailAccount = {
  id: "account-1",
  gmailAddress: "owner@example.com",
  googleSubject: "subject-1",
};
const originalDatabaseUrl = process.env.SUBZERO_DATABASE_URL;
let directories: string[] = [];

function fixtureThread(id: string, from: string, body: string): MailThread {
  return {
    id,
    latestMessageId: `message-${id}`,
    subject: "Thread subject",
    participants: [
      { address: from, name: "Sender" },
      { address: account.gmailAddress },
    ],
    preview: body,
    unread: true,
    labelIds: ["INBOX", "UNREAD"],
    metadataOnly: false,
    messages: [
      {
        id: `message-${id}`,
        threadId: id,
        subject: "Thread subject",
        from: { address: from, name: "Sender" },
        to: [{ address: account.gmailAddress }],
        cc: [],
        bcc: [],
        snippet: body,
        body,
        labelIds: ["INBOX", "UNREAD"],
        headers: {},
      },
    ],
  };
}

function request(path: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function useTemporaryStorage() {
  const directory = await mkdtemp(join(tmpdir(), "subzero-auto-"));
  directories.push(directory);
  process.env.SUBZERO_DATABASE_URL = join(directory, "subzero.db");
}

beforeEach(async () => {
  await useTemporaryStorage();
  mocks.configuredAIProvider.mockReset();
});

afterEach(async () => {
  resetMailRouteContextResolverForTests();
  mocks.configuredAIProvider.mockReset();
  if (originalDatabaseUrl === undefined) {
    delete process.env.SUBZERO_DATABASE_URL;
  } else {
    process.env.SUBZERO_DATABASE_URL = originalDatabaseUrl;
  }
  await Promise.all(
    directories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  directories = [];
});

describe("Auto drafts", () => {
  it("caches a generated suggested draft and does not regenerate it", async () => {
    const provider = new DemoMailProvider({
      account,
      threads: [
        fixtureThread("thread-1", "maya@example.com", "Can you review this?"),
      ],
    });
    configureMailRouteContextResolver(() => ({ account, provider }));
    const draftReply = vi
      .fn()
      .mockResolvedValue("Sure, I will review it today.");
    mocks.configuredAIProvider.mockResolvedValue({ draftReply });

    const first = await autoDraft(
      request("/api/ai/auto-draft", { threadId: "thread-1" }),
    );
    expect(first.status).toBe(200);
    await expect(json(first)).resolves.toMatchObject({
      data: { draft: "Sure, I will review it today." },
    });

    const second = await autoDraft(
      request("/api/ai/auto-draft", { threadId: "thread-1" }),
    );
    await expect(json(second)).resolves.toMatchObject({
      data: { draft: "Sure, I will review it today." },
    });
    expect(draftReply).toHaveBeenCalledTimes(1);
  });

  it("regenerates only when the thread gained a newer message", async () => {
    const provider = new DemoMailProvider({
      account,
      threads: [
        fixtureThread("thread-1", "maya@example.com", "Can you review this?"),
      ],
    });
    configureMailRouteContextResolver(() => ({ account, provider }));
    mocks.configuredAIProvider.mockResolvedValue({
      draftReply: vi.fn().mockResolvedValue("Draft for message 1"),
    });

    await autoDraft(request("/api/ai/auto-draft", { threadId: "thread-1" }));

    // A newer message arrives; the provider thread is replaced.
    const newer = fixtureThread(
      "thread-1",
      "maya@example.com",
      "And the revision?",
    );
    newer.latestMessageId = "message-2";
    newer.messages = [
      ...newer.messages,
      {
        ...newer.messages[0],
        id: "message-2",
        body: "And the revision?",
        snippet: "And the revision?",
      },
    ];
    configureMailRouteContextResolver(() => ({
      account,
      provider: new DemoMailProvider({ account, threads: [newer] }),
    }));
    mocks.configuredAIProvider.mockResolvedValue({
      draftReply: vi.fn().mockResolvedValue("Draft for message 2"),
    });

    const response = await autoDraft(
      request("/api/ai/auto-draft", { threadId: "thread-1" }),
    );
    await expect(json(response)).resolves.toMatchObject({
      data: { draft: "Draft for message 2" },
    });
  });

  it("never overwrites or regenerates a draft the user has taken over", async () => {
    const provider = new DemoMailProvider({
      account,
      threads: [
        fixtureThread("thread-1", "maya@example.com", "Can you review this?"),
      ],
    });
    configureMailRouteContextResolver(() => ({ account, provider }));
    const draftReply = vi.fn().mockResolvedValue("Suggested text");
    mocks.configuredAIProvider.mockResolvedValue({ draftReply });

    await autoDraft(request("/api/ai/auto-draft", { threadId: "thread-1" }));
    const takenOver = await autoDraft(
      request("/api/ai/auto-draft", { threadId: "thread-1", userEdited: true }),
    );
    await expect(json(takenOver)).resolves.toMatchObject({
      data: { draft: null },
    });

    const later = await autoDraft(
      request("/api/ai/auto-draft", { threadId: "thread-1" }),
    );
    await expect(json(later)).resolves.toMatchObject({ data: { draft: null } });
    expect(draftReply).toHaveBeenCalledTimes(1);
  });
});

describe("Auto archive", () => {
  it("refuses to run until the user opts in", async () => {
    const provider = new DemoMailProvider({
      account,
      threads: [
        fixtureThread(
          "thread-news",
          "news@example.com",
          "Weekly newsletter — unsubscribe anytime",
        ),
      ],
    });
    configureMailRouteContextResolver(() => ({ account, provider }));

    const response = await autoArchive(request("/api/mail/auto-archive", {}));

    expect(response.status).toBe(403);
  });

  it("archives only deterministic newsletter threads once enabled", async () => {
    const provider = new DemoMailProvider({
      account,
      threads: [
        fixtureThread(
          "thread-news",
          "news@example.com",
          "Weekly newsletter — unsubscribe anytime",
        ),
        fixtureThread(
          "thread-real",
          "maya@example.com",
          "Can you review the contract?",
        ),
      ],
    });
    configureMailRouteContextResolver(() => ({ account, provider }));
    await saveAutoArchiveSetting(
      request("/api/settings/auto-archive", { enabled: true }),
    );

    const response = await autoArchive(request("/api/mail/auto-archive", {}));
    expect(response.status).toBe(200);
    const body = await json<{ data: { archived: string[] } }>(response);
    expect(body.data.archived).toEqual(["thread-news"]);

    const page = await provider.listThreads({});
    const news = page.threads.find((thread) => thread.id === "thread-news");
    const real = page.threads.find((thread) => thread.id === "thread-real");
    expect(news?.labelIds).not.toContain("INBOX");
    expect(real?.labelIds).toContain("INBOX");
  });
});

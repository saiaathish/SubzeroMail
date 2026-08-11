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
import {
  GET as listOpenLoops,
  POST as createOpenLoop,
} from "@/app/api/open-loops/route";
import { POST as extractOpenLoops } from "@/app/api/open-loops/extract/route";
import { PATCH as updateOpenLoop } from "@/app/api/open-loops/[loopId]/route";
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

function fixtureThread(
  body = "Could you send the revised contract before Thursday?",
): MailThread {
  return {
    id: "thread-1",
    latestMessageId: "message-1",
    subject: "Contract review",
    participants: [
      { address: "maya@example.com", name: "Maya" },
      { address: account.gmailAddress },
    ],
    preview: body,
    unread: true,
    labelIds: ["INBOX", "UNREAD"],
    metadataOnly: false,
    messages: [
      {
        id: "message-1",
        threadId: "thread-1",
        subject: "Contract review",
        from: { address: "maya@example.com", name: "Maya" },
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

function request(path: string, body?: Record<string, unknown>): Request {
  return new Request(`http://localhost${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function patchRequest(path: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params(loopId: string) {
  return { params: Promise.resolve({ loopId }) };
}

function installProvider(thread = fixtureThread()) {
  const provider = new DemoMailProvider({ account, threads: [thread] });
  configureMailRouteContextResolver(() => ({ account, provider }));
  return provider;
}

async function useTemporaryStorage() {
  const directory = await mkdtemp(join(tmpdir(), "subzero-open-loops-"));
  directories.push(directory);
  process.env.SUBZERO_DATABASE_URL = join(directory, "subzero.db");
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
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

describe("P1.2 Open Loop routes", () => {
  it("requires the trusted Gmail account context", async () => {
    const response = await listOpenLoops(request("/api/open-loops"));

    expect(response.status).toBe(401);
    await expect(json(response)).resolves.toMatchObject({
      ok: false,
      error: { code: "ACCOUNT_REQUIRED" },
    });
  });

  it("detects source-backed deterministic loops and deduplicates reprocessing", async () => {
    installProvider();

    const first = await extractOpenLoops(
      request("/api/open-loops/extract", { threadId: "thread-1" }),
    );
    expect(first.status).toBe(200);
    await expect(json(first)).resolves.toMatchObject({
      ok: true,
      data: {
        deterministic: true,
        loops: [
          {
            threadId: "thread-1",
            sourceMessageId: "message-1",
            direction: "i_owe",
            dueAt: "Thursday",
            suggestion: false,
          },
        ],
      },
    });

    const second = await extractOpenLoops(
      request("/api/open-loops/extract", { threadId: "thread-1" }),
    );
    expect(second.status).toBe(200);

    const listed = await listOpenLoops(request("/api/open-loops"));
    const body = await json<{
      data: { loops: Array<{ sourceMessageId: string }> };
    }>(listed);
    expect(body.data.loops).toHaveLength(1);
    expect(body.data.loops[0]).toMatchObject({ sourceMessageId: "message-1" });
    expect(
      JSON.stringify(await createStorage().listOpenLoops(account.id)),
    ).not.toContain("Could you send the revised contract before Thursday?");
  });

  it("keeps low-confidence AI extraction suggestion-only with a validated source", async () => {
    installProvider(fixtureThread("A neutral status update."));
    mocks.configuredAIProvider.mockResolvedValue({
      extractOpenLoops: vi.fn().mockResolvedValue([
        {
          threadId: "thread-1",
          sourceMessageId: "message-1",
          direction: "they_owe",
          text: "Maya will confirm the next step.",
          dueAt: null,
          confidence: 0.35,
        },
      ]),
    });

    const response = await extractOpenLoops(
      request("/api/open-loops/extract", { threadId: "thread-1" }),
    );

    expect(response.status).toBe(200);
    await expect(json(response)).resolves.toMatchObject({
      data: {
        deterministic: false,
        loops: [
          {
            direction: "they_owe",
            suggestion: true,
            sourceMessageId: "message-1",
          },
        ],
      },
    });
  });

  it("supports a manual source-backed loop, edit, and resolve without crossing accounts", async () => {
    installProvider();
    const created = await createOpenLoop(
      request("/api/open-loops", {
        threadId: "thread-1",
        sourceMessageId: "message-1",
        direction: "i_owe",
        text: "Send a redlined contract",
        dueAt: "Friday",
      }),
    );
    const createdBody = await json<{ data: { loop: { id: string } } }>(created);
    expect(created.status).toBe(200);

    const updated = await updateOpenLoop(
      patchRequest(`/api/open-loops/${createdBody.data.loop.id}`, {
        direction: "waiting",
        text: "Await Maya's final approval",
        dueAt: null,
        status: "resolved",
      }),
      params(createdBody.data.loop.id),
    );
    expect(updated.status).toBe(200);
    await expect(json(updated)).resolves.toMatchObject({
      data: {
        loop: {
          direction: "waiting",
          text: "Await Maya's final approval",
          dueAt: null,
          status: "resolved",
        },
      },
    });

    const listed = await listOpenLoops(request("/api/open-loops"));
    await expect(json(listed)).resolves.toMatchObject({
      data: { loops: [{ status: "resolved", resolvedAt: expect.any(String) }] },
    });
  });

  it("resurfaces overdue and due-soon commitments as reminders", async () => {
    installProvider();
    await createOpenLoop(
      request("/api/open-loops", {
        threadId: "thread-1",
        sourceMessageId: "message-1",
        direction: "i_owe",
        text: "Send the redlined contract",
        dueAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      }),
    );
    await createOpenLoop(
      request("/api/open-loops", {
        threadId: "thread-1",
        sourceMessageId: "message-1",
        direction: "they_owe",
        text: "Await Maya's final draft",
        dueAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    );

    const response = await listOpenLoops(request("/api/open-loops"));
    expect(response.status).toBe(200);
    const body = await json<{
      data: { reminders: Array<{ kind: string; text: string }> };
    }>(response);
    expect(body.data.reminders).toHaveLength(1);
    expect(body.data.reminders[0]).toMatchObject({
      kind: "overdue",
      text: "Send the redlined contract",
    });
  });

  it("does NOT auto-resolve an i_owe loop when the other party nudges", async () => {
    installProvider();
    await createOpenLoop(
      request("/api/open-loops", {
        threadId: "thread-1",
        sourceMessageId: "message-1",
        direction: "i_owe",
        text: "Send the redlined contract",
        dueAt: null,
      }),
    );
    // The other party follows up ("just checking in") — a newer message
    // arrives from Maya, not the owner.
    const nudged = fixtureThread();
    nudged.latestMessageId = "message-2";
    nudged.messages = [
      ...nudged.messages,
      {
        ...nudged.messages[0],
        id: "message-2",
        body: "Just checking in on the contract.",
        snippet: "Just checking in on the contract.",
      },
    ];
    await createStorage().upsertThread({
      accountId: account.id,
      threadId: "thread-1",
      latestMessageId: "message-2",
      subject: "Contract review",
      participants: ["maya@example.com", account.gmailAddress],
      preview: "Just checking in on the contract.",
      unread: true,
      gmailLabels: ["INBOX", "UNREAD"],
      bucket: "needs_reply",
    });
    configureMailRouteContextResolver(() => ({
      account,
      provider: new DemoMailProvider({ account, threads: [nudged] }),
    }));

    const response = await listOpenLoops(request("/api/open-loops"));
    const body = await json<{
      data: { loops: Array<{ status: string }> };
    }>(response);
    expect(body.data.loops[0].status).toBe("open");
  });

  it("auto-resolves an i_owe loop once the owner replies", async () => {
    installProvider();
    await createOpenLoop(
      request("/api/open-loops", {
        threadId: "thread-1",
        sourceMessageId: "message-1",
        direction: "i_owe",
        text: "Send the redlined contract",
        dueAt: null,
      }),
    );
    const replied = fixtureThread();
    replied.latestMessageId = "message-2";
    replied.messages = [
      ...replied.messages,
      {
        ...replied.messages[0],
        id: "message-2",
        from: { address: account.gmailAddress, name: "Owner" },
        body: "Here is the redlined contract.",
        snippet: "Here is the redlined contract.",
      },
    ];
    await createStorage().upsertThread({
      accountId: account.id,
      threadId: "thread-1",
      latestMessageId: "message-2",
      subject: "Contract review",
      participants: ["maya@example.com", account.gmailAddress],
      preview: "Here is the redlined contract.",
      unread: false,
      gmailLabels: ["INBOX"],
      bucket: "waiting",
    });
    configureMailRouteContextResolver(() => ({
      account,
      provider: new DemoMailProvider({ account, threads: [replied] }),
    }));

    const response = await listOpenLoops(request("/api/open-loops"));
    const body = await json<{
      data: { loops: Array<{ status: string }> };
    }>(response);
    expect(body.data.loops[0]).toMatchObject({
      status: "resolved",
      resolvedAt: expect.any(String),
    });
  });
});

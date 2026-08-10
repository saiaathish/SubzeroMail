import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DemoMailProvider,
  MailProviderError,
  type MailAccount,
  type MailThread,
} from "@subzero/mail";
import { createStorage } from "@subzero/storage";
import { POST as archiveThread } from "../../apps/web/app/api/mail/threads/[threadId]/archive/route";
import { GET as getThread } from "../../apps/web/app/api/mail/threads/[threadId]/route";
import {
  POST as applyLabel,
  DELETE as removeLabel,
} from "../../apps/web/app/api/mail/threads/[threadId]/labels/route";
import { POST as markRead } from "../../apps/web/app/api/mail/threads/[threadId]/read/route";
import { POST as markUnread } from "../../apps/web/app/api/mail/threads/[threadId]/unread/route";
import { GET as listThreads } from "../../apps/web/app/api/mail/threads/route";
import { GET as searchMail } from "../../apps/web/app/api/mail/search/route";
import { POST as createDraft } from "../../apps/web/app/api/mail/drafts/route";
import { POST as sendDraft } from "../../apps/web/app/api/mail/drafts/[draftId]/send/route";
import {
  configureMailRouteContextResolver,
  resetMailRouteContextResolverForTests,
} from "../../apps/web/app/api/mail/runtime";

const account: MailAccount = {
  id: "account-1",
  gmailAddress: "owner@example.com",
  googleSubject: "google-subject-1",
};

const originalDatabaseUrl = process.env.SUBZERO_DATABASE_URL;
let cacheDirectories: string[] = [];

function fixtureThread(id: string, updatedAt: string): MailThread {
  const messageId = `${id}-message`;
  return {
    id,
    latestMessageId: messageId,
    subject: `Subject for ${id}`,
    participants: [{ address: "alice@example.com", name: "Alice" }],
    preview: `Preview for ${id}`,
    unread: true,
    labelIds: ["INBOX", "UNREAD"],
    updatedAt,
    metadataOnly: false,
    messages: [
      {
        id: messageId,
        threadId: id,
        subject: `Subject for ${id}`,
        from: { address: "alice@example.com", name: "Alice" },
        to: [{ address: "owner@example.com" }],
        cc: [],
        bcc: [],
        snippet: `Preview for ${id}`,
        body: `Body for ${id}`,
        labelIds: ["INBOX", "UNREAD"],
        headers: { subject: `Subject for ${id}` },
        sentAt: updatedAt,
      },
    ],
  };
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`http://localhost${path}`, init);
}

function params<T extends Record<string, string>>(values: T) {
  return { params: Promise.resolve(values) };
}

function installDemoProvider(
  threads = [fixtureThread("thread-1", "2024-01-02T00:00:00.000Z")],
) {
  const provider = new DemoMailProvider({ account, threads });
  configureMailRouteContextResolver(() => ({ account, provider }));
  return provider;
}

async function storageForRouteTest() {
  const directory = await mkdtemp(join(tmpdir(), "subzero-mail-routes-"));
  cacheDirectories.push(directory);
  const databasePath = join(directory, "subzero.db");
  process.env.SUBZERO_DATABASE_URL = databasePath;
  return { databasePath, storage: createStorage(databasePath) };
}

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

afterEach(async () => {
  resetMailRouteContextResolverForTests();
  if (originalDatabaseUrl === undefined) {
    delete process.env.SUBZERO_DATABASE_URL;
  } else {
    process.env.SUBZERO_DATABASE_URL = originalDatabaseUrl;
  }
  await Promise.all(
    cacheDirectories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  cacheDirectories = [];
});

describe("P0 mail API routes", () => {
  it("requires a server-resolved Gmail account", async () => {
    const response = await listThreads(request("/api/mail/threads"));

    expect(response.status).toBe(401);
    expect(await body<{ error: { code: string } }>(response)).toMatchObject({
      ok: false,
      error: { code: "ACCOUNT_REQUIRED" },
    });
  });

  it("lists recent threads with pagination and fetches full detail lazily", async () => {
    installDemoProvider([
      fixtureThread("thread-1", "2024-01-02T00:00:00.000Z"),
      fixtureThread("thread-2", "2024-01-03T00:00:00.000Z"),
    ]);

    const pageResponse = await listThreads(
      request("/api/mail/threads?limit=1&pageToken=1&label=INBOX"),
    );
    const page = await body<{
      ok: true;
      data: { threads: MailThread[]; totalEstimate: number };
    }>(pageResponse);
    expect(pageResponse.status).toBe(200);
    expect(page.data.threads).toHaveLength(1);
    expect(page.data.totalEstimate).toBe(2);

    const detailResponse = await getThread(
      request("/api/mail/threads/thread-1"),
      params({ threadId: "thread-1" }),
    );
    const detail = await body<{ ok: true; data: MailThread }>(detailResponse);
    expect(detail.data).toMatchObject({ id: "thread-1", metadataOnly: false });
    expect(detail.data.messages[0].body).toBe("Body for thread-1");
  });

  it("overlays fresh derived cache state without persisting full message bodies", async () => {
    const { databasePath, storage } = await storageForRouteTest();
    await storage.upsertThread({
      accountId: account.id,
      threadId: "thread-1",
      latestMessageId: "thread-1-message",
      subject: "Old cached subject",
      participants: ["old@example.com"],
      preview: "Old cached preview",
      unread: false,
      gmailLabels: [],
      bucket: "priority",
      triage: { reasons: ["Manual correction"] },
      summary: {
        summary: "Cached evidence summary.",
        sourceMessageIds: ["thread-1-message"],
      },
    });
    installDemoProvider();

    const listResponse = await listThreads(
      request("/api/mail/threads?limit=1"),
    );
    const list = await body<{
      ok: true;
      data: {
        threads: Array<
          MailThread & { triage?: unknown; summary?: { summary: string } }
        >;
      };
    }>(listResponse);
    expect(list.data.threads[0]).toMatchObject({
      bucket: "priority",
      triage: { reasons: ["Manual correction"] },
      summary: { summary: "Cached evidence summary." },
    });

    const detailResponse = await getThread(
      request("/api/mail/threads/thread-1"),
      params({ threadId: "thread-1" }),
    );
    const detail = await body<{
      ok: true;
      data: MailThread & { summary?: { summary: string } };
    }>(detailResponse);
    expect(detail.data).toMatchObject({
      bucket: "priority",
      summary: { summary: "Cached evidence summary." },
    });

    const persisted = await createStorage(databasePath).listThreads(account.id);
    expect(persisted[0]).toMatchObject({
      subject: "Subject for thread-1",
      preview: "Preview for thread-1",
      bucket: "priority",
    });
    expect(JSON.stringify(persisted[0])).not.toContain("Body for thread-1");
  });

  it("invalidates stale derived cache state when Gmail reports a newer message", async () => {
    const { databasePath, storage } = await storageForRouteTest();
    await storage.upsertThread({
      accountId: account.id,
      threadId: "thread-1",
      latestMessageId: "old-message-id",
      subject: "Old cached subject",
      participants: ["old@example.com"],
      preview: "Old cached preview",
      unread: false,
      gmailLabels: [],
      bucket: "priority",
      triage: { reasons: ["Old model result"] },
      summary: {
        summary: "Stale summary that must not be returned.",
        sourceMessageIds: ["old-message-id"],
      },
    });
    installDemoProvider();

    const detailResponse = await getThread(
      request("/api/mail/threads/thread-1"),
      params({ threadId: "thread-1" }),
    );
    const detail = await body<{
      ok: true;
      data: MailThread & { triage?: unknown; summary?: unknown };
    }>(detailResponse);
    expect(detail.data.latestMessageId).toBe("thread-1-message");
    expect(detail.data.bucket).not.toBe("priority");
    expect(detail.data).not.toHaveProperty("triage");
    expect(detail.data).not.toHaveProperty("summary");

    const [persisted] = await createStorage(databasePath).listThreads(
      account.id,
    );
    expect(persisted).toMatchObject({
      latestMessageId: "thread-1-message",
      bucket: "other",
    });
    expect(persisted.triage).toBeNull();
    expect(persisted.summary).toBeNull();
    expect(JSON.stringify(persisted)).not.toContain("Body for thread-1");
  });

  it("passes Gmail search through and confirms all core thread mutations", async () => {
    const provider = installDemoProvider();
    const query = "from:alice@example.com has:attachment";

    const searchResponse = await searchMail(
      request(`/api/mail/search?q=${encodeURIComponent(query)}`),
    );
    expect(searchResponse.status).toBe(200);
    expect(provider.searchQueries).toEqual([query]);

    const context = params({ threadId: "thread-1" });
    const archiveResponse = await archiveThread(
      request("/api/mail/threads/thread-1/archive", { method: "POST" }),
      context,
    );
    expect(
      await body<{ data: { mutation: { state: string } } }>(archiveResponse),
    ).toMatchObject({
      data: { mutation: { state: "confirmed" } },
    });

    await markRead(
      request("/api/mail/threads/thread-1/read", { method: "POST" }),
      context,
    );
    await markUnread(
      request("/api/mail/threads/thread-1/unread", { method: "POST" }),
      context,
    );
    await applyLabel(
      request("/api/mail/threads/thread-1/labels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ labelId: "STARRED" }),
      }),
      context,
    );
    await removeLabel(
      request("/api/mail/threads/thread-1/labels", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ labelId: "STARRED" }),
      }),
      context,
    );

    const thread = await provider.getThread("thread-1");
    expect(thread.labelIds).toEqual(["UNREAD"]);
    expect(thread.unread).toBe(true);
  });

  it("returns a reconcile receipt when a Gmail mutation fails", async () => {
    const provider = installDemoProvider();
    vi.spyOn(provider, "archiveThread").mockRejectedValue(
      new MailProviderError("GMAIL_API_ERROR", "Gmail request failed."),
    );

    const response = await archiveThread(
      request("/api/mail/threads/thread-1/archive", { method: "POST" }),
      params({ threadId: "thread-1" }),
    );

    expect(response.status).toBe(502);
    expect(
      await body<{
        mutation: { threadId: string; operation: string; state: string };
      }>(response),
    ).toMatchObject({
      mutation: {
        threadId: "thread-1",
        operation: "archive",
        state: "reconcile",
      },
    });
    expect((await provider.getThread("thread-1")).labelIds).toContain("INBOX");
  });

  it("creates drafts but sends only after explicit confirmation", async () => {
    const provider = installDemoProvider();
    const draftResponse = await createDraft(
      request("/api/mail/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: "thread-1",
          to: ["alice@example.com"],
          subject: "Re: Subject for thread-1",
          body: "Thursday works.",
        }),
      }),
    );
    const draft = await body<{ data: { id: string } }>(draftResponse);
    expect(draftResponse.status).toBe(201);

    const denied = await sendDraft(
      request(`/api/mail/drafts/${draft.data.id}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: false }),
      }),
      params({ draftId: draft.data.id }),
    );
    expect(denied.status).toBe(400);
    expect(await body<{ error: { code: string } }>(denied)).toMatchObject({
      error: { code: "EXPLICIT_SEND_REQUIRED" },
    });
    expect((await provider.getThread("thread-1")).latestMessageId).toBe(
      "thread-1-message",
    );

    const sent = await sendDraft(
      request(`/api/mail/drafts/${draft.data.id}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      }),
      params({ draftId: draft.data.id }),
    );
    expect(sent.status).toBe(200);
    expect((await provider.getThread("thread-1")).latestMessageId).toBe(
      `sent-${draft.data.id}`,
    );
  });

  it("returns a recoverable reconnect state for revoked OAuth", async () => {
    const provider = installDemoProvider();
    provider.setOAuthRevoked();

    const response = await listThreads(request("/api/mail/threads"));

    expect(response.status).toBe(401);
    expect(
      await body<{ error: { code: string; recoverable: boolean } }>(response),
    ).toMatchObject({
      error: { code: "OAUTH_REVOKED", recoverable: true },
    });
  });
});

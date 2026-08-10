import { describe, expect, it } from "vitest";

import {
  assertSingleGmailAccount,
  DemoMailProvider,
  GmailMailProvider,
  type GmailApiClient,
  type MailAccount,
  type MailThread,
  normalizeGmailThread,
  OneAccountLimitError,
  OAuthRevokedError,
} from "@subzero/mail";

const account: MailAccount = {
  id: "account-1",
  gmailAddress: "owner@example.com",
  googleSubject: "google-subject-1",
};

const rawThread = {
  id: "thread-1",
  historyId: "12",
  snippet: "Latest preview",
  messages: [
    {
      id: "message-1",
      threadId: "thread-1",
      internalDate: "1704067200000",
      labelIds: ["INBOX", "UNREAD"],
      snippet: "Hello from Alice",
      payload: {
        mimeType: "multipart/alternative",
        headers: [
          { name: "From", value: "Alice Example <alice@example.com>" },
          { name: "To", value: "owner@example.com" },
          { name: "Subject", value: "Project update" },
          { name: "Date", value: "Mon, 01 Jan 2024 00:00:00 +0000" },
          { name: "Message-ID", value: "<message-1@example.com>" },
        ],
        parts: [
          {
            mimeType: "text/plain",
            body: {
              data: Buffer.from("Plain text body").toString("base64url"),
            },
          },
          {
            mimeType: "text/html",
            body: {
              data: Buffer.from("<p>HTML body</p>").toString("base64url"),
            },
          },
        ],
      },
    },
  ],
};

function fixtureThread(): MailThread {
  return normalizeGmailThread(rawThread, { includeBodies: true });
}

describe("Gmail normalization", () => {
  it("normalizes metadata without materializing message bodies", () => {
    const thread = normalizeGmailThread(rawThread);

    expect(thread).toMatchObject({
      id: "thread-1",
      latestMessageId: "message-1",
      subject: "Project update",
      unread: true,
      metadataOnly: true,
      labelIds: ["INBOX", "UNREAD"],
    });
    expect(thread.participants).toEqual([
      { address: "alice@example.com", name: "Alice Example" },
      { address: "owner@example.com" },
    ]);
    expect(thread.messages[0]).not.toHaveProperty("body");
    expect(thread.messages[0]).not.toHaveProperty("htmlBody");
  });

  it("decodes bodies only for an explicitly opened thread", () => {
    const thread = normalizeGmailThread(rawThread, { includeBodies: true });

    expect(thread.metadataOnly).toBe(false);
    expect(thread.messages[0]).toMatchObject({
      body: "Plain text body",
      htmlBody: "<p>HTML body</p>",
    });
  });
});

describe("DemoMailProvider", () => {
  it("performs deterministic Gmail mutations and keeps a sent reply in its thread", async () => {
    const provider = new DemoMailProvider({
      account,
      threads: [fixtureThread()],
    });

    await provider.archiveThread("thread-1");
    await provider.markRead("thread-1");
    await provider.applyLabel("thread-1", "STARRED");
    await provider.markUnread("thread-1");
    await provider.removeLabel("thread-1", "STARRED");

    const mutated = await provider.getThread("thread-1");
    expect(mutated.labelIds).toEqual(["UNREAD"]);
    expect(mutated.unread).toBe(true);

    const draft = await provider.createDraft({
      threadId: "thread-1",
      to: ["alice@example.com"],
      subject: "Re: Project update",
      body: "Thursday works.",
    });
    const sent = await provider.sendDraft(draft.id);

    expect(sent).toEqual({
      draftId: draft.id,
      messageId: `sent-${draft.id}`,
      threadId: "thread-1",
    });
    expect((await provider.getThread("thread-1")).latestMessageId).toBe(
      sent.messageId,
    );
  });
});

describe("GmailMailProvider", () => {
  it("passes Gmail queries through unchanged", async () => {
    const listCalls: Array<Record<string, unknown>> = [];
    const client: GmailApiClient = {
      users: {
        threads: {
          async list(input) {
            listCalls.push(input);
            return { data: { threads: [{ id: "thread-1" }] } };
          },
          async get() {
            return { data: rawThread };
          },
          async modify() {
            return {};
          },
        },
        drafts: {
          async create() {
            return { data: { id: "draft-1" } };
          },
          async send() {
            return { data: { id: "sent-1", threadId: "thread-1" } };
          },
        },
      },
    };
    const provider = new GmailMailProvider({ account, client });

    const results = await provider.search("from:sarah invoice");

    expect(listCalls).toHaveLength(1);
    expect(listCalls[0]).toMatchObject({
      userId: "me",
      q: "from:sarah invoice",
      maxResults: 200,
    });
    expect(results[0].thread.id).toBe("thread-1");
  });

  it("maps Gmail mutations and keeps a reply draft in the requested Gmail thread", async () => {
    const modifications: Array<Record<string, unknown>> = [];
    let createdDraft: Record<string, unknown> | undefined;
    let sentDraft: Record<string, unknown> | undefined;
    const client: GmailApiClient = {
      users: {
        threads: {
          async list() {
            return { data: { threads: [] } };
          },
          async get() {
            return { data: rawThread };
          },
          async modify(input) {
            modifications.push(input);
            return {};
          },
        },
        drafts: {
          async create(input) {
            createdDraft = input;
            return {
              data: { id: "draft-1", message: { threadId: "thread-1" } },
            };
          },
          async send(input) {
            sentDraft = input;
            return { data: { id: "sent-1", threadId: "thread-1" } };
          },
        },
      },
    };
    const provider = new GmailMailProvider({ account, client });

    await provider.archiveThread("thread-1");
    await provider.markRead("thread-1");
    await provider.markUnread("thread-1");
    await provider.applyLabel("thread-1", "STARRED");
    await provider.removeLabel("thread-1", "STARRED");

    expect(modifications.map((call) => call.requestBody)).toEqual([
      { removeLabelIds: ["INBOX"] },
      { removeLabelIds: ["UNREAD"] },
      { addLabelIds: ["UNREAD"] },
      { addLabelIds: ["STARRED"] },
      { removeLabelIds: ["STARRED"] },
    ]);

    const draft = await provider.createDraft({
      threadId: "thread-1",
      replyToMessageId: "<message-1@example.com>",
      to: ["alice@example.com"],
      subject: "Re: Project update",
      body: "Thursday works.",
    });
    const encodedMessage = createdDraft?.requestBody as {
      message: { raw: string; threadId?: string };
    };
    expect(encodedMessage.message.threadId).toBe("thread-1");
    expect(
      Buffer.from(encodedMessage.message.raw, "base64url").toString("utf8"),
    ).toContain("In-Reply-To: <message-1@example.com>");
    expect(draft.threadId).toBe("thread-1");

    await expect(provider.sendDraft(draft.id)).resolves.toEqual({
      draftId: "draft-1",
      messageId: "sent-1",
      threadId: "thread-1",
    });
    expect(sentDraft).toMatchObject({
      userId: "me",
      requestBody: { id: "draft-1" },
    });
  });
});

describe("single-account and revoked OAuth guards", () => {
  it("allows reconnecting the same account and rejects another Google subject", () => {
    expect(() =>
      assertSingleGmailAccount([account], account.googleSubject),
    ).not.toThrow();
    expect(() =>
      assertSingleGmailAccount([account], "google-subject-2"),
    ).toThrow(OneAccountLimitError);
  });

  it("represents revoked OAuth as a recoverable reconnect error", async () => {
    const provider = new DemoMailProvider({
      account,
      threads: [fixtureThread()],
    });
    provider.setOAuthRevoked();

    await expect(provider.listThreads()).rejects.toBeInstanceOf(
      OAuthRevokedError,
    );
    await expect(provider.listThreads()).rejects.toMatchObject({
      code: "OAUTH_REVOKED",
      recoverable: true,
    });
  });
});

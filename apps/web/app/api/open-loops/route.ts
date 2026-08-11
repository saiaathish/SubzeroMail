import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { createStorage } from "@subzero/storage";
import { MailRouteError } from "../mail/_shared";
import { requireMailRouteContext } from "../mail/runtime";
import {
  isOpenLoopDirection,
  optionalDueAt,
  OpenLoopRouteError,
  requiredOpenLoopString,
  toOpenLoop,
} from "./_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(cause: unknown) {
  if (cause instanceof MailRouteError) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: cause.code, message: cause.message },
      },
      { status: cause.status },
    );
  }
  const error =
    cause instanceof OpenLoopRouteError
      ? cause
      : new OpenLoopRouteError(
          "INVALID_REQUEST",
          "Open Loop request failed. Please try again.",
          500,
        );
  return NextResponse.json(
    { ok: false, error: { code: error.code, message: error.message } },
    { status: error.status },
  );
}

export async function GET(request: Request) {
  try {
    const { account, provider } = await requireMailRouteContext(request);
    const storage = createStorage();
    const loops = await storage.listOpenLoops(account.id);
    const threads = await storage.listThreads(account.id);

    // Automatic resolution is direction-aware: a loop is superseded only when
    // the newest message actually advances the obligation — the account owner
    // replied (resolves "i_owe") or the other party replied (resolves
    // "they_owe"/"waiting"). An inbound nudge never resolves the user's own
    // obligation, and a user nudge never resolves the other party's.
    const ownerAddress = account.gmailAddress.toLowerCase();
    for (const loop of loops) {
      if (loop.status !== "open") continue;
      const cached = threads.find(
        (thread) => thread.threadId === loop.threadId,
      );
      if (
        !cached ||
        !loop.sourceMessageId ||
        cached.latestMessageId === loop.sourceMessageId
      ) {
        continue;
      }
      let newestFrom: string | undefined;
      try {
        const thread = await provider.getThread(loop.threadId);
        newestFrom = thread.messages.at(-1)?.from?.address;
      } catch {
        continue; // Unreachable evidence must never resolve a loop.
      }
      const ownerReplied =
        typeof newestFrom === "string" &&
        newestFrom.toLowerCase() === ownerAddress;
      const resolves =
        loop.direction === "i_owe" ? ownerReplied : !ownerReplied;
      if (!resolves) continue;
      await storage.updateOpenLoop({
        accountId: account.id,
        id: loop.id,
        status: "resolved",
      });
      loop.status = "resolved";
      loop.resolvedAt = new Date().toISOString();
    }

    // Reminders resurface open commitments that are due now or within two days.
    const horizon = Date.now() + 2 * 24 * 60 * 60 * 1000;
    const reminders = loops
      .filter((loop) => loop.status === "open" && loop.dueAt)
      .map((loop) => ({
        loopId: loop.id,
        threadId: loop.threadId,
        text: loop.text,
        dueAt: loop.dueAt!,
        kind:
          new Date(loop.dueAt!).getTime() <= Date.now()
            ? ("overdue" as const)
            : ("due_soon" as const),
      }))
      .filter((reminder) => new Date(reminder.dueAt).getTime() <= horizon)
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt));

    return NextResponse.json({
      ok: true,
      data: {
        loops: loops.map(toOpenLoop),
        reminders,
      },
    });
  } catch (cause) {
    return errorResponse(cause);
  }
}

/** A manual mark is explicit user state, never an automatic mailbox mutation. */
export async function POST(request: Request) {
  try {
    const { account, provider } = await requireMailRouteContext(request);
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new OpenLoopRouteError(
        "INVALID_REQUEST",
        "Request body must be valid JSON.",
        400,
      );
    }
    const input = body as Record<string, unknown>;
    const threadId = requiredOpenLoopString(input.threadId, "threadId");
    const sourceMessageId =
      input.sourceMessageId === undefined || input.sourceMessageId === null
        ? null
        : requiredOpenLoopString(input.sourceMessageId, "sourceMessageId");
    if (!isOpenLoopDirection(input.direction)) {
      throw new OpenLoopRouteError(
        "INVALID_REQUEST",
        "direction must be i_owe, they_owe, or waiting.",
        400,
      );
    }
    const text = requiredOpenLoopString(input.text, "text");
    const dueAt = optionalDueAt(input.dueAt);

    if (sourceMessageId) {
      const thread = await provider.getThread(threadId);
      if (!thread.messages.some((message) => message.id === sourceMessageId)) {
        throw new OpenLoopRouteError(
          "INVALID_REQUEST",
          "sourceMessageId must belong to the selected thread.",
          400,
        );
      }
    }

    const now = new Date().toISOString();
    const loop = {
      id: randomUUID(),
      accountId: account.id,
      threadId,
      sourceMessageId,
      direction: input.direction,
      text,
      dueAt,
      confidence: 1,
      status: "open" as const,
      createdAt: now,
      resolvedAt: null,
    };
    const storage = createStorage();
    await storage.upsertOpenLoop(loop);
    const persisted = (await storage.listOpenLoops(account.id)).find(
      (stored) =>
        stored.threadId === loop.threadId &&
        stored.sourceMessageId === loop.sourceMessageId &&
        stored.direction === loop.direction &&
        stored.text === loop.text,
    );
    return NextResponse.json({
      ok: true,
      data: { loop: toOpenLoop(persisted ?? loop) },
    });
  } catch (cause) {
    return errorResponse(cause);
  }
}

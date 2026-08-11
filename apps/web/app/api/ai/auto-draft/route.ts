import { isAsyncIterable } from "@subzero/ai";
import { createStorage } from "@subzero/storage";
import { NextResponse } from "next/server";
import {
  aiJson,
  AIActionError,
  configuredAIProvider,
  currentThread,
  readActionBody,
  requiredString,
} from "../_shared";

export const runtime = "nodejs";

async function collectDraft(
  draft: string | AsyncIterable<string>,
): Promise<string> {
  if (!isAsyncIterable(draft)) return draft;
  let collected = "";
  for await (const chunk of draft) collected += chunk;
  return collected;
}

/**
 * Background suggested draft for the selected high-priority thread.
 * - Never regenerates after the user has manually edited the draft.
 * - Regenerates only when the thread gained a newer message since generation.
 * - Returns the cached draft instead of paying for a new completion when
 *   nothing changed.
 */
export async function POST(request: Request) {
  try {
    const body = await readActionBody(request);
    const threadId = requiredString(body.threadId, "threadId");
    const { context, thread, aiThread } = await currentThread(
      request,
      threadId,
    );
    const storage = createStorage();

    if (body.userEdited === true) {
      await storage.markAutoDraftEdited(context.account.id, threadId);
      return NextResponse.json({ ok: true, data: { draft: null } });
    }

    const existing = await storage.autoDraft(context.account.id, threadId);
    if (existing?.userEditedAt) {
      // The user took over the draft; never overwrite or regenerate it.
      return NextResponse.json({ ok: true, data: { draft: null } });
    }
    if (existing && existing.sourceLatestMessageId === thread.latestMessageId) {
      return NextResponse.json({ ok: true, data: { draft: existing.body } });
    }

    const generated = await aiJson(async () => {
      const provider = await configuredAIProvider(context.account.id);
      return provider.draftReply({
        thread: aiThread,
        intent: "Continue this conversation with a concise reply.",
        signal: request.signal,
      });
    });
    const draft = await collectDraft(generated);
    await storage.saveAutoDraft({
      accountId: context.account.id,
      threadId,
      body: draft,
      sourceLatestMessageId: thread.latestMessageId,
    });
    return NextResponse.json({ ok: true, data: { draft } });
  } catch (cause) {
    if (cause instanceof AIActionError) {
      return NextResponse.json(
        { ok: false, error: { code: cause.code, message: cause.message } },
        { status: cause.status },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "AI_UNAVAILABLE",
          message: "Suggested draft is unavailable right now.",
        },
      },
      { status: 503 },
    );
  }
}

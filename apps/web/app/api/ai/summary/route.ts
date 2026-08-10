import { NextResponse } from "next/server";
import {
  aiJson,
  cachedDerivedState,
  configuredAIProvider,
  currentThread,
  persistDerivedState,
  readActionBody,
  requiredString,
  AIActionError,
} from "../_shared";
import { ThreadSummarySchema } from "@subzero/ai";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readActionBody(request);
    const threadId = requiredString(body.threadId, "threadId");
    const { context, thread, aiThread } = await currentThread(
      request,
      threadId,
    );
    const cached = await cachedDerivedState(context.account.id, threadId);
    const priorSummary = ThreadSummarySchema.safeParse(cached?.summary).success
      ? ThreadSummarySchema.parse(cached?.summary)
      : undefined;
    if (cached?.latestMessageId === thread.latestMessageId && priorSummary) {
      return NextResponse.json({ ok: true, data: priorSummary, cached: true });
    }
    const summary = await aiJson(() =>
      configuredAIProvider(context.account.id).then((provider) =>
        provider.summarizeThread({
          thread: aiThread,
          previousSummary: priorSummary,
          signal: request.signal,
        }),
      ),
    );
    await persistDerivedState({
      accountId: context.account.id,
      thread,
      summary,
    });
    return NextResponse.json({ ok: true, data: summary });
  } catch (cause) {
    const error =
      cause instanceof AIActionError
        ? cause
        : new AIActionError(
            "AI_UNAVAILABLE",
            "Thread summary is unavailable.",
            503,
          );
    return NextResponse.json(
      {
        ok: false,
        error: { code: error.code, message: error.message, recoverable: true },
      },
      { status: error.status },
    );
  }
}

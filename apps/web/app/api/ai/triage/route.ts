import { NextResponse } from "next/server";
import type { ThreadTriage } from "@subzero/ai";
import {
  aiJson,
  configuredAIProvider,
  currentThread,
  deterministicTriage,
  persistDerivedState,
  readActionBody,
  requiredString,
  AIActionError,
} from "../_shared";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readActionBody(request);
    const threadId = requiredString(body.threadId, "threadId");
    const { context, thread, aiThread } = await currentThread(
      request,
      threadId,
    );
    const manualBucket = body.bucket;
    if (
      manualBucket !== undefined &&
      manualBucket !== "priority" &&
      manualBucket !== "needs_reply" &&
      manualBucket !== "waiting" &&
      manualBucket !== "other"
    ) {
      throw new AIActionError(
        "INVALID_REQUEST",
        "bucket must be a valid Focus View.",
        400,
      );
    }
    const deterministic = deterministicTriage(aiThread);
    const triage: ThreadTriage = manualBucket
      ? {
          bucket: manualBucket as ThreadTriage["bucket"],
          confidence: 1,
          reasons: ["Manual correction"],
          sourceMessageIds: [thread.latestMessageId],
        }
      : (deterministic ??
        (await aiJson(() =>
          configuredAIProvider(context.account.id).then((provider) =>
            provider.classifyThread({
              thread: aiThread,
              signal: request.signal,
            }),
          ),
        )));
    await persistDerivedState({
      accountId: context.account.id,
      thread,
      triage,
    });
    return NextResponse.json({
      ok: true,
      data: { triage, deterministic: Boolean(deterministic) },
    });
  } catch (cause) {
    return actionError(cause);
  }
}

function actionError(cause: unknown) {
  const error =
    cause instanceof AIActionError
      ? cause
      : new AIActionError("AI_UNAVAILABLE", "AI triage is unavailable.", 503);
  return NextResponse.json(
    {
      ok: false,
      error: { code: error.code, message: error.message, recoverable: true },
    },
    { status: error.status },
  );
}

import { NextResponse } from "next/server";

import {
  aiJson,
  configuredAIProvider,
  currentThread,
  requiredString,
  AIActionError,
} from "../../ai/_shared";
import { MailRouteError } from "../../mail/_shared";
import { deterministicOpenLoopCandidates } from "@/features/open-loops/detection";
import {
  assertCandidateSources,
  OpenLoopRouteError,
  persistCandidates,
} from "../_shared";

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
      : cause instanceof AIActionError
        ? new OpenLoopRouteError(cause.code, cause.message, cause.status)
        : new OpenLoopRouteError(
            "AI_UNAVAILABLE",
            "Open Loop extraction is unavailable. You can add one manually.",
            503,
          );
  return NextResponse.json(
    { ok: false, error: { code: error.code, message: error.message } },
    { status: error.status },
  );
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new OpenLoopRouteError(
        "INVALID_REQUEST",
        "Request body must be valid JSON.",
        400,
      );
    }
    const threadId = requiredString(
      (body as Record<string, unknown>).threadId,
      "threadId",
    );
    const { context, thread, aiThread } = await currentThread(
      request,
      threadId,
    );
    const deterministic = deterministicOpenLoopCandidates(
      thread,
      context.account.gmailAddress,
    );
    const candidates =
      deterministic.length > 0
        ? deterministic
        : await aiJson(() =>
            configuredAIProvider(context.account.id).then((provider) =>
              provider.extractOpenLoops({
                thread: aiThread,
                signal: request.signal,
              }),
            ),
          );
    assertCandidateSources(candidates, thread);
    const loops = await persistCandidates(context.account.id, candidates);
    return NextResponse.json({
      ok: true,
      data: { loops, deterministic: deterministic.length > 0 },
    });
  } catch (cause) {
    return errorResponse(cause);
  }
}

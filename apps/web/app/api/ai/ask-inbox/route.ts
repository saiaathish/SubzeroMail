import { NextResponse } from "next/server";

import {
  aiJson,
  configuredAIProvider,
  readActionBody,
  requiredString,
  AIActionError,
} from "../_shared";
import { requireMailRouteContext } from "../../mail/runtime";
import {
  answerAskInbox,
  AskInboxServiceError,
  validateAskInboxQuestion,
} from "./service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ask Inbox is retrieval-first: an AI provider proposes up to three Gmail
 * queries, Gmail returns bounded candidates, and only ranked message evidence
 * is supplied to the answering call.
 */
export async function POST(request: Request) {
  try {
    const body = await readActionBody(request);
    const question = validateAskInboxQuestion(
      requiredString(body.question, "question"),
    );
    const context = await requireMailRouteContext(request);
    const provider = await configuredAIProvider(context.account.id);
    const result = await aiJson(() =>
      answerAskInbox({
        provider,
        mailProvider: context.provider,
        question,
        signal: request.signal,
      }),
    );
    return NextResponse.json({
      ok: true,
      data: {
        ...result.answer,
        sources: result.sources,
        retrieval: result.retrieval,
      },
    });
  } catch (cause) {
    const error =
      cause instanceof AskInboxServiceError
        ? new AIActionError("INVALID_REQUEST", cause.message, 400)
        : cause instanceof AIActionError
          ? cause
          : new AIActionError(
              "AI_UNAVAILABLE",
              "Ask Inbox is unavailable. Gmail remains available.",
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

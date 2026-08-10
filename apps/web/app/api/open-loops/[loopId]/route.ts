import { NextResponse } from "next/server";
import { createStorage } from "@subzero/storage";
import { MailRouteError } from "../../mail/_shared";
import { requireMailRouteContext } from "../../mail/runtime";
import {
  isOpenLoopDirection,
  isOpenLoopStatus,
  optionalDueAt,
  OpenLoopRouteError,
  requiredOpenLoopString,
  toOpenLoop,
} from "../_shared";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ loopId: string }> };

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
          "Open Loop update failed. Please try again.",
          500,
        );
  return NextResponse.json(
    { ok: false, error: { code: error.code, message: error.message } },
    { status: error.status },
  );
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { account } = await requireMailRouteContext(request);
    const { loopId } = await context.params;
    const id = requiredOpenLoopString(loopId, "loopId");
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new OpenLoopRouteError(
        "INVALID_REQUEST",
        "Request body must be valid JSON.",
        400,
      );
    }
    const input = body as Record<string, unknown>;
    if (
      input.direction !== undefined &&
      !isOpenLoopDirection(input.direction)
    ) {
      throw new OpenLoopRouteError(
        "INVALID_REQUEST",
        "direction must be i_owe, they_owe, or waiting.",
        400,
      );
    }
    if (input.status !== undefined && !isOpenLoopStatus(input.status)) {
      throw new OpenLoopRouteError(
        "INVALID_REQUEST",
        "status must be open or resolved.",
        400,
      );
    }
    const hasUpdate = ["direction", "text", "dueAt", "status"].some(
      (key) => input[key] !== undefined,
    );
    if (!hasUpdate) {
      throw new OpenLoopRouteError(
        "INVALID_REQUEST",
        "Provide a loop field to update.",
        400,
      );
    }
    const updated = await createStorage().updateOpenLoop({
      accountId: account.id,
      id,
      ...(input.direction !== undefined ? { direction: input.direction } : {}),
      ...(input.text !== undefined
        ? { text: requiredOpenLoopString(input.text, "text") }
        : {}),
      ...(input.dueAt !== undefined
        ? { dueAt: optionalDueAt(input.dueAt) }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    });
    if (!updated) {
      throw new OpenLoopRouteError(
        "LOOP_NOT_FOUND",
        "Open Loop not found.",
        404,
      );
    }
    return NextResponse.json({ ok: true, data: { loop: toOpenLoop(updated) } });
  } catch (cause) {
    return errorResponse(cause);
  }
}

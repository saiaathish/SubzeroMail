import {
  MailRouteError,
  mailErrorResponse,
  mailMutationSuccess,
  readObjectBody,
  requireRouteParam,
} from "../../../_shared";
import { requireMailRouteContext } from "../../../runtime";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ threadId: string }> };

function labelIdFrom(body: Record<string, unknown>): string {
  if (typeof body.labelId !== "string" || body.labelId.length === 0) {
    throw new MailRouteError(
      "INVALID_REQUEST",
      "labelId is required.",
      400,
      false,
    );
  }
  return body.labelId;
}

async function mutateLabel(
  request: Request,
  context: RouteContext,
  operation: "apply_label" | "remove_label",
) {
  let threadId: string;
  try {
    const { provider } = await requireMailRouteContext(request);
    ({ threadId } = await context.params);
    threadId = requireRouteParam(threadId, "threadId");
    const labelId = labelIdFrom(await readObjectBody(request));
    try {
      if (operation === "apply_label") {
        await provider.applyLabel(threadId, labelId);
      } else {
        await provider.removeLabel(threadId, labelId);
      }
      return mailMutationSuccess(threadId, operation);
    } catch (error) {
      return mailErrorResponse(error, { threadId, operation });
    }
  } catch (error) {
    return mailErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  return mutateLabel(request, context, "apply_label");
}

export async function DELETE(request: Request, context: RouteContext) {
  return mutateLabel(request, context, "remove_label");
}

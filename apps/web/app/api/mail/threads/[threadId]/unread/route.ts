import {
  mailErrorResponse,
  mailMutationSuccess,
  requireRouteParam,
} from "../../../_shared";
import { requireMailRouteContext } from "../../../runtime";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ threadId: string }> };

export async function POST(request: Request, context: RouteContext) {
  let threadId: string;
  try {
    const { provider } = await requireMailRouteContext(request);
    ({ threadId } = await context.params);
    threadId = requireRouteParam(threadId, "threadId");
    try {
      await provider.markUnread(threadId);
      return mailMutationSuccess(threadId, "mark_unread");
    } catch (error) {
      return mailErrorResponse(error, { threadId, operation: "mark_unread" });
    }
  } catch (error) {
    return mailErrorResponse(error);
  }
}

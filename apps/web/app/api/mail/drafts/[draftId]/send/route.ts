import {
  MailRouteError,
  mailErrorResponse,
  mailSuccess,
  readObjectBody,
  requireRouteParam,
} from "../../../_shared";
import { requireMailRouteContext } from "../../../runtime";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ draftId: string }> };

/** Prevents a client or AI flow from sending without an explicit user confirmation. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { provider } = await requireMailRouteContext(request);
    const body = await readObjectBody(request);
    if (body.confirm !== true) {
      throw new MailRouteError(
        "EXPLICIT_SEND_REQUIRED",
        "Sending mail requires explicit confirmation.",
        400,
        false,
      );
    }
    const { draftId } = await context.params;
    return mailSuccess(
      await provider.sendDraft(requireRouteParam(draftId, "draftId")),
    );
  } catch (error) {
    return mailErrorResponse(error);
  }
}

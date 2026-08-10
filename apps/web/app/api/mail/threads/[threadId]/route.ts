import {
  mailErrorResponse,
  mailSuccess,
  requireRouteParam,
} from "../../_shared";
import { requireMailRouteContext } from "../../runtime";
import { reconcileThreadCache } from "../cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ threadId: string }> };

/** Lazy full-thread fetch. List routes remain metadata-first. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { account, provider } = await requireMailRouteContext(request);
    const { threadId } = await context.params;
    const thread = await provider.getThread(
      requireRouteParam(threadId, "threadId"),
    );
    return mailSuccess({
      ...(await reconcileThreadCache(account.id, [thread]))[0],
      mailboxAddress: account.gmailAddress,
    });
  } catch (error) {
    return mailErrorResponse(error);
  }
}

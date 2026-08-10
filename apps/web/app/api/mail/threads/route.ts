import { mailErrorResponse, mailSuccess, parseOptionalLimit } from "../_shared";
import { requireMailRouteContext } from "../runtime";
import { reconcileThreadCache } from "./cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Recent Gmail threads; the provider defaults to the PRD-required 200. */
export async function GET(request: Request) {
  try {
    const { account, provider } = await requireMailRouteContext(request);
    const url = new URL(request.url);
    const page = await provider.listThreads({
      limit: parseOptionalLimit(url.searchParams.get("limit")),
      pageToken: url.searchParams.get("pageToken") ?? undefined,
      labelIds: url.searchParams.getAll("label"),
    });
    return mailSuccess({
      ...page,
      mailboxAddress: account.gmailAddress,
      threads: await reconcileThreadCache(account.id, page.threads),
    });
  } catch (error) {
    return mailErrorResponse(error);
  }
}

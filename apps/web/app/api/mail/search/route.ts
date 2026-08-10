import {
  MailRouteError,
  mailErrorResponse,
  mailSuccess,
  parseOptionalLimit,
} from "../_shared";
import { requireMailRouteContext } from "../runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Gmail search grammar remains Gmail-owned: this route forwards q unchanged. */
export async function GET(request: Request) {
  try {
    const { account, provider } = await requireMailRouteContext(request);
    const url = new URL(request.url);
    const query = url.searchParams.get("q");
    if (query === null || query.trim().length === 0) {
      throw new MailRouteError("INVALID_REQUEST", "q is required.", 400, false);
    }

    const results = await provider.search(query, {
      limit: parseOptionalLimit(url.searchParams.get("limit")),
      pageToken: url.searchParams.get("pageToken") ?? undefined,
    });
    return mailSuccess(
      results.map((result) => ({
        ...result,
        thread: { ...result.thread, mailboxAddress: account.gmailAddress },
      })),
    );
  } catch (error) {
    return mailErrorResponse(error);
  }
}

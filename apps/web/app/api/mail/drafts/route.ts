import {
  mailErrorResponse,
  mailSuccess,
  parseDraftInput,
  readObjectBody,
} from "../_shared";
import { requireMailRouteContext } from "../runtime";

export const runtime = "nodejs";

/** Creates a Gmail draft only. Sending is a separate explicit-confirmation route. */
export async function POST(request: Request) {
  try {
    const { provider } = await requireMailRouteContext(request);
    const draft = await provider.createDraft(
      parseDraftInput(await readObjectBody(request)),
    );
    return mailSuccess(draft, 201);
  } catch (error) {
    return mailErrorResponse(error);
  }
}

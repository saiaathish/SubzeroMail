import { NextResponse } from "next/server";

import { createStorage } from "@subzero/storage";

import { deterministicTriage, toThreadContext } from "../../ai/_shared";
import { requireMailRouteContext } from "../runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Trusted, deterministic signal only; never an LLM judgment call. */
const AUTO_ARCHIVE_CONFIDENCE_THRESHOLD = 0.9;

export async function POST(request: Request) {
  try {
    const { account, provider } = await requireMailRouteContext(request);
    const settings = (await createStorage().settings(account.id)) as {
      autoArchive?: unknown;
    };
    if (settings.autoArchive !== true) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "OPT_IN_REQUIRED",
            message: "Auto-archive is not enabled in Focus settings.",
          },
        },
        { status: 403 },
      );
    }

    const page = await provider.listThreads({
      limit: 200,
      labelIds: ["INBOX"],
    });
    const archived: string[] = [];
    for (const thread of page.threads) {
      if (!thread.labelIds.includes("INBOX")) continue;
      const triage = deterministicTriage(toThreadContext(thread));
      if (
        triage &&
        triage.bucket === "other" &&
        triage.confidence >= AUTO_ARCHIVE_CONFIDENCE_THRESHOLD
      ) {
        await provider.archiveThread(thread.id);
        archived.push(thread.id);
      }
    }

    return NextResponse.json({ ok: true, data: { archived } });
  } catch (cause) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "GMAIL_API_ERROR",
          message:
            cause instanceof Error
              ? cause.message
              : "Auto-archive request failed. Please try again.",
        },
      },
      { status: 500 },
    );
  }
}

import { isAsyncIterable, VoiceProfileSchema } from "@subzero/ai";
import { createStorage } from "@subzero/storage";
import { NextResponse } from "next/server";
import {
  aiJson,
  configuredAIProvider,
  currentThread,
  readActionBody,
  requiredString,
  AIActionError,
} from "../_shared";

export const runtime = "nodejs";

/** A missing or stale profile must never prevent the user from drafting mail. */
async function usableVoiceProfile(accountId: string) {
  try {
    const stored = await createStorage().voiceProfile(accountId);
    const parsed = VoiceProfileSchema.safeParse(stored);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export async function POST(request: Request) {
  try {
    const body = await readActionBody(request);
    const threadId = requiredString(body.threadId, "threadId");
    const intent = requiredString(body.intent, "intent");
    const { context, aiThread } = await currentThread(request, threadId);
    const draft = await aiJson(async () => {
      const [provider, voiceProfile] = await Promise.all([
        configuredAIProvider(context.account.id),
        usableVoiceProfile(context.account.id),
      ]);
      return provider.draftReply({
        thread: aiThread,
        intent,
        ...(voiceProfile ? { voiceProfile } : {}),
        signal: request.signal,
      });
    });
    if (!isAsyncIterable(draft))
      return NextResponse.json({ ok: true, data: { draft } });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of draft) {
            if (request.signal.aborted) break;
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        } catch {
          controller.error(new Error("AI draft stream interrupted."));
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (cause) {
    const error =
      cause instanceof AIActionError
        ? cause
        : new AIActionError(
            "AI_UNAVAILABLE",
            "AI draft is unavailable. Continue writing manually.",
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

import { NextResponse } from "next/server";
import {
  type MailAccount,
  type MailMessage,
  type MailProvider,
} from "@subzero/mail";
import {
  type VoiceProfile,
  type VoiceProfileSample,
  VoiceProfileSchema,
} from "@subzero/ai";
import { createStorage } from "@subzero/storage";

import { aiJson, AIActionError, configuredAIProvider } from "../../ai/_shared";
import { MailRouteError } from "../../mail/_shared";
import { requireMailRouteContext } from "../../mail/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIN_SAMPLE_COUNT = 20;
const MAX_SAMPLE_COUNT = 50;
const MAX_SAMPLE_THREADS = 50;
const MAX_SAMPLE_TEXT_CHARACTERS = 8_000;

class VoiceProfileRouteError extends Error {
  constructor(
    readonly code:
      | "INVALID_REQUEST"
      | "OPT_IN_REQUIRED"
      | "INSUFFICIENT_SAMPLES"
      | "PROFILE_UNAVAILABLE",
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function failure(
  code: string,
  message: string,
  status: number,
  recoverable = true,
) {
  return NextResponse.json(
    { ok: false, error: { code, message, recoverable } },
    { status },
  );
}

function errorResponse(cause: unknown) {
  if (cause instanceof VoiceProfileRouteError) {
    return failure(cause.code, cause.message, cause.status, true);
  }
  if (cause instanceof AIActionError) {
    return failure(cause.code, cause.message, cause.status, true);
  }
  if (cause instanceof MailRouteError) {
    return failure(cause.code, cause.message, cause.status, cause.recoverable);
  }

  // Do not include raw sampled text, provider details, or Gmail errors here.
  return failure(
    "PROFILE_UNAVAILABLE",
    "Voice Profile is unavailable. Your inbox and manual drafts still work.",
    503,
  );
}

async function requestBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Voice Profile request was not an object.");
    }
    return body as Record<string, unknown>;
  } catch {
    throw new VoiceProfileRouteError(
      "INVALID_REQUEST",
      "Request body must be valid JSON.",
      400,
    );
  }
}

function requireOptIn(body: Record<string, unknown>) {
  if (body.optIn !== true) {
    throw new VoiceProfileRouteError(
      "OPT_IN_REQUIRED",
      "Confirm Voice Profile opt-in before using sampled sent mail.",
      400,
    );
  }
}

function sampleCount(value: unknown): number {
  const count = value === undefined ? MIN_SAMPLE_COUNT : value;
  if (
    typeof count !== "number" ||
    !Number.isInteger(count) ||
    count < MIN_SAMPLE_COUNT ||
    count > MAX_SAMPLE_COUNT
  ) {
    throw new VoiceProfileRouteError(
      "INVALID_REQUEST",
      "sampleCount must be an integer between 20 and 50.",
      400,
    );
  }
  return count;
}

function parsedProfile(value: unknown): VoiceProfile {
  const parsed = VoiceProfileSchema.safeParse(value);
  if (!parsed.success) {
    throw new VoiceProfileRouteError(
      "INVALID_REQUEST",
      "profile must match the Voice Profile format.",
      400,
    );
  }
  return parsed.data;
}

function storedProfile(value: unknown): VoiceProfile | null {
  if (value === null || value === undefined) return null;
  const parsed = VoiceProfileSchema.safeParse(value);
  if (!parsed.success) {
    throw new VoiceProfileRouteError(
      "PROFILE_UNAVAILABLE",
      "Stored Voice Profile is invalid. Reset it and create a new profile.",
      503,
    );
  }
  return parsed.data;
}

function isOutgoingMessage(message: MailMessage, gmailAddress: string) {
  return (
    message.labelIds.includes("SENT") ||
    message.from?.address.toLocaleLowerCase() ===
      gmailAddress.toLocaleLowerCase()
  );
}

function profileSampleText(message: MailMessage): string | null {
  const text = (message.body ?? message.snippet).trim();
  return text ? text.slice(0, MAX_SAMPLE_TEXT_CHARACTERS) : null;
}

/**
 * Raw sent-mail samples live only in this request while deriving the compact
 * profile. The database receives the profile object, never this array.
 */
async function collectSentSamples(input: {
  account: MailAccount;
  provider: MailProvider;
  count: number;
}): Promise<VoiceProfileSample[]> {
  // Gmail search returns metadata in production. Fetch at most 50 candidate
  // threads for bodies, then select no more than the user-chosen 20–50 samples.
  const candidates = await input.provider.search("in:sent", {
    limit: MAX_SAMPLE_THREADS,
  });
  const samples: VoiceProfileSample[] = [];
  const selectedMessageIds = new Set<string>();

  for (const candidate of candidates.slice(0, MAX_SAMPLE_THREADS)) {
    if (samples.length >= input.count) break;
    const thread = candidate.thread.metadataOnly
      ? await input.provider.getThread(candidate.thread.id)
      : candidate.thread;

    for (const message of thread.messages) {
      if (samples.length >= input.count) break;
      if (
        selectedMessageIds.has(message.id) ||
        !isOutgoingMessage(message, input.account.gmailAddress)
      ) {
        continue;
      }
      const text = profileSampleText(message);
      if (!text) continue;

      selectedMessageIds.add(message.id);
      samples.push({ id: message.id, text });
    }
  }

  return samples;
}

export async function GET(request: Request) {
  try {
    const { account } = await requireMailRouteContext(request);
    const profile = storedProfile(
      await createStorage().voiceProfile(account.id),
    );
    return NextResponse.json({
      ok: true,
      data: { configured: Boolean(profile), profile },
    });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireMailRouteContext(request);
    const body = await requestBody(request);
    const storage = createStorage();

    if (body.action === "create") {
      requireOptIn(body);
      const count = sampleCount(body.sampleCount);
      const samples = await collectSentSamples({
        account: context.account,
        provider: context.provider,
        count,
      });
      if (samples.length < MIN_SAMPLE_COUNT) {
        throw new VoiceProfileRouteError(
          "INSUFFICIENT_SAMPLES",
          "At least 20 readable sent messages are needed to create a Voice Profile.",
          422,
        );
      }

      const provider = await configuredAIProvider(context.account.id);
      const profile = parsedProfile(
        await aiJson(() =>
          provider.createVoiceProfile({ samples, signal: request.signal }),
        ),
      );
      await storage.saveVoiceProfile(context.account.id, profile);
      return NextResponse.json({ ok: true, data: { profile } });
    }

    if (body.action === "save") {
      requireOptIn(body);
      const profile = parsedProfile(body.profile);
      await storage.saveVoiceProfile(context.account.id, profile);
      return NextResponse.json({ ok: true, data: { profile } });
    }

    if (body.action === "reset") {
      await storage.removeVoiceProfile(context.account.id);
      return NextResponse.json({
        ok: true,
        data: { configured: false, profile: null },
      });
    }

    throw new VoiceProfileRouteError(
      "INVALID_REQUEST",
      "action must be create, save, or reset.",
      400,
    );
  } catch (cause) {
    return errorResponse(cause);
  }
}

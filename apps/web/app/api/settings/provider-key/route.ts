import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  AnthropicProvider,
  GeminiProvider,
  OpenAICompatibleProvider,
} from "@subzero/ai";
import {
  decryptSecret,
  encryptSecret,
  redactSensitiveText,
} from "@subzero/security";
import { createStorage } from "@subzero/storage";

import { requireMailRouteContext } from "../../mail/runtime";

export const dynamic = "force-dynamic";

type ProviderId = "openai-compatible" | "anthropic" | "gemini";

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function isProviderId(value: unknown): value is ProviderId {
  return (
    value === "openai-compatible" || value === "anthropic" || value === "gemini"
  );
}

/** Account identity is resolved server-side, never read from a raw client cookie. */
async function trustedAccountId(request: Request): Promise<string | null> {
  try {
    return (await requireMailRouteContext(request)).account.id;
  } catch {
    return null;
  }
}

function createProvider(provider: ProviderId, key: string, model: string) {
  const config = { apiKey: key, model };
  if (provider === "anthropic") return new AnthropicProvider(config);
  if (provider === "gemini") return new GeminiProvider(config);
  return new OpenAICompatibleProvider(config);
}

async function probeProvider(provider: ProviderId, key: string, model: string) {
  if (process.env.SUBZERO_DEMO_MODE === "true") {
    if (key.toLowerCase().includes("invalid"))
      throw new Error("Provider rejected this key.");
    return;
  }
  const client = createProvider(provider, key, model);
  await client.classifyThread({
    thread: {
      threadId: "subzero-provider-probe",
      messages: [
        {
          id: "probe",
          text: "Classify this harmless provider connectivity probe.",
        },
      ],
    },
  });
}

export async function GET(request: Request) {
  const id = await trustedAccountId(request);
  if (!id)
    return error("Connect Gmail before configuring a provider key.", 401);
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider");
  if (!isProviderId(provider))
    return error("A supported provider is required.", 400);
  const encryptedKey = await createStorage().providerKey(id, provider);
  return NextResponse.json({ configured: Boolean(encryptedKey) });
}

export async function POST(request: Request) {
  const id = await trustedAccountId(request);
  if (!id)
    return error("Connect Gmail before configuring a provider key.", 401);

  let input: {
    action?: unknown;
    provider?: unknown;
    model?: unknown;
    key?: unknown;
  };
  try {
    input = await request.json();
  } catch {
    return error("Invalid settings payload.", 400);
  }
  if (
    !isProviderId(input.provider) ||
    typeof input.model !== "string" ||
    !input.model.trim()
  ) {
    return error("A supported provider and model are required.", 400);
  }
  const storage = createStorage();
  if (input.action === "remove") {
    await storage.removeProviderKey(id, input.provider);
    return NextResponse.json({ configured: false });
  }
  const submittedKey = typeof input.key === "string" ? input.key.trim() : "";

  if (input.action === "test") {
    try {
      const encryptedStoredKey = submittedKey
        ? null
        : await storage.providerKey(id, input.provider);
      if (!submittedKey && !encryptedStoredKey)
        return error("No stored provider key is available to test.", 400);
      const key = submittedKey || decryptSecret(encryptedStoredKey!);
      await probeProvider(input.provider, key, input.model);
      return NextResponse.json({ ok: true });
    } catch (cause) {
      // Do not echo provider key material or authorization details in a response.
      const message = redactSensitiveText(
        cause instanceof Error ? cause.message : "Provider connection failed.",
      );
      return error(message || "Provider connection failed.", 422);
    }
  }
  if (input.action !== "save")
    return error("Unsupported provider-key action.", 400);
  if (!submittedKey) return error("A provider key is required.", 400);

  try {
    const encryptedKey = encryptSecret(submittedKey);
    await storage.saveProviderKey({
      id: randomUUID(),
      accountId: id,
      provider: input.provider,
      encryptedKey,
    });
    const currentSettings = await storage.settings(id);
    await storage.saveSettings(id, {
      ...(currentSettings && typeof currentSettings === "object"
        ? currentSettings
        : {}),
      provider: input.provider,
      model: input.model,
    });
    return NextResponse.json({ configured: true });
  } catch (cause) {
    return error(
      redactSensitiveText(
        cause instanceof Error
          ? cause.message
          : "Unable to store provider key.",
      ),
      503,
    );
  }
}

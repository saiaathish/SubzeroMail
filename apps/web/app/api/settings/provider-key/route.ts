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

/**
 * Validate a user-supplied OpenAI-compatible base URL. Absent/empty input is
 * valid (the provider default is used); anything else must be a real URL.
 * Embedded credentials are rejected outright, and plain http is allowed only
 * for loopback hosts (local gateways) — the server sends the API key to this
 * endpoint, so anything else must be https. A trailing slash is stripped so
 * the provider can append the chat path.
 */
function parseBaseUrl(
  value: unknown,
): { ok: true; value?: string } | { ok: false } {
  if (typeof value !== "string" || !value.trim()) return { ok: true };
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { ok: false };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false };
  }
  if (url.username || url.password) {
    return { ok: false };
  }
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1";
  if (url.protocol === "http:" && !loopback) {
    return { ok: false };
  }
  return { ok: true, value: value.trim().replace(/\/+$/, "") };
}

/** Read a previously stored base URL, ignoring any malformed value. */
function storedBaseUrl(settings: unknown): string | undefined {
  if (!settings || typeof settings !== "object") return undefined;
  const parsed = parseBaseUrl((settings as { baseUrl?: unknown }).baseUrl);
  return parsed.ok ? parsed.value : undefined;
}

/** Account identity is resolved server-side, never read from a raw client cookie. */
async function trustedAccountId(request: Request): Promise<string | null> {
  try {
    return (await requireMailRouteContext(request)).account.id;
  } catch {
    return null;
  }
}

function createProvider(
  provider: ProviderId,
  key: string,
  model: string,
  baseUrl?: string,
) {
  const config = {
    apiKey: key,
    model,
    ...(baseUrl ? { baseUrl } : {}),
  };
  if (provider === "anthropic") return new AnthropicProvider(config);
  if (provider === "gemini") return new GeminiProvider(config);
  return new OpenAICompatibleProvider(config);
}

async function probeProvider(
  provider: ProviderId,
  key: string,
  model: string,
  baseUrl?: string,
) {
  if (process.env.SUBZERO_DEMO_MODE === "true") {
    if (key.toLowerCase().includes("invalid"))
      throw new Error("Provider rejected this key.");
    return;
  }
  const client = createProvider(provider, key, model, baseUrl);
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
  const storage = createStorage();
  const encryptedKey = await storage.providerKey(id, provider);
  const settings = (await storage.settings(id)) as {
    model?: unknown;
    baseUrl?: unknown;
  } | null;
  const storedModel =
    typeof settings?.model === "string" ? settings.model : undefined;
  return NextResponse.json({
    configured: Boolean(encryptedKey),
    ...(storedModel ? { model: storedModel } : {}),
    ...(provider === "openai-compatible" && storedBaseUrl(settings)
      ? { baseUrl: storedBaseUrl(settings) }
      : {}),
  });
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
    baseUrl?: unknown;
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
  const parsedBaseUrl = parseBaseUrl(input.baseUrl);
  if (!parsedBaseUrl.ok) {
    return error("Base URL must be a valid http(s) URL.", 400);
  }
  if (input.provider !== "openai-compatible" && parsedBaseUrl.value) {
    return error(
      "A custom base URL is only supported for OpenAI-compatible providers.",
      400,
    );
  }
  const storage = createStorage();
  if (input.action === "remove") {
    await storage.removeProviderKey(id, input.provider);
    return NextResponse.json({ configured: false });
  }
  const submittedKey = typeof input.key === "string" ? input.key.trim() : "";

  if (input.action === "test") {
    try {
      const storedSettings = await storage.settings(id);
      const encryptedStoredKey = submittedKey
        ? null
        : await storage.providerKey(id, input.provider);
      if (!submittedKey && !encryptedStoredKey)
        return error("No stored provider key is available to test.", 400);
      const key = submittedKey || decryptSecret(encryptedStoredKey!);
      const baseUrl =
        input.provider === "openai-compatible"
          ? (parsedBaseUrl.value ?? storedBaseUrl(storedSettings))
          : undefined;
      await probeProvider(input.provider, key, input.model, baseUrl);
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
      ...(input.provider === "openai-compatible"
        ? { baseUrl: parsedBaseUrl.value ?? undefined }
        : {}),
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

import { handleExtensionMessage } from "./message-handler";
import type { ExtensionMessage, ExtensionResponse } from "./messages";
import { getChrome } from "./platform/chrome";

function isPromiseLike<T>(value: unknown): value is Promise<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

export async function sendExtensionMessage<T = unknown>(
  message: ExtensionMessage,
): Promise<ExtensionResponse<T>> {
  const runtime = getChrome()?.runtime;
  const sendMessage = runtime?.sendMessage;
  if (!sendMessage) {
    return (await handleExtensionMessage(message)) as ExtensionResponse<T>;
  }

  return new Promise((resolve) => {
    let settled = false;
    const settle = (response: ExtensionResponse<T>) => {
      if (settled) return;
      settled = true;
      resolve(response);
    };

    try {
      const result = sendMessage<ExtensionResponse<T>>(message, (response) => {
        if (response) {
          settle(response);
          return;
        }
        settle({
          ok: false,
          error: {
            code: runtime.lastError?.message ?? "empty_response",
            message: "The background service returned no response.",
          },
        });
      });

      if (isPromiseLike<ExtensionResponse<T>>(result)) {
        void result.then(settle).catch(() =>
          settle({
            ok: false,
            error: {
              code: "runtime_error",
              message: "The extension runtime was unavailable.",
            },
          }),
        );
      }
    } catch {
      settle({
        ok: false,
        error: {
          code: "runtime_error",
          message: "The extension runtime was unavailable.",
        },
      });
    }
  });
}

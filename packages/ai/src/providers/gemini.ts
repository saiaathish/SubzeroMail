import { AIProviderError } from "../errors";
import {
  type CompletionRequest,
  type HttpAIProviderOptions,
  JsonAIProvider,
  requestError,
  requireProviderConfiguration,
} from "./base";

export class GeminiProvider extends JsonAIProvider {
  readonly id = "gemini";
  private readonly options: HttpAIProviderOptions;

  constructor(options: HttpAIProviderOptions) {
    super();
    requireProviderConfiguration(options);
    this.options = options;
  }

  protected async complete(request: CompletionRequest): Promise<string> {
    const response = await (this.options.fetch ?? fetch)(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        this.options.model,
      )}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": this.options.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: "user", parts: [{ text: request.user }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
        signal: request.signal,
      },
    );

    if (!response.ok) {
      throw await requestError(response);
    }

    const payload: unknown = await response.json();
    const content =
      typeof payload === "object" &&
      payload !== null &&
      Array.isArray((payload as { candidates?: unknown }).candidates)
        ? (
            payload as {
              candidates: Array<{
                content?: { parts?: Array<{ text?: unknown }> };
              }>;
            }
          ).candidates[0]?.content?.parts
            ?.map((part) => (typeof part.text === "string" ? part.text : ""))
            .join("")
        : undefined;

    if (!content) {
      throw new AIProviderError(
        "invalid_output",
        "AI provider returned no completion content.",
      );
    }
    return content;
  }
}

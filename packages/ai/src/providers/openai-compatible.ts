import { AIProviderError } from "../errors";
import {
  type CompletionRequest,
  type HttpAIProviderOptions,
  JsonAIProvider,
  requestError,
  requireProviderConfiguration,
} from "./base";

export interface OpenAICompatibleProviderOptions extends HttpAIProviderOptions {
  /** Defaults to the public OpenAI-compatible chat-completions endpoint. */
  baseUrl?: string;
}

export class OpenAICompatibleProvider extends JsonAIProvider {
  readonly id = "openai-compatible";
  private readonly options: OpenAICompatibleProviderOptions;

  constructor(options: OpenAICompatibleProviderOptions) {
    super();
    requireProviderConfiguration(options);
    this.options = options;
  }

  protected async complete(request: CompletionRequest): Promise<string> {
    const response = await (this.options.fetch ?? fetch)(
      `${this.options.baseUrl ?? "https://api.openai.com/v1"}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.options.model,
          stream: false,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
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
      Array.isArray((payload as { choices?: unknown }).choices)
        ? (payload as { choices: Array<{ message?: { content?: unknown } }> })
            .choices[0]?.message?.content
        : undefined;

    if (typeof content !== "string") {
      throw new AIProviderError(
        "invalid_output",
        "AI provider returned no completion content.",
      );
    }
    return content;
  }
}

import { AIProviderError } from "../errors";
import {
  type CompletionRequest,
  type HttpAIProviderOptions,
  JsonAIProvider,
  requestError,
  requireProviderConfiguration,
} from "./base";

export class AnthropicProvider extends JsonAIProvider {
  readonly id = "anthropic";
  private readonly options: HttpAIProviderOptions;

  constructor(options: HttpAIProviderOptions) {
    super();
    requireProviderConfiguration(options);
    this.options = options;
  }

  protected async complete(request: CompletionRequest): Promise<string> {
    const response = await (this.options.fetch ?? fetch)(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "x-api-key": this.options.apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.options.model,
          max_tokens: 1_024,
          system: request.system,
          messages: [{ role: "user", content: request.user }],
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
      Array.isArray((payload as { content?: unknown }).content)
        ? (
            payload as { content: Array<{ type?: unknown; text?: unknown }> }
          ).content
            .filter(
              (block) =>
                block.type === "text" && typeof block.text === "string",
            )
            .map((block) => block.text)
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

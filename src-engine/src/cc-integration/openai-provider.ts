import type { ModelProvider, ProviderOptions, ProviderResult } from "./model-provider.js";

interface OpenAIConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export class OpenAIProvider implements ModelProvider {
  readonly name = "openai";
  private config: OpenAIConfig;

  constructor(config: OpenAIConfig) {
    this.config = config;
  }

  async execute(prompt: string, options?: ProviderOptions): Promise<ProviderResult> {
    const start = Date.now();
    const model = options?.model || this.config.model || "gpt-4o";
    const baseUrl = this.config.baseUrl || "https://api.openai.com/v1";

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: options?.maxTokens,
        temperature: options?.temperature,
      }),
      signal: options?.abortSignal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${body}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    const output = data.choices[0]?.message?.content ?? "";
    const totalTokens = (data.usage?.prompt_tokens ?? 0) + (data.usage?.completion_tokens ?? 0);
    // Rough cost estimate: $0.005/1K tokens for GPT-4o
    const totalCostUsd = (totalTokens / 1000) * 0.005;

    return {
      output,
      totalCostUsd,
      durationMs: Date.now() - start,
    };
  }
}

import type { ModelProvider, ProviderOptions, ProviderResult } from "./model-provider.js";

interface OllamaConfig {
  baseUrl?: string;
  model?: string;
}

export class OllamaProvider implements ModelProvider {
  readonly name = "ollama";
  private config: OllamaConfig;

  constructor(config?: OllamaConfig) {
    this.config = config || {};
  }

  async execute(prompt: string, options?: ProviderOptions): Promise<ProviderResult> {
    const start = Date.now();
    const model = options?.model || this.config.model || "llama3";
    const baseUrl = this.config.baseUrl || "http://localhost:11434";

    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          num_predict: options?.maxTokens,
          temperature: options?.temperature,
        },
      }),
      signal: options?.abortSignal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${body}`);
    }

    const data = await response.json() as { response: string };
    // Ollama is local, no cost
    return {
      output: data.response ?? "",
      totalCostUsd: 0,
      durationMs: Date.now() - start,
    };
  }
}

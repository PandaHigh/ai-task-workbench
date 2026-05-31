import type { ModelProvider } from "./model-provider.js";
import type { CCClient } from "./cc-client.js";
import { ClaudeProvider } from "./claude-provider.js";
import { OpenAIProvider } from "./openai-provider.js";
import { OllamaProvider } from "./ollama-provider.js";

export interface ProviderConfig {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export function createProvider(config: ProviderConfig, ccClient: CCClient): ModelProvider {
  switch (config.provider) {
    case "openai":
      if (!config.apiKey) throw new Error("OpenAI provider requires an API key");
      return new OpenAIProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
      });
    case "ollama":
      return new OllamaProvider({
        baseUrl: config.baseUrl,
        model: config.model,
      });
    case "claude":
    default:
      return new ClaudeProvider(ccClient);
  }
}

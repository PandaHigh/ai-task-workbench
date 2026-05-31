export interface ProviderMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ProviderOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  workingDir?: string;
  abortSignal?: AbortSignal;
}

export interface ProviderResult {
  output: string;
  totalCostUsd: number;
  durationMs: number;
}

export interface ModelProvider {
  readonly name: string;
  execute(prompt: string, options?: ProviderOptions): Promise<ProviderResult>;
  executeStream?(prompt: string, options?: ProviderOptions): AsyncGenerator<ProviderMessage>;
}

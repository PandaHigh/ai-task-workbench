import type { ModelProvider, ProviderOptions, ProviderResult } from "./model-provider.js";
import type { CCClient } from "./cc-client.js";

export class ClaudeProvider implements ModelProvider {
  readonly name = "claude";
  private ccClient: CCClient;

  constructor(ccClient: CCClient) {
    this.ccClient = ccClient;
  }

  async execute(prompt: string, options?: ProviderOptions): Promise<ProviderResult> {
    const start = Date.now();
    const result = await this.ccClient.executeTask(prompt, {
      workingDir: options?.workingDir || "",
      timeoutMinutes: 10,
      abortSignal: options?.abortSignal,
    });
    return {
      output: result.result,
      totalCostUsd: result.totalCostUsd,
      durationMs: Date.now() - start,
    };
  }
}

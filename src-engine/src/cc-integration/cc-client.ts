import { spawn, type ChildProcess } from "child_process";

export interface CCExecutionOptions {
  workingDir: string;
  sessionId?: string;
  timeoutMinutes: number;
  maxTurns?: number;
  allowedTools?: string[];
  systemPrompt?: string;
  jsonSchema?: Record<string, unknown>;
  abortSignal?: AbortSignal;
}

export interface CCMessage {
  type: string;
  subtype?: string;
  content?: unknown;
  timestamp?: number;
}

export interface CCTaskResult {
  result: string;
  sessionId: string;
  totalCostUsd: number;
  durationMs: number;
  numTurns: number;
  messages: CCMessage[];
}

export class CCClient {
  private claudePath: string;

  constructor(claudePath: string = "claude") {
    this.claudePath = claudePath;
  }

  async executeTask(
    prompt: string,
    options: CCExecutionOptions
  ): Promise<CCTaskResult> {
    const args = this.buildArgs(prompt, options);
    const messages: CCMessage[] = [];
    let result = "";
    let sessionId = "";
    let totalCostUsd = 0;
    let durationMs = 0;
    let numTurns = 0;

    return new Promise((resolve, reject) => {
      const proc = spawn(this.claudePath, args, {
        cwd: options.workingDir,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timeout = setTimeout(() => {
        proc.kill("SIGTERM");
        setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, 5000);
        reject(new Error(`Task timed out after ${options.timeoutMinutes} minutes`));
      }, options.timeoutMinutes * 60 * 1000);

      let stdoutBuffer = "";
      let stderrBuffer = "";

      proc.stdout.on("data", (chunk: Buffer) => {
        stdoutBuffer += chunk.toString();
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            messages.push(msg);
            if (msg.type === "result" && msg.subtype === "success") {
              result = msg.result || "";
              sessionId = msg.session_id || "";
              totalCostUsd = msg.total_cost_usd || 0;
              durationMs = msg.duration_ms || 0;
              numTurns = msg.num_turns || 0;
            }
          } catch {
            // non-JSON line, skip
          }
        }
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        stderrBuffer += chunk.toString();
      });

      proc.on("close", (code) => {
        clearTimeout(timeout);
        if (code === 0 || result) {
          resolve({ result, sessionId, totalCostUsd, durationMs, numTurns, messages });
        } else {
          reject(new Error(`CC process exited with code ${code}: ${stderrBuffer}`));
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      if (options.abortSignal) {
        options.abortSignal.addEventListener("abort", () => {
          proc.kill("SIGTERM");
          setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, 5000);
          reject(new Error("Task was aborted"));
        });
      }
    });
  }

  async *executeTaskStream(
    prompt: string,
    options: CCExecutionOptions
  ): AsyncGenerator<CCMessage> {
    const args = this.buildArgs(prompt, options);

    const proc = spawn(this.claudePath, args, {
      cwd: options.workingDir,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
      setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, 5000);
    }, options.timeoutMinutes * 60 * 1000);

    let buffer = "";
    let resolveNext: ((value: IteratorResult<CCMessage>) => void) | null = null;
    let done = false;

    proc.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (resolveNext) {
            resolveNext({ value: msg, done: false });
            resolveNext = null;
          }
        } catch {
          // skip
        }
      }
    });

    proc.on("close", () => {
      clearTimeout(timeout);
      done = true;
      if (resolveNext) {
        resolveNext({ value: undefined, done: true } as IteratorResult<CCMessage>);
        resolveNext = null;
      }
    });

    if (options.abortSignal) {
      options.abortSignal.addEventListener("abort", () => {
        proc.kill("SIGTERM");
      });
    }

    while (!done) {
      yield await new Promise<CCMessage>((resolve) => {
        resolveNext = (result) => {
          if (result.done) {
            resolve(null as unknown as CCMessage);
          } else {
            resolve(result.value);
          }
        };
      });
    }
  }

  private buildArgs(prompt: string, options: CCExecutionOptions): string[] {
    const useStream = !options.jsonSchema;
    const args: string[] = [
      "-p", prompt,
      "--output-format", useStream ? "stream-json" : "text",
    ];

    if (useStream) {
      args.push("--verbose");
    }

    args.push("--permission-mode", "acceptEdits");

    if (options.maxTurns) {
      args.push("--max-turns", String(options.maxTurns));
    }

    if (options.allowedTools && options.allowedTools.length > 0) {
      args.push("--allowedTools", options.allowedTools.join(","));
    }

    if (options.systemPrompt) {
      args.push("--append-system-prompt", options.systemPrompt);
    }

    if (options.sessionId) {
      args.push("--resume", options.sessionId);
    }

    if (options.jsonSchema) {
      args.push("--json-schema", JSON.stringify(options.jsonSchema));
    }

    return args;
  }
}

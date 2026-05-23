import { spawn } from "child_process";
import { platform } from "os";

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
    this.claudePath = platform() === "win32" && claudePath === "claude" ? "claude.cmd" : claudePath;
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

      let settled = false;
      let sigkillTimer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        clearTimeout(timeout);
        if (sigkillTimer) clearTimeout(sigkillTimer);
      };

      const timeout = setTimeout(() => {
        settled = true;
        proc.kill("SIGTERM");
        sigkillTimer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, 5000);
        reject(new Error(`Task timed out after ${options.timeoutMinutes} minutes`));
      }, options.timeoutMinutes * 60 * 1000);

      let stdoutBuffer = "";
      let stderrBuffer = "";

      const parseAndCollect = (text: string) => {
        if (!text.trim()) return;
        try {
          const msg = JSON.parse(text.trim());
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
      };

      proc.stdout.on("data", (chunk: Buffer) => {
        stdoutBuffer += chunk.toString();
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() || "";
        for (const line of lines) parseAndCollect(line);
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        stderrBuffer += chunk.toString();
      });

      proc.on("close", (code) => {
        // Flush remaining buffer
        parseAndCollect(stdoutBuffer);
        stdoutBuffer = "";
        cleanup();
        if (!settled) {
          settled = true;
          if (code === 0 || result) {
            resolve({ result, sessionId, totalCostUsd, durationMs, numTurns, messages });
          } else {
            reject(new Error(`CC process exited with code ${code}: ${stderrBuffer}`));
          }
        }
      });

      proc.on("error", (err) => {
        cleanup();
        if (!settled) {
          settled = true;
          reject(err);
        }
      });

      if (options.abortSignal) {
        const onAbort = () => {
          if (settled) return;
          settled = true;
          proc.kill("SIGTERM");
          sigkillTimer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, 5000);
          reject(new Error("Task was aborted"));
        };
        options.abortSignal.addEventListener("abort", onAbort);
        const removeAbortListener = () => {
          options.abortSignal!.removeEventListener("abort", onAbort);
        };
        proc.on("close", removeAbortListener);
        proc.on("error", removeAbortListener);
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

    let settled = false;
    let sigkillTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      clearTimeout(timeout);
      if (sigkillTimer) clearTimeout(sigkillTimer);
    };

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGTERM");
      sigkillTimer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, 5000);
    }, options.timeoutMinutes * 60 * 1000);

    let buffer = "";
    let resolveNext: ((value: IteratorResult<CCMessage>) => void) | null = null;
    let done = false;
    let streamError: Error | null = null;

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
      cleanup();
      // Flush remaining buffer
      if (buffer.trim()) {
        try {
          const msg = JSON.parse(buffer.trim());
          if (resolveNext) {
            resolveNext({ value: msg, done: false });
            resolveNext = null;
          }
        } catch {
          // incomplete JSON
        }
      }
      done = true;
      if (resolveNext) {
        resolveNext({ value: undefined, done: true } as IteratorResult<CCMessage>);
        resolveNext = null;
      }
    });

    proc.on("error", (err) => {
      cleanup();
      streamError = err;
      done = true;
      if (resolveNext) {
        resolveNext({ value: undefined, done: true } as IteratorResult<CCMessage>);
        resolveNext = null;
      }
      console.error(`[cc-client] spawn error: ${err.message}`);
    });

    if (options.abortSignal) {
      const onAbort = () => {
        if (settled) return;
        settled = true;
        proc.kill("SIGTERM");
        sigkillTimer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, 5000);
      };
      options.abortSignal.addEventListener("abort", onAbort);
      const removeAbortListener = () => {
        options.abortSignal!.removeEventListener("abort", onAbort);
      };
      proc.on("close", removeAbortListener);
      proc.on("error", removeAbortListener);
    }

    while (!done) {
      const value = await new Promise<CCMessage | null>((resolve) => {
        resolveNext = (result) => {
          if (result.done) {
            resolve(null);
          } else {
            resolve(result.value);
          }
        };
      });
      if (value === null) break;
      yield value;
    }

    if (streamError) {
      throw streamError;
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

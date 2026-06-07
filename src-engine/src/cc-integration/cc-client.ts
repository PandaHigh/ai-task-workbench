import { spawn } from "child_process";
import path from "path";
import { platform, homedir } from "os";

const SAFE_ENV_KEYS = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "LANG",
  "TERM",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SYSTEMROOT",
  "COMSPEC",
  "APPDATA",
  "LOCALAPPDATA",
] as const;

const isWin = platform() === "win32";

// PID tracking for orphan detection and cleanup
const activePids = new Set<number>();

function trackPid(pid: number): void {
  if (pid > 0) activePids.add(pid);
}

function untrackPid(pid: number): void {
  activePids.delete(pid);
}

export function getActivePids(): number[] {
  return [...activePids];
}

export async function killProcessTree(pid: number): Promise<void> {
  try {
    if (isWin) {
      process.kill(pid);
    } else {
      // Kill the entire process group by sending SIGTERM to -pid (negative = group)
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        /* process group may have already exited — will try single pid next */
      }
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* process may have already exited */
      }
      // Give processes 2s then SIGKILL
      await new Promise((r) => setTimeout(r, 2000));
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        /* process may have already exited */
      }
      try {
        process.kill(pid, 0);
      } catch {
        return;
      } // confirmed dead
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* process may have already exited */
      }
    }
  } catch {
    /* process may have already exited */
  }
}

export async function killAllActiveProcesses(): Promise<void> {
  for (const pid of activePids) {
    await killProcessTree(pid);
  }
  activePids.clear();
}

// Environment variables to forward to Claude CLI child process
const FORWARD_ENV_PREFIXES = [
  "ANTHROPIC_", // ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, etc.
  "CLAUDE_", // CLAUDE_API_KEY, CLAUDE_CODE_USE_BEDROCK, etc.
  "AWS_", // AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION (for Bedrock)
  "GOOGLE_", // GOOGLE_CLOUD_PROJECT, etc. (for Vertex)
  "OPENAI_", // OPENAI_API_KEY, OPENAI_BASE_URL (if using OpenAI-compatible)
];

function buildSafeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENV_KEYS) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }
  // Forward LLM/API-related environment variables
  for (const [key, val] of Object.entries(process.env)) {
    if (val === undefined) continue;
    if (FORWARD_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      env[key] = val;
    }
  }
  if (!env.HOME) env.HOME = homedir();
  if (isWin) {
    if (!env.USERPROFILE) env.USERPROFILE = homedir();
    // On Windows, add common npm global bin paths
    if (env.PATH && !env.PATH.toLowerCase().includes("npm")) {
      const appData = process.env.APPDATA || path.join(homedir(), "AppData", "Roaming");
      env.PATH = `${path.join(appData, "npm")}${path.delimiter}${env.PATH}`;
    }
  } else {
    // On Unix, ensure ~/.local/bin is in PATH for claude CLI
    if (env.PATH && !env.PATH.includes("/.local/bin")) {
      env.PATH = `${homedir()}/.local/bin${path.delimiter}${env.PATH}`;
    }
  }
  if (!env.PATH)
    env.PATH = isWin
      ? `${process.env.SYSTEMROOT ?? "C:\\Windows"}\\System32`
      : `/usr/local/bin:/usr/bin:/bin:${homedir()}/.local/bin`;
  env.LANG = env.LANG || (isWin ? "en_US.UTF-8" : "en_US.UTF-8");
  return env;
}

export interface CCExecutionOptions {
  workingDir: string;
  sessionId?: string;
  timeoutMinutes: number;
  maxTurns?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  systemPrompt?: string;
  jsonSchema?: Record<string, unknown>;
  mcpConfig?: string;
  model?: string;
  abortSignal?: AbortSignal;
  stderrCallback?: (data: string) => void;
}

export interface CCMessage {
  type: string;
  subtype?: string;
  content?: unknown;
  timestamp?: number;
  result?: string;
  error?: string;
  session_id?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
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

  async executeTask(prompt: string, options: CCExecutionOptions): Promise<CCTaskResult> {
    const args = this.buildArgs(prompt, options);
    const stdinPrompt = (options as any)._stdinPrompt as string | undefined;
    const messages: CCMessage[] = [];
    let result = "";
    let sessionId = "";
    let totalCostUsd = 0;
    let durationMs = 0;
    let numTurns = 0;

    return new Promise((resolve, reject) => {
      const proc = spawn(this.claudePath, args, {
        cwd: options.workingDir,
        env: buildSafeEnv(),
        stdio: [stdinPrompt ? "pipe" : "ignore", "pipe", "pipe"],
        detached: !isWin,
        ...(isWin ? { shell: true } : {}),
      });

      // Write prompt to stdin when -p was omitted (Windows non-ASCII workaround)
      if (stdinPrompt && proc.stdin) {
        proc.stdin.write(stdinPrompt);
        proc.stdin.end();
      }

      if (proc.pid) trackPid(proc.pid);

      let settled = false;
      let sigkillTimer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        clearTimeout(timeout);
        if (sigkillTimer) clearTimeout(sigkillTimer);
      };

      const timeout = setTimeout(
        () => {
          settled = true;
          proc.kill(isWin ? undefined : "SIGTERM");
          sigkillTimer = setTimeout(() => {
            try {
              proc.kill(isWin ? undefined : "SIGKILL");
            } catch (killErr) {
              console.error(
                "[cc-client] SIGKILL failed after timeout:",
                killErr instanceof Error ? killErr.message : killErr,
              );
            }
          }, 5000);
          reject(new Error(`Task timed out after ${options.timeoutMinutes} minutes`));
        },
        options.timeoutMinutes * 60 * 1000,
      );

      let stdoutBuffer = "";
      let stderrBuffer = "";

      const parseAndCollect = (text: string) => {
        if (!text.trim()) return;
        try {
          const msg = JSON.parse(text.trim());
          messages.push(msg);
          if (msg.type === "result") {
            if (msg.subtype === "success") {
              result = msg.result || "";
              sessionId = msg.session_id || "";
              totalCostUsd = msg.total_cost_usd || 0;
              durationMs = msg.duration_ms || 0;
              numTurns = msg.num_turns || 0;
            } else {
              stderrBuffer += `[CC ${msg.subtype || "error"}] ${msg.result || msg.error || JSON.stringify(msg)}`;
            }
          }
        } catch (parseErr) {
          console.warn(
            `[cc-client] Non-JSON line from CC stdout, skipping: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
          );
        }
      };

      proc.stdout!.on("data", (chunk: Buffer) => {
        stdoutBuffer += chunk.toString();
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() || "";
        for (const line of lines) parseAndCollect(line);
      });

      proc.stderr!.on("data", (chunk: Buffer) => {
        stderrBuffer += chunk.toString();
      });

      proc.on("close", (code) => {
        parseAndCollect(stdoutBuffer);
        stdoutBuffer = "";
        if (proc.pid) untrackPid(proc.pid);
        cleanup();
        if (!settled) {
          settled = true;
          if (code === 0 || result) {
            resolve({ result, sessionId, totalCostUsd, durationMs, numTurns, messages });
          } else {
            const assistantTexts = messages
              .filter((m) => m.type === "assistant")
              .map((m) => {
                if (typeof m.content === "string") return m.content;
                if (Array.isArray(m.content)) return m.content.map((c: any) => c?.text ?? "").join("");
                return "";
              })
              .filter(Boolean);
            const fallbackResult = assistantTexts.length > 0 ? assistantTexts[assistantTexts.length - 1] : "";

            if (fallbackResult) {
              console.warn(
                `[cc-client] CC exited with code ${code} but has ${messages.length} messages — using last assistant message as fallback result`,
              );
              resolve({
                result: fallbackResult,
                sessionId,
                totalCostUsd,
                durationMs,
                numTurns,
                messages,
              });
            } else {
              const errorParts = [`CC process exited with code ${code}`];
              if (stderrBuffer) errorParts.push(stderrBuffer);
              const streamErrors = messages
                .filter((m) => m.type === "result" && m.subtype !== "success")
                .map((m) => m.result || m.error || "")
                .filter(Boolean);
              if (streamErrors.length) errorParts.push(streamErrors.join("; "));
              reject(new Error(errorParts.join(": ")));
            }
          }
        }
      });

      proc.on("error", (err) => {
        if (proc.pid) untrackPid(proc.pid);
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
          proc.kill(isWin ? undefined : "SIGTERM");
          sigkillTimer = setTimeout(() => {
            try {
              proc.kill(isWin ? undefined : "SIGKILL");
            } catch (killErr) {
              console.error(
                "[cc-client] SIGKILL failed after abort:",
                killErr instanceof Error ? killErr.message : killErr,
              );
            }
          }, 5000);
          reject(new Error("Task was aborted"));
        };
        options.abortSignal.addEventListener("abort", onAbort);
        // Safety: remove listener after 30s to prevent leak if proc never exits
        const safetyTimer = setTimeout(() => {
          options.abortSignal!.removeEventListener("abort", onAbort);
        }, 30000);
        const removeAbortListener = () => {
          clearTimeout(safetyTimer);
          options.abortSignal!.removeEventListener("abort", onAbort);
        };
        proc.on("close", removeAbortListener);
        proc.on("error", removeAbortListener);
      }
    });
  }

  async *executeTaskStream(prompt: string, options: CCExecutionOptions): AsyncGenerator<CCMessage> {
    const args = this.buildArgs(prompt, options);
    const stdinPrompt = (options as any)._stdinPrompt as string | undefined;

    const proc = spawn(this.claudePath, args, {
      cwd: options.workingDir,
      env: buildSafeEnv(),
      stdio: [stdinPrompt ? "pipe" : "ignore", "pipe", "pipe"],
      detached: !isWin,
      ...(isWin ? { shell: true } : {}),
    });

    // Write prompt to stdin when -p was omitted (Windows non-ASCII workaround)
    if (stdinPrompt && proc.stdin) {
      proc.stdin.write(stdinPrompt);
      proc.stdin.end();
    }

    if (proc.pid) trackPid(proc.pid);

    let settled = false;
    let sigkillTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      clearTimeout(timeout);
      if (sigkillTimer) clearTimeout(sigkillTimer);
    };

    const timeout = setTimeout(
      () => {
        if (settled) return;
        settled = true;
        proc.kill(isWin ? undefined : "SIGTERM");
        sigkillTimer = setTimeout(() => {
          try {
            proc.kill(isWin ? undefined : "SIGKILL");
          } catch (killErr) {
            console.error(
              "[cc-client] SIGKILL failed after stream timeout:",
              killErr instanceof Error ? killErr.message : killErr,
            );
          }
        }, 5000);
      },
      options.timeoutMinutes * 60 * 1000,
    );

    let buffer = "";
    let resolveNext: ((value: IteratorResult<CCMessage>) => void) | null = null;
    let done = false;
    let streamError: Error | null = null;

    proc.stderr!.on("data", (chunk: Buffer) => {
      const data = chunk.toString();
      options.stderrCallback?.(data);
    });

    proc.stdout!.on("data", (chunk: Buffer) => {
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
        } catch (streamParseErr) {
          console.warn(
            `[cc-client] Non-JSON line from CC stream, skipping: ${streamParseErr instanceof Error ? streamParseErr.message : String(streamParseErr)}`,
          );
        }
      }
    });

    proc.on("close", () => {
      if (proc.pid) untrackPid(proc.pid);
      cleanup();
      if (buffer.trim()) {
        try {
          const msg = JSON.parse(buffer.trim());
          if (resolveNext) {
            resolveNext({ value: msg, done: false });
            resolveNext = null;
          }
        } catch (flushErr) {
          console.warn(
            `[cc-client] Incomplete JSON in stream flush, skipping: ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`,
          );
        }
      }
      done = true;
      if (resolveNext) {
        resolveNext({ value: undefined, done: true } as IteratorResult<CCMessage>);
        resolveNext = null;
      }
    });

    proc.on("error", (err) => {
      if (proc.pid) untrackPid(proc.pid);
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
        proc.kill(isWin ? undefined : "SIGTERM");
        sigkillTimer = setTimeout(() => {
          try {
            proc.kill(isWin ? undefined : "SIGKILL");
          } catch (killErr) {
            console.error(
              "[cc-client] SIGKILL failed after stream abort:",
              killErr instanceof Error ? killErr.message : killErr,
            );
          }
        }, 5000);
      };
      options.abortSignal.addEventListener("abort", onAbort);
      // Safety: remove listener after 30s to prevent leak if proc never exits
      const safetyTimer = setTimeout(() => {
        options.abortSignal!.removeEventListener("abort", onAbort);
      }, 30000);
      const removeAbortListener = () => {
        clearTimeout(safetyTimer);
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
    // On Windows, non-ASCII chars in -p argument cause --output-format stream-json
    // to be ignored (plain text output instead of JSON). Workaround: pass prompt via stdin.
    const hasNonAscii = /[\x80-￿]/.test(prompt);
    const useStdinPrompt = isWin && hasNonAscii;

    const args: string[] = [];

    if (!useStdinPrompt) {
      args.push("-p", prompt);
    }

    args.push(
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "acceptEdits",
    );

    if (useStdinPrompt) {
      // Mark for stdin piping — caller must write prompt to stdin
      (options as any)._stdinPrompt = prompt;
    }

    if (options.model) {
      args.push("--model", options.model);
    }

    // maxTurns disabled — let CC run without turn limits

    if (options.allowedTools && options.allowedTools.length > 0) {
      args.push("--allowedTools", options.allowedTools.join(","));
    }

    if (options.disallowedTools && options.disallowedTools.length > 0) {
      args.push("--disallowedTools", options.disallowedTools.join(","));
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

    if (options.mcpConfig) {
      args.push("--mcp-config", options.mcpConfig);
    }

    return args;
  }
}

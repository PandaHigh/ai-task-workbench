import { spawn } from "child_process";
import { platform, homedir } from "os";

const SAFE_ENV_KEYS = [
  "PATH", "HOME", "LANG", "TERM", "TMPDIR", "TEMP", "TMP",
  // Claude / Anthropic SDK
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
  // Shell / Node
  "SHELL", "NODE_PATH", "NVM_DIR", "USER", "LOGNAME",
  // TTY
  "TERM_PROGRAM", "COLORTERM", "TERMINFO",
  // Proxy
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
] as const;

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
    process.kill(pid, "SIGTERM");
  } catch {
    // Process already gone
  }
}

export async function killAllActiveProcesses(): Promise<void> {
  for (const pid of activePids) {
    await killProcessTree(pid);
  }
  activePids.clear();
}

function buildSafeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENV_KEYS) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }
  if (!env.HOME) env.HOME = homedir();

  // Ensure PATH covers common binary locations (including ~/.local/bin for claude CLI)
  const home = env.HOME;
  const essentialPaths = [
    "/usr/bin", "/bin", "/usr/sbin", "/sbin", "/usr/local/bin",
    "/opt/homebrew/bin", "/opt/homebrew/sbin",
    `${home}/.local/bin`, `${home}/.local/share/nvm/versions/node/*/bin`,
  ];
  const currentPaths = (env.PATH || "").split(":");
  const merged = new Set([...currentPaths, ...essentialPaths]);
  env.PATH = [...merged].join(":");

  env.LANG = env.LANG || "en_US.UTF-8";

  console.log("[cc-client] buildSafeEnv PATH includes .local/bin:", env.PATH.includes(".local/bin"));
  return env;
}

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

  constructor(claudePath?: string) {
    if (claudePath) {
      this.claudePath = claudePath;
    } else {
      // Resolve claude binary path at construction time
      const home = homedir();
      const candidates = [
        "claude",
        `${home}/.local/bin/claude`,
        "/usr/local/bin/claude",
        "/opt/homebrew/bin/claude",
      ];
      this.claudePath = candidates[0]; // default, will rely on PATH
      for (const c of candidates.slice(1)) {
        try {
          const fs = require("fs");
          if (fs.existsSync(c)) {
            this.claudePath = c;
            break;
          }
        } catch { /* skip */ }
      }
    }
    if (platform() === "win32" && this.claudePath === "claude") {
      this.claudePath = "claude.cmd";
    }
    console.log("[cc-client] claudePath resolved to:", this.claudePath);
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
        env: { ...process.env, ...buildSafeEnv() },
        stdio: ["ignore", "pipe", "pipe"],
      });

      if (proc.pid) trackPid(proc.pid);

      let settled = false;
      let sigkillTimer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        clearTimeout(timeout);
        if (sigkillTimer) clearTimeout(sigkillTimer);
      };

      const timeout = setTimeout(() => {
        settled = true;
        proc.kill("SIGTERM");
        sigkillTimer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch (killErr) { console.error("[cc-client] SIGKILL failed after timeout:", killErr instanceof Error ? killErr.message : killErr); } }, 5000);
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
        } catch (parseErr) {
          console.warn(`[cc-client] Non-JSON line from CC stdout, skipping: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
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
        if (proc.pid) untrackPid(proc.pid);
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
          proc.kill("SIGTERM");
          sigkillTimer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch (killErr) { console.error("[cc-client] SIGKILL failed after abort:", killErr instanceof Error ? killErr.message : killErr); } }, 5000);
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

    if (proc.pid) trackPid(proc.pid);

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
      sigkillTimer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch (killErr) { console.error("[cc-client] SIGKILL failed after stream timeout:", killErr instanceof Error ? killErr.message : killErr); } }, 5000);
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
        } catch (streamParseErr) {
          console.warn(`[cc-client] Non-JSON line from CC stream, skipping: ${streamParseErr instanceof Error ? streamParseErr.message : String(streamParseErr)}`);
        }
      }
    });

    proc.on("close", () => {
      if (proc.pid) untrackPid(proc.pid);
      cleanup();
      // Flush remaining buffer
      if (buffer.trim()) {
        try {
          const msg = JSON.parse(buffer.trim());
          if (resolveNext) {
            resolveNext({ value: msg, done: false });
            resolveNext = null;
          }
        } catch (flushErr) {
          console.warn(`[cc-client] Incomplete JSON in stream flush, skipping: ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`);
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
        proc.kill("SIGTERM");
        sigkillTimer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch (killErr) { console.error("[cc-client] SIGKILL failed after stream abort:", killErr instanceof Error ? killErr.message : killErr); } }, 5000);
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

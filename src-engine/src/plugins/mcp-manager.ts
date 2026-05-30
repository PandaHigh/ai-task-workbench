import { spawn, type ChildProcess } from "child_process";
import type { McpServerConfig } from "./plugin-registry.js";

const SHUTDOWN_GRACE_MS = 5000;

export class McpManager {
  private processes: Map<string, ChildProcess> = new Map();

  /** Spawn an MCP server process and track it by name. */
  async startServer(name: string, config: McpServerConfig): Promise<void> {
    // If already running, stop first
    if (this.processes.has(name)) {
      await this.stopServer(name);
    }

    const mergedEnv: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (v): v is [string, string] => v[1] !== undefined,
        ),
      ),
      ...(config.env ?? {}),
    };

    const child = spawn(config.command, config.args, {
      env: mergedEnv,
      stdio: ["pipe", "pipe", "pipe"],
      detached: false,
    });

    child.on("error", (err) => {
      console.error(`[mcp-manager] Server "${name}" error: ${err.message}`);
    });

    child.on("exit", (code, signal) => {
      this.processes.delete(name);
      if (code !== 0 && code !== null) {
        console.warn(
          `[mcp-manager] Server "${name}" exited with code ${code}, signal ${signal}`,
        );
      }
    });

    // Forward stderr for debugging
    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => {
        const msg = chunk.toString().trim();
        if (msg) {
          console.warn(`[mcp:${name}] ${msg}`);
        }
      });
    }

    // Drain stdout so the pipe doesn't block
    if (child.stdout) {
      child.stdout.on("data", () => {
        // MCP protocol messages arrive on stdout.
        // For now we just drain the buffer; a future MCP client will parse these.
      });
    }

    this.processes.set(name, child);
    console.log(
      `[mcp-manager] Started "${name}": ${config.command} ${config.args.join(" ")}`,
    );
  }

  /** Gracefully stop a named server (SIGTERM -> SIGKILL). */
  async stopServer(name: string): Promise<void> {
    const child = this.processes.get(name);
    if (!child || child.exitCode !== null) {
      this.processes.delete(name);
      return;
    }

    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Process may already be gone
        }
        this.processes.delete(name);
        resolve();
      }, SHUTDOWN_GRACE_MS);

      child.on("exit", () => {
        clearTimeout(timeout);
        this.processes.delete(name);
        resolve();
      });

      try {
        child.kill("SIGTERM");
      } catch {
        clearTimeout(timeout);
        this.processes.delete(name);
        resolve();
      }
    });
  }

  /** Stop all running servers. */
  async stopAll(): Promise<void> {
    const names = [...this.processes.keys()];
    await Promise.all(names.map((n) => this.stopServer(n)));
  }

  /** Check whether a named server process is alive. */
  isRunning(name: string): boolean {
    const child = this.processes.get(name);
    return child != null && child.exitCode === null;
  }

  /** Return the names of all currently-running servers. */
  getRunningServers(): string[] {
    return [...this.processes.entries()]
      .filter(([, child]) => child.exitCode === null)
      .map(([name]) => name);
  }
}

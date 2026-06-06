import path from "path";
import { ensureDir, readJsonFile, writeJsonFile } from "../db/store-utils.js";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface PluginEntry {
  id: string;
  name: string;
  description: string;
  type: "mcp-server";
  config: McpServerConfig;
  enabled: boolean;
  status: "stopped" | "running" | "error";
  startedAt?: number;
  error?: string;
}

// ─── Registry ──────────────────────────────────────────────────────────────

export class PluginRegistry {
  private plugins: Map<string, PluginEntry> = new Map();

  private filePath: string;

  constructor(dataDir: string) {
    ensureDir(dataDir);
    this.filePath = path.join(dataDir, "plugins.json");
    this.load();
  }

  // ── CRUD ─────────────────────────────────────────────────────────────

  /** Register a new MCP server plugin. Returns the created entry. */
  register(config: McpServerConfig): PluginEntry {
    const id = `mcp-${crypto.randomUUID().slice(0, 8)}`;
    const entry: PluginEntry = {
      id,
      name: config.name,
      description: "",
      type: "mcp-server",
      config,
      enabled: false,
      status: "stopped",
    };
    this.plugins.set(id, entry);
    this.save();
    return entry;
  }

  /** Remove a plugin by id. Returns true if found and removed. */
  unregister(id: string): boolean {
    const removed = this.plugins.delete(id);
    if (removed) this.save();
    return removed;
  }

  /** List all registered plugins. */
  list(): PluginEntry[] {
    return [...this.plugins.values()];
  }

  /** Get a single plugin by id. */
  get(id: string): PluginEntry | undefined {
    return this.plugins.get(id);
  }

  /** Enable or disable a plugin. No-op if not found. */
  setEnabled(id: string, enabled: boolean): void {
    const entry = this.plugins.get(id);
    if (!entry) return;
    entry.enabled = enabled;
    this.save();
  }

  /** Update the status field (e.g. "running", "stopped", "error"). */
  setStatus(id: string, status: PluginEntry["status"], error?: string): void {
    const entry = this.plugins.get(id);
    if (!entry) return;
    entry.status = status;
    entry.error = error;
    if (status === "running") {
      entry.startedAt = Date.now();
    } else {
      entry.startedAt = undefined;
    }
    this.save();
  }

  // ── Persistence ──────────────────────────────────────────────────────

  private load(): void {
    const entries = readJsonFile<PluginEntry[]>(this.filePath, [], "plugin-registry");
    this.plugins.clear();
    for (const entry of entries) {
      this.plugins.set(entry.id, entry);
    }
  }

  private save(): void {
    const entries = [...this.plugins.values()];
    writeJsonFile(this.filePath, entries);
  }
}

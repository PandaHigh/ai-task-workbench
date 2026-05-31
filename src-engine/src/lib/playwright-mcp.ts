import fs from "fs";
import path from "path";
import os from "os";

let configPath: string | null = null;

export function resolvePlaywrightCli(): { command: string; args: string[] } | null {
  try {
    const pkgPath = require.resolve("@playwright/mcp/package.json");
    const cliPath = path.join(path.dirname(pkgPath), "cli.js");
    if (fs.existsSync(cliPath)) {
      return { command: "node", args: [cliPath, "--headless"] };
    }
  } catch { /* not installed locally */ }
  return null;
}

export function ensurePlaywrightMcpConfig(): string {
  if (configPath && fs.existsSync(configPath)) return configPath;

  const local = resolvePlaywrightCli();
  const entry = local ?? { command: "npx", args: ["@playwright/mcp@latest", "--headless"] };

  const config = {
    mcpServers: {
      playwright: entry,
    },
  };

  configPath = path.join(os.tmpdir(), "ai-workbench-playwright-mcp.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  return configPath;
}

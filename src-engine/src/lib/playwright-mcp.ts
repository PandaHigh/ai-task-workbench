import fs from "fs";
import path from "path";
import os from "os";

const MCP_CONFIG = {
  mcpServers: {
    playwright: {
      command: "npx",
      args: ["@playwright/mcp@latest", "--headless"],
    },
  },
};

let configPath: string | null = null;

export function ensurePlaywrightMcpConfig(): string {
  if (configPath && fs.existsSync(configPath)) return configPath;

  const tmpDir = os.tmpdir();
  configPath = path.join(tmpDir, "ai-workbench-playwright-mcp.json");
  fs.writeFileSync(configPath, JSON.stringify(MCP_CONFIG, null, 2), "utf-8");
  return configPath;
}

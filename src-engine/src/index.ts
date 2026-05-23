import { createRpcServer } from "./json-rpc/server.js";

async function main() {
  const server = createRpcServer();

  process.stdin.setEncoding("utf-8");

  let buffer = "";

  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.trim()) {
        server.handleLine(line);
      }
    }
  });

  process.stdin.on("end", () => {
    process.exit(0);
  });

  process.on("SIGTERM", () => process.exit(0));
  process.on("SIGINT", () => process.exit(0));
}

main().catch((err) => {
  console.error("Engine failed to start:", err);
  process.exit(1);
});

import fs from "fs";
import archiver from "archiver";
import type { ServerResponse } from "http";

const EXCLUDED = new Set([
  ".git", "node_modules", ".claude", ".DS_Store",
  "__pycache__", ".env", ".env.local", ".cache",
]);

export function streamDirectoryAsZip(
  dirPath: string,
  res: ServerResponse,
  zipFileName: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(dirPath)) {
      reject(new Error(`Directory not found: ${dirPath}`));
      return;
    }

    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipFileName}"`,
    });

    const archive = archiver("zip", { zlib: { level: 6 } });

    archive.on("error", reject);
    res.on("close", () => { archive.destroy(); resolve(); });

    archive.pipe(res);
    archive.directory(dirPath, false, (entry) =>
      EXCLUDED.has(entry.name) ? false : entry,
    );
    archive.finalize();
  });
}

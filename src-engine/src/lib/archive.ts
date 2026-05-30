import fs from "fs";
import type Archiver from "archiver";
import type { ServerResponse } from "http";

const EXCLUDED = new Set([
  ".git", "node_modules", ".claude", ".DS_Store",
  "__pycache__", ".env", ".env.local", ".cache",
]);

// archiver v8 exports { ZipArchive } at runtime but @types/archiver hasn't updated
// Use require to grab the runtime export, typed as Archiver
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ZipArchive } = require("archiver") as { ZipArchive: new (opts?: { zlib?: { level: number } }) => Archiver.Archiver };

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

    const archive = new ZipArchive({ zlib: { level: 6 } });

    archive.on("error", reject);
    res.on("close", () => { archive.destroy(); resolve(); });

    archive.pipe(res);
    archive.directory(dirPath, false, (entry: { name: string }) => {
      const hasExcluded = entry.name.split("/").some((part) => EXCLUDED.has(part));
      return hasExcluded ? false : entry;
    });
    archive.finalize();
  });
}

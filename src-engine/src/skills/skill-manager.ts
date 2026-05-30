import fs from "fs";
import path from "path";
import type { IncomingMessage, ServerResponse } from "http";
import { SkillStore, type SkillMeta } from "../db/skill-store.js";
import { errorToMessage } from "../lib/error-utils.js";

export type NotifyFn = (method: string, params: Record<string, unknown>) => void;

const BUILTIN_SKILLS_DIR = path.resolve(import.meta.dirname, "../../resources/skills/builtin");

function parseSkillFrontmatter(skillMdPath: string): { name: string; description: string } | null {
  try {
    const content = fs.readFileSync(skillMdPath, "utf-8");
    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return null;
    const fm = frontmatterMatch[1];
    const nameMatch = fm.match(/^name:\s*(.+)$/m);
    const descMatch = fm.match(/^description:\s*["']?(.+?)["']?\s*$/m);
    if (!nameMatch) return null;
    return {
      name: nameMatch[1].trim(),
      description: descMatch ? descMatch[1].trim() : "",
    };
  } catch (err) { console.warn("[skill] Parse SKILL.md failed:", errorToMessage(err));
    return null;
  }
}

function countFiles(dir: string): number {
  let count = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      count += countFiles(path.join(dir, entry.name));
    } else {
      count++;
    }
  }
  return count;
}

export class SkillManager {
  private skillStore: SkillStore;
  private notify: NotifyFn;

  constructor(skillStore: SkillStore, notify: NotifyFn) {
    this.skillStore = skillStore;
    this.notify = notify;
  }

  /** Scan and register all builtin skills from resources/skills/builtin/ */
  initBuiltinSkills(): void {
    if (!fs.existsSync(BUILTIN_SKILLS_DIR)) {
      console.warn("[skill-manager] Builtin skills directory not found:", BUILTIN_SKILLS_DIR);
      return;
    }

    const existing = this.skillStore.list({ type: "builtin" });
    const existingNames = new Set(existing.map((s) => s.dirName));

    const entries = fs.readdirSync(BUILTIN_SKILLS_DIR, { withFileTypes: true });
    let added = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = path.join(BUILTIN_SKILLS_DIR, entry.name, "SKILL.md");
      if (!fs.existsSync(skillMdPath)) continue;

      const meta = parseSkillFrontmatter(skillMdPath);
      if (!meta) {
        console.warn(`[skill-manager] Skipping builtin skill without valid frontmatter: ${entry.name}`);
        continue;
      }

      this.skillStore.add({
        name: meta.name,
        description: meta.description,
        type: "builtin",
        dirName: entry.name,
        createdAt: new Date().toISOString(),
        fileCount: countFiles(path.join(BUILTIN_SKILLS_DIR, entry.name)),
      });
      added++;
    }

    if (added > 0 || existingNames.size === 0) {
      console.log(`[skill-manager] Registered ${added} builtin skills`);
    }
  }

  /** Copy all skills (builtin + custom) into <workingDir>/.claude/skills/ */
  prepareWorkingDir(workingDir: string): void {
    const targetDir = path.join(workingDir, ".claude", "skills");
    fs.mkdirSync(targetDir, { recursive: true });

    // Copy builtin skills
    if (fs.existsSync(BUILTIN_SKILLS_DIR)) {
      const entries = fs.readdirSync(BUILTIN_SKILLS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const src = path.join(BUILTIN_SKILLS_DIR, entry.name);
        const dest = path.join(targetDir, entry.name);
        copyDirSync(src, dest);
      }
    }

    // Copy custom skills
    const customDir = this.skillStore.getCustomSkillsDir();
    if (fs.existsSync(customDir)) {
      const entries = fs.readdirSync(customDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const src = path.join(customDir, entry.name);
        const dest = path.join(targetDir, entry.name);
        copyDirSync(src, dest);
      }
    }
  }

  /** Handle HTTP multipart upload of a .zip file */
  async handleUpload(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("multipart/form-data")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Content-Type must be multipart/form-data" }));
      return;
    }

    const boundary = contentType.split("boundary=")[1];
    if (!boundary) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing boundary in Content-Type" }));
      return;
    }

    try {
      const { fileData, fileName } = await parseMultipart(req, boundary);

      if (!fileData) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No file found in upload" }));
        return;
      }

      // Validate it's a zip
      if (!fileName.endsWith(".zip")) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Only .zip files are accepted" }));
        return;
      }

      // Extract zip (cross-platform: PowerShell on Windows, unzip on Unix)
      const skillName = fileName.replace(/\.zip$/i, "").replace(/[^a-zA-Z0-9_-]/g, "_");
      const customDir = this.skillStore.getCustomSkillsDir();
      const extractDir = path.join(customDir, skillName);

      if (fs.existsSync(extractDir)) {
        fs.rmSync(extractDir, { recursive: true });
      }
      fs.mkdirSync(extractDir, { recursive: true });

      const tmpZip = path.join(customDir, `${skillName}.tmp.zip`);
      fs.writeFileSync(tmpZip, fileData);

      try {
        const { execSync } = await import("child_process");
        if (process.platform === "win32") {
          execSync(`powershell -Command "Expand-Archive -Path '${tmpZip}' -DestinationPath '${extractDir}' -Force"`, { stdio: "pipe" });
        } else {
          execSync(`unzip -o "${tmpZip}" -d "${extractDir}"`, { stdio: "pipe" });
        }
      } finally {
        fs.unlinkSync(tmpZip);
      }

      // Find SKILL.md — could be at root or one level deep
      let skillMdPath = path.join(extractDir, "SKILL.md");
      let actualDir = extractDir;

      if (!fs.existsSync(skillMdPath)) {
        // Check one level deep
        const entries = fs.readdirSync(extractDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const candidate = path.join(extractDir, entry.name, "SKILL.md");
            if (fs.existsSync(candidate)) {
              skillMdPath = candidate;
              actualDir = path.join(extractDir, entry.name);
              break;
            }
          }
        }
      }

      if (!fs.existsSync(skillMdPath)) {
        // Cleanup
        fs.rmSync(extractDir, { recursive: true });
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Zip must contain a SKILL.md file (at root or in one subdirectory)" }));
        return;
      }

      // If SKILL.md was nested, move contents up
      if (actualDir !== extractDir) {
        const tmpDir = extractDir + "__tmp";
        fs.renameSync(actualDir, tmpDir);
        fs.rmSync(extractDir, { recursive: true });
        fs.renameSync(tmpDir, extractDir);
        skillMdPath = path.join(extractDir, "SKILL.md");
      }

      const meta = parseSkillFrontmatter(skillMdPath);
      if (!meta) {
        fs.rmSync(extractDir, { recursive: true });
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "SKILL.md must have YAML frontmatter with 'name' field" }));
        return;
      }

      const skillMeta: SkillMeta = {
        name: meta.name,
        description: meta.description,
        type: "custom",
        dirName: skillName,
        createdAt: new Date().toISOString(),
        fileCount: countFiles(extractDir),
      };

      this.skillStore.add(skillMeta);
      this.notify("skill.added", { skill: skillMeta });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(skillMeta));
    } catch (err) {
      console.error("[skill-manager] Upload failed:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Upload failed" }));
    }
  }
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/** Minimal multipart parser — extracts first file from form-data */
async function parseMultipart(req: IncomingMessage, boundary: string): Promise<{ fileData: Buffer | null; fileName: string }> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const body = Buffer.concat(chunks);

  const boundaryBytes = Buffer.from(`--${boundary}`);
  const parts: Buffer[] = [];

  let start = 0;
  while (start < body.length) {
    const idx = body.indexOf(boundaryBytes, start);
    if (idx === -1) break;
    if (start > 0) {
      parts.push(body.slice(start, idx - 2)); // -2 for \r\n before boundary
    }
    start = idx + boundaryBytes.length + 2; // +2 for \r\n after boundary
  }

  for (const part of parts) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;
    const header = part.slice(0, headerEnd).toString("utf-8");
    const filenameMatch = header.match(/filename="([^"]+)"/);
    if (!filenameMatch) continue;

    const fileData = part.slice(headerEnd + 4);
    return { fileData, fileName: filenameMatch[1] };
  }

  return { fileData: null, fileName: "" };
}

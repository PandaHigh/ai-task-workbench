import fs from "fs";
import path from "path";
import os from "os";

export interface SkillMeta {
  name: string;
  description: string;
  type: "builtin" | "custom";
  dirName: string;
  createdAt: string;
  fileCount: number;
}

function getDataDir(): string {
  const platform = os.platform();
  let baseDir: string;
  switch (platform) {
    case "darwin":
      baseDir = path.join(os.homedir(), "Library", "Application Support");
      break;
    case "linux":
      baseDir = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
      break;
    case "win32":
      baseDir = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
      break;
    default:
      baseDir = os.homedir();
  }
  return path.join(baseDir, "ai-task-workbench");
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
    }
  } catch (err) {
    console.error(`[skill-store] Failed to read ${filePath}: ${err instanceof Error ? err.message : err}`);
  }
  return fallback;
}

function writeJsonFile(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const content = JSON.stringify(data, null, 2);
  const tmpPath = filePath + ".tmp";
  const fd = fs.openSync(tmpPath, "w");
  try {
    fs.writeFileSync(fd, content, "utf-8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (process.platform === "win32" && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  fs.renameSync(tmpPath, filePath);
}

export class SkillStore {
  private dataDir: string;
  private skillsFile: string;
  private customSkillsDir: string;

  constructor(customDataDir?: string) {
    this.dataDir = customDataDir || getDataDir();
    this.skillsFile = path.join(this.dataDir, "skills.json");
    this.customSkillsDir = path.join(this.dataDir, "skills", "custom");
    fs.mkdirSync(this.customSkillsDir, { recursive: true });
  }

  list(filter?: { type?: "builtin" | "custom" }): SkillMeta[] {
    const skills = readJsonFile<SkillMeta[]>(this.skillsFile, []);
    if (!filter) return skills;
    return skills.filter((s) => !filter.type || s.type === filter.type);
  }

  findByName(name: string): SkillMeta | undefined {
    return this.list().find((s) => s.name === name);
  }

  add(meta: SkillMeta): void {
    const skills = this.list();
    const idx = skills.findIndex((s) => s.name === meta.name);
    if (idx >= 0) {
      skills[idx] = meta;
    } else {
      skills.push(meta);
    }
    writeJsonFile(this.skillsFile, skills);
  }

  remove(name: string): boolean {
    const skills = this.list();
    const idx = skills.findIndex((s) => s.name === name);
    if (idx === -1) return false;
    const skill = skills[idx];
    if (skill.type === "builtin") return false;
    // Remove files
    const skillDir = path.join(this.customSkillsDir, skill.dirName);
    if (fs.existsSync(skillDir)) {
      fs.rmSync(skillDir, { recursive: true });
    }
    skills.splice(idx, 1);
    writeJsonFile(this.skillsFile, skills);
    return true;
  }

  getCustomSkillsDir(): string {
    return this.customSkillsDir;
  }
}

import fs from "fs";
import path from "path";
import { getDataDir, readJsonFile, writeJsonFile } from "./store-utils.js";

export interface SkillMeta {
  name: string;
  description: string;
  type: "builtin" | "custom";
  dirName: string;
  createdAt: string;
  fileCount: number;
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

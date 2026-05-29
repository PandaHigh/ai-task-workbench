import fs from "fs";
import path from "path";
import type { TaskContext } from "@ai-workbench/shared";

export function generateClaudeMd(workingDir: string, context: TaskContext): void {
  const goals = context.goals.map((g, i) => `${i + 1}. ${g}`).join("\n");
  const terms = context.terminationConditions.map((c, i) => `${i + 1}. ${c}`).join("\n");

  const recentCommits = context.lastTenCommits.length > 0
    ? context.lastTenCommits.map((c) => `- ${c.hash.substring(0, 7)} ${c.message}`).join("\n")
    : "(无)";

  const lessons = context.lessonsLearned.length > 0
    ? context.lessonsLearned.slice(-5).map((l) => `- [${l.category}] ${l.lesson}`).join("\n")
    : "(无)";

  const content = `# 任务指导

## 目标
${goals}

## 终止条件
${terms}

## Git 提交规范
- 格式: \`[taskId前6位] 任务摘要 #AI commit#\`
- 质量评分低于阈值会自动 revert

## 最近提交
${recentCommits}

## 历史教训
${lessons}

## 注意事项
- 每次只做当前任务要求的工作，不要擅自扩展范围
- 确保代码可编译、测试可运行后再提交
- 如果发现目标已经达成，不要做多余的修改
`;

  const filePath = path.join(workingDir, "CLAUDE.md");
  fs.writeFileSync(filePath, content, "utf-8");
}

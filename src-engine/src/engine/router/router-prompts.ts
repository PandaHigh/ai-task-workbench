/**
 * Task Router — 路由评估提示词
 *
 * 引导 AI 分析任务特征，评估各维度复杂度，输出结构化的路由决策。
 */

export function buildRouterPrompt(taskContent: string, context: {
  workingDir: string;
  completedTaskCount: number;
  costUsedUsd: number;
  costBudgetUsd: number;
  hasGoals: boolean;
}): string {
  return `你是一个任务复杂度评估器。分析以下任务，评估其复杂度并推荐执行策略。

## 任务内容
${taskContent}

## 当前运行上下文
- 工作目录: ${context.workingDir}
- 已完成任务数: ${context.completedTaskCount}
- 已使用预算: $${context.costUsedUsd.toFixed(2)}
- 预算上限: $${context.costBudgetUsd === Infinity ? "无限制" : `$${context.costBudgetUsd.toFixed(2)}`}
- 是否有明确目标: ${context.hasGoals ? "是" : "否"}

## 评估维度（每项 0-1 分）

1. **scope（影响范围）**: 涉及多少文件/模块？单文件=0，全代码库=1
2. **uncertainty（不确定性）**: 需求是否明确？完全明确=0，需大量探索=1
3. **risk（风险等级）**: 错误代价多高？低风险=0，生产关键=1
4. **parallelism（并行机会）**: 能否拆分为独立子任务？强依赖=0，完全独立=1
5. **verificationNeed（验证需求）**: 是否需要多角度交叉验证？简单验证=0，需对抗性审查=1

## 可用执行策略

| 策略 | 触发条件 | 说明 |
|------|---------|------|
| direct | 简单任务（scope<0.3, 大部分维度<0.4） | MasterAgent 直接调用工具完成 |
| builtin:omx-pipeline | 中等任务（scope 0.3-0.6, 单任务多步骤） | 标准 5 阶段流程：访谈→规划→执行→审查→QA |
| builtin:security-audit | 安全相关（含"安全/审计/漏洞"关键词） | 并行安全扫描 + 对抗性验证 |
| builtin:code-review | 审查相关（含"审查/review/PR"关键词） | 多 reviewer 并行 + Judge Panel |
| builtin:bug-sweep | Bug 发现（含"bug/缺陷/巡检"关键词） | 持续发现循环 + 对抗性验证 |
| builtin:migration | 迁移相关（含"迁移/重构/rewrite"关键词） | 按模块并行 + 验证 + 失败循环 |
| builtin:dead-code | 代码清理（含"死代码/unused/清理"关键词） | 并行分析 + 对抗性验证 |
| dynamic | 大规模/特殊（scope>0.7, 多维度>0.6） | AI 动态生成 workflow 脚本编排 |

## 输出格式

严格输出以下 JSON（不要包含其他文字）：

\`\`\`json
{
  "level": "simple" | "moderate" | "complex" | "massive",
  "strategy": { "type": "direct" } | { "type": "builtin", "templateName": "omx-pipeline" } | { "type": "dynamic" },
  "confidence": 0.0-1.0,
  "reason": "简短的路由理由",
  "dimensions": {
    "scope": 0.0-1.0,
    "uncertainty": 0.0-1.0,
    "risk": 0.0-1.0,
    "parallelism": 0.0-1.0,
    "verificationNeed": 0.0-1.0
  },
  "estimatedAgents": 1-100,
  "estimatedCostUsd": 0.0-50.0
}
\`\`\``;
}

/** 构建快速路由的简化提示（用于 keyword 预匹配后的确认） */
export function buildQuickRoutePrompt(taskContent: string, suggestedTemplate: string): string {
  return `确认以下任务是否适合使用 "${suggestedTemplate}" 模板执行？

任务: ${taskContent}

只需回答 JSON:
{
  "confirmed": true/false,
  "reason": "理由",
  "alternativeTemplate": null | "其他模板名"
}`;
}

/** 内置模板的关键词匹配规则 */
export const TEMPLATE_KEYWORDS: Record<string, {
  keywords: string[];
  priority: number;  // 优先级，数字越大优先级越高
}> = {
  "security-audit": {
    keywords: ["安全审计", "安全审查", "安全扫描", "漏洞扫描", "security audit", "vulnerability", "auth check", "权限检查", "认证检查"],
    priority: 3,
  },
  "code-review": {
    keywords: ["代码审查", "code review", "PR审查", "审查代码", "review code", "质量审查"],
    priority: 2,
  },
  "bug-sweep": {
    keywords: ["bug巡检", "缺陷扫描", "bug sweep", "find bugs", "查找缺陷", "发现bug", "bug hunt", "查找所有 bug", "查找bug", "bug和缺陷"],
    priority: 2,
  },
  "migration": {
    keywords: ["迁移", "migration", "重构", "refactor", "rewrite", "重写", "port", "代码迁移"],
    priority: 2,
  },
  "dead-code": {
    keywords: ["死代码", "dead code", "unused code", "无用代码", "代码清理", "清理代码"],
    priority: 2,
  },
};

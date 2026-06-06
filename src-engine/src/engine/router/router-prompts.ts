/**
 * Task Router — 路由评估提示词
 *
 * 引导 AI 分析任务特征，评估复杂度，决定走 direct 还是 pipeline。
 */

export function buildRouterPrompt(
  taskContent: string,
  context: {
    workingDir: string;
    completedTaskCount: number;
    costUsedUsd: number;
    costBudgetUsd: number;
    hasGoals: boolean;
  },
): string {
  return `你是一个任务复杂度评估器。分析以下任务，评估其复杂度并推荐执行策略。

## 任务内容
${taskContent}

## 当前运行上下文
- 工作目录: ${context.workingDir}
- 已完成任务数: ${context.completedTaskCount}
- 已使用预算: $${context.costUsedUsd.toFixed(2)}
- 预算上限: ${context.costBudgetUsd === Infinity ? "无限制" : `$${context.costBudgetUsd.toFixed(2)}`}
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
| direct | 简单任务（scope<0.3, 大部分维度<0.4） | 单次 CC 调用直接完成 |
| pipeline | 中等及以上任务（scope>=0.3 或任一维度>0.5） | OMX 5阶段流水线：访谈→规划→执行→审查→QA |

## 输出格式

严格输出以下 JSON（不要包含其他文字）：

\`\`\`json
{
  "level": "simple" | "moderate" | "complex" | "massive",
  "strategy": { "type": "direct" } | { "type": "pipeline" },
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

/** 内置关键词快速匹配规则（用于将复杂关键词任务直接路由到 pipeline） */
export const PIPELINE_KEYWORDS: string[] = [
  "安全审计",
  "安全审查",
  "漏洞扫描",
  "security audit",
  "vulnerability",
  "代码审查",
  "code review",
  "PR审查",
  "审查代码",
  "review code",
  "bug巡检",
  "缺陷扫描",
  "bug sweep",
  "find bugs",
  "查找缺陷",
  "迁移",
  "migration",
  "重构",
  "refactor",
  "rewrite",
  "重写",
  "死代码",
  "dead code",
  "unused code",
  "代码清理",
];

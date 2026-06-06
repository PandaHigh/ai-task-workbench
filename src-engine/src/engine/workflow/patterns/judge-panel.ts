/**
 * Judge Panel — 多视角评审模式
 *
 * 从不同角度独立生成/评估 N 个方案，评分后综合最佳方案。
 * 可配置评分维度（正确性、安全性、性能、可维护性）。
 */

import { CCClient } from "../../../cc-integration/cc-client.js";
import { AgentExecutor } from "../../agents/agent-executor.js";
import { getOmxRole, omxRoleToLegacy } from "../../omx-roles.js";

export interface PanelOption {
  id: string;
  title: string;
  content: string;
  proposedBy?: string;
}

export interface Score {
  overall: number;
  dimensions: Record<string, number>;
  reasoning: string;
}

export interface JudgedOption extends PanelOption {
  score: Score;
  rank: number;
}

export interface PanelVerdict {
  winner: JudgedOption;
  allOptions: JudgedOption[];
  consensusScore: number;
}

export interface JudgePanelOptions {
  /** 评审人数 */
  judgeCount?: number;
  /** 评审角色（默认 architect） */
  judgeRole?: string;
  /** 评分维度 */
  dimensions?: string[];
  /** 工作目录 */
  workingDir: string;
}

/**
 * Judge Panel — 多法官评分，综合最佳方案
 */
export class JudgePanel {
  private ccClient: CCClient;

  constructor(ccClient: CCClient) {
    this.ccClient = ccClient;
  }

  /**
   * 对多个方案进行独立评审并打分，返回综合排名。
   */
  async evaluate(
    options: PanelOption[],
    opts: JudgePanelOptions,
  ): Promise<PanelVerdict> {
    const judgeCount = opts.judgeCount ?? 3;
    const roleName = opts.judgeRole ?? "architect";
    const dimensions = opts.dimensions ?? ["correctness", "completeness", "quality", "maintainability"];

    const omxRole = getOmxRole(roleName);
    if (!omxRole) throw new Error(`Role not found: ${roleName}`);
    const role = omxRoleToLegacy(omxRole);

    // 每个 judge 对每个 option 打分
    const judgedOptions: JudgedOption[] = [];

    for (const option of options) {
      const scores: Score[] = [];

      const judgePromises = Array.from({ length: judgeCount }, (_, i) =>
        this.runJudge(`judge-${i + 1}`, role, option, dimensions, opts.workingDir)
      );
      const judgeResults = await Promise.all(judgePromises);
      scores.push(...judgeResults);

      // 聚合分数：取各维度平均值
      const aggregatedDimensions: Record<string, number> = {};
      for (const dim of dimensions) {
        const dimScores = scores.map((s) => s.dimensions[dim] ?? 0).filter((s) => s > 0);
        aggregatedDimensions[dim] = dimScores.length > 0
          ? dimScores.reduce((a, b) => a + b, 0) / dimScores.length
          : 0;
      }
      const overall = Object.values(aggregatedDimensions).reduce((a, b) => a + b, 0) / dimensions.length;

      judgedOptions.push({
        ...option,
        score: {
          overall,
          dimensions: aggregatedDimensions,
          reasoning: scores.map((s) => s.reasoning).join("\n---\n"),
        },
        rank: 0, // assigned below
      });
    }

    // 排名
    judgedOptions.sort((a, b) => b.score.overall - a.score.overall);
    judgedOptions.forEach((opt, i) => { opt.rank = i + 1; });

    const consensusScore = judgedOptions.length > 0
      ? judgedOptions.reduce((sum, o) => sum + o.score.overall, 0) / judgedOptions.length
      : 0;

    return {
      winner: judgedOptions[0],
      allOptions: judgedOptions,
      consensusScore,
    };
  }

  private async runJudge(
    judgeId: string,
    role: ReturnType<typeof omxRoleToLegacy>,
    option: PanelOption,
    dimensions: string[],
    workingDir: string,
  ): Promise<Score> {
    const prompt = `你是评审专家 ${judgeId}。请从以下维度对方案进行独立评分。

## 方案: ${option.title}

${option.content}

## 评分维度
${dimensions.map((d) => `- ${d}: 0.0-1.0`).join("\n")}

## 输出格式
第一行: 总体分数 (0.0-1.0)
后续每行: 维度名: 分数
最后: 评审理由（一段文字）`;

    try {
      const executor = new AgentExecutor(this.ccClient, () => {});
      const result = await executor.execute(role, prompt, workingDir);
      const output = result.output ?? "";

      // 解析分数
      const overallMatch = output.match(/(\d+\.?\d*)/);
      const overall = overallMatch ? parseFloat(overallMatch[1]) : 0.5;

      const dimScores: Record<string, number> = {};
      for (const dim of dimensions) {
        const dimMatch = output.match(new RegExp(`${dim}[:\\s]*(\\d+\\.?\\d*)`, "i"));
        dimScores[dim] = dimMatch ? parseFloat(dimMatch[1]) : overall;
      }

      return {
        overall: Math.max(0, Math.min(1, overall)),
        dimensions: dimScores,
        reasoning: output.substring(0, 500),
      };
    } catch (err) {
      return {
        overall: 0.3,
        dimensions: Object.fromEntries(dimensions.map((d) => [d, 0.3])),
        reasoning: `Judge error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}

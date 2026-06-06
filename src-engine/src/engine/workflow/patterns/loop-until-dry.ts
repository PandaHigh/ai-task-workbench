/**
 * Loop Until Dry — 收敛迭代模式
 *
 * 持续发现新问题/机会，直到连续 K 轮无新发现。
 * 与已有发现去重，输出所有发现 + 每轮统计。
 *
 * 借鉴 Claude Code 的 loop-until-dry 模式。
 */

import { CCClient } from "../../../cc-integration/cc-client.js";
import { AgentExecutor } from "../../agents/agent-executor.js";
import { getOmxRole, omxRoleToLegacy } from "../../omx-roles.js";

export interface Discovery {
  id: string;
  title: string;
  description: string;
  category: string;
  location?: string;
  confidence: number;
}

export interface RoundResult {
  round: number;
  discoveries: Discovery[];
  newCount: number;
  duplicateCount: number;
  durationMs: number;
  costUsd: number;
}

export interface DiscoveryResult {
  allDiscoveries: Discovery[];
  rounds: RoundResult[];
  totalRounds: number;
  totalNewDiscoveries: number;
  totalDurationMs: number;
  totalCostUsd: number;
  converged: boolean;
}

export interface LoopUntilDryOptions {
  /** 搜索发现的角色 */
  finderRole?: string;
  /** 搜索提示词 */
  finderPrompt: string;
  /** 最大轮次 */
  maxRounds?: number;
  /** 连续多少轮无新发现则停止 */
  dryThreshold?: number;
  /** 工作目录 */
  workingDir: string;
  /** 任务上下文（帮助 finder 理解任务） */
  taskContext?: string;
}

/**
 * Loop Until Dry — 持续发现直到收敛
 */
export class LoopUntilDry {
  private ccClient: CCClient;

  constructor(ccClient: CCClient) {
    this.ccClient = ccClient;
  }

  /**
   * 执行发现循环，直到无新发现。
   */
  async execute(options: LoopUntilDryOptions): Promise<DiscoveryResult> {
    const maxRounds = options.maxRounds ?? 10;
    const dryThreshold = options.dryThreshold ?? 2;
    const roleName = options.finderRole ?? "explore";

    const omxRole = getOmxRole(roleName);
    if (!omxRole) throw new Error(`Role not found: ${roleName}`);
    const role = omxRoleToLegacy(omxRole);

    const allDiscoveries: Discovery[] = [];
    const rounds: RoundResult[] = [];
    const seenKeys = new Set<string>();
    let dryCount = 0;
    let totalCost = 0;
    const overallStart = Date.now();

    for (let round = 1; round <= maxRounds; round++) {
      const roundStart = Date.now();

      // 构建提示词，包含已有发现以帮助去重
      const existingContext =
        allDiscoveries.length > 0
          ? `\n\n## 已有发现（请勿重复这些）\n${allDiscoveries.map((d) => `- ${d.title}: ${d.description.substring(0, 100)}`).join("\n")}`
          : "";

      const prompt = `${options.finderPrompt}${existingContext}${options.taskContext ? `\n\n## 任务上下文\n${options.taskContext}` : ""}

## 输出格式

每行一个发现，格式：
[发现ID] | [类别] | [置信度 0-1] | [标题] | [描述]
例如：
BUG-001 | security | 0.9 | SQL注入风险 | 用户输入未参数化`;

      const executor = new AgentExecutor(this.ccClient, () => {});
      const result = await executor.execute(role, prompt, options.workingDir);
      const output = result.output ?? "";
      const roundCost = result.totalCostUsd;
      totalCost += roundCost;

      // 解析发现
      const rawDiscoveries = this.parseDiscoveries(output);
      const newDiscoveries: Discovery[] = [];

      for (const d of rawDiscoveries) {
        const key = this.discoveryKey(d);
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          newDiscoveries.push(d);
          allDiscoveries.push(d);
        }
      }

      const roundResult: RoundResult = {
        round,
        discoveries: newDiscoveries,
        newCount: newDiscoveries.length,
        duplicateCount: rawDiscoveries.length - newDiscoveries.length,
        durationMs: Date.now() - roundStart,
        costUsd: roundCost,
      };
      rounds.push(roundResult);

      // 收敛检测
      if (newDiscoveries.length === 0) {
        dryCount++;
        if (dryCount >= dryThreshold) {
          break;
        }
      } else {
        dryCount = 0;
      }
    }

    return {
      allDiscoveries,
      rounds,
      totalRounds: rounds.length,
      totalNewDiscoveries: allDiscoveries.length,
      totalDurationMs: Date.now() - overallStart,
      totalCostUsd: totalCost,
      converged: dryCount >= dryThreshold,
    };
  }

  private parseDiscoveries(output: string): Discovery[] {
    const discoveries: Discovery[] = [];
    const lines = output.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      // Match format: [ID] | [category] | [confidence] | [title] | [description]
      const match = trimmed.match(/^\[([^\]]+)\]\s*\|\s*(\w+)\s*\|\s*(\d+\.?\d*)\s*\|\s*(.+?)\s*\|\s*(.+)$/);
      if (match) {
        discoveries.push({
          id: match[1].trim(),
          title: match[4].trim(),
          description: match[5].trim(),
          category: match[2].trim(),
          confidence: parseFloat(match[3]),
        });
      }
      // Also match simpler bullet format: - title: description
      else if (/^[-*]\s+/.test(trimmed) && trimmed.length > 10) {
        const bulletContent = trimmed.replace(/^[-*]\s+/, "");
        const colonIdx = bulletContent.indexOf(":");
        if (colonIdx > 0 && colonIdx < 80) {
          discoveries.push({
            id: `disc-${discoveries.length + 1}`,
            title: bulletContent.substring(0, colonIdx).trim(),
            description: bulletContent.substring(colonIdx + 1).trim(),
            category: "general",
            confidence: 0.7,
          });
        }
      }
    }

    return discoveries;
  }

  private discoveryKey(d: Discovery): string {
    // Normalize title for deduplication
    return d.title
      .toLowerCase()
      .replace(/[^a-z0-9一-鿿]/g, "")
      .substring(0, 50);
  }
}

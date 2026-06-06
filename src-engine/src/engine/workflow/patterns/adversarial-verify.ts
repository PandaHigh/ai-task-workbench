/**
 * Adversarial Verify — 对抗性验证模式
 *
 * N 个独立 skeptic 各自尝试反驳一个发现，≥majority 无法反驳才算通过。
 * 只有通过验证的 finding 才进入最终结果。
 *
 * 借鉴 Claude Code Dynamic Workflow 的核心差异化能力。
 */

import { CCClient } from "../../../cc-integration/cc-client.js";
import { AgentExecutor } from "../../agents/agent-executor.js";
import { getOmxRole, omxRoleToLegacy } from "../../omx-roles.js";

export interface Finding {
  id: string;
  title: string;
  description: string;
  severity: "critical" | "major" | "minor" | "info";
  file?: string;
  line?: number;
  evidence?: string;
}

export interface VoteResult {
  voterId: string;
  passed: boolean;
  reason: string;
  confidence: number;
}

export interface VerificationResult {
  finding: Finding;
  votes: VoteResult[];
  passCount: number;
  failCount: number;
  passRate: number;
  survived: boolean;
}

export interface AdversarialVerifyOptions {
  /** 投票人数（建议奇数） */
  voterCount?: number;
  /** 通过阈值（如 0.6 = 60% voter 无法反驳即通过） */
  passThreshold?: number;
  /** 自定义 voter 角色（默认 momus） */
  voterRole?: string;
  /** 自定义 voter 提示词前缀 */
  customPrompt?: string;
  /** 工作目录 */
  workingDir: string;
}

/**
 * 对抗性验证器 — 让 N 个独立 critic 尝试反驳发现
 */
export class AdversarialVerifier {
  private ccClient: CCClient;

  constructor(ccClient: CCClient) {
    this.ccClient = ccClient;
  }

  /**
   * 验证一批发现。返回每个发现的验证结果。
   */
  async verifyAll(
    findings: Finding[],
    options: AdversarialVerifyOptions,
  ): Promise<VerificationResult[]> {
    const results: VerificationResult[] = [];

    for (const finding of findings) {
      const result = await this.verifyOne(finding, options);
      results.push(result);
    }

    return results;
  }

  /**
   * 验证单个发现。
   */
  async verifyOne(
    finding: Finding,
    options: AdversarialVerifyOptions,
  ): Promise<VerificationResult> {
    const voterCount = options.voterCount ?? 3;
    const passThreshold = options.passThreshold ?? 0.6;
    const roleName = options.voterRole ?? "momus";

    const omxRole = getOmxRole(roleName);
    if (!omxRole) {
      return {
        finding,
        votes: [],
        passCount: 0,
        failCount: voterCount,
        passRate: 0,
        survived: false,
      };
    }
    const role = omxRoleToLegacy(omxRole);

    const basePrompt = options.customPrompt ?? "你是一个严格的代码审查专家。你的任务是尝试反驳以下发现。";
    const voterPrompt = `${basePrompt}

## 待验证的发现

**标题**: ${finding.title}
**严重程度**: ${finding.severity}
**描述**: ${finding.description}
${finding.file ? `**文件**: ${finding.file}${finding.line ? `:${finding.line}` : ""}` : ""}
${finding.evidence ? `**证据**: ${finding.evidence}` : ""}

## 验证要求

1. 仔细检查这个发现是否真实存在
2. 检查严重程度是否被准确评估
3. 检查证据是否充分支持结论
4. 如果你认为这个发现是**错误的、夸大的或证据不足的**，回复 REJECTED 并说明理由
5. 如果你**无法找到有效的反驳理由**，回复 PASSED 并简要说明你认为该发现可靠的原因

回复格式：
- 第一行: PASSED 或 REJECTED
- 第二行: 置信度 0.0-1.0
- 后续: 详细理由`;

    // 并行启动所有 voter
    const votePromises = Array.from({ length: voterCount }, (_, i) =>
      this.runVoter(`voter-${i + 1}`, role, voterPrompt, options.workingDir)
    );

    const votes = await Promise.all(votePromises);

    const passCount = votes.filter((v) => v.passed).length;
    const failCount = votes.length - passCount;
    const passRate = votes.length > 0 ? passCount / votes.length : 0;

    return {
      finding,
      votes,
      passCount,
      failCount,
      passRate,
      survived: passRate >= passThreshold,
    };
  }

  private async runVoter(
    voterId: string,
    role: ReturnType<typeof omxRoleToLegacy>,
    prompt: string,
    workingDir: string,
  ): Promise<VoteResult> {
    try {
      const executor = new AgentExecutor(this.ccClient, () => {});
      const result = await executor.execute(role, prompt, workingDir);
      const output = result.output ?? "";

      const isPassed = output.toUpperCase().includes("PASSED")
        && !output.toUpperCase().includes("REJECTED");

      // 提取置信度
      let confidence = 0.5;
      const confMatch = output.match(/(?:置信度|confidence)[:\s]*(\d+\.?\d*)/i);
      if (confMatch) confidence = parseFloat(confMatch[1]);

      return {
        voterId,
        passed: isPassed,
        reason: output.substring(0, 500),
        confidence: Math.max(0, Math.min(1, confidence)),
      };
    } catch (err) {
      return {
        voterId,
        passed: false,
        reason: `Voter error: ${err instanceof Error ? err.message : String(err)}`,
        confidence: 0,
      };
    }
  }

  /**
   * 过滤：只保留通过验证的发现
   */
  filterSurvived(results: VerificationResult[]): Finding[] {
    return results.filter((r) => r.survived).map((r) => r.finding);
  }
}

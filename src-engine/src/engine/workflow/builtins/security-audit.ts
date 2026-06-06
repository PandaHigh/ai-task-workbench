/**
 * Security Audit — 内置安全审计工作流
 *
 * 并行安全扫描 + 对抗性验证 + 报告汇总
 */

import { WorkflowBuilder, agentStage, parallelStages, adversarialStage } from "../workflow-builder.js";
import type { WorkflowDefinition } from "../workflow-types.js";

export function createSecurityAuditWorkflow(): WorkflowDefinition {
  return WorkflowBuilder.create("security-audit", "安全审计")
    .description("全代码库安全扫描：并行多维度审查 + 对抗性验证 + 汇总报告")
    .builtIn()
    .tags(["security", "audit", "adversarial"])
    .useCase("对代码库做全面安全审计、漏洞扫描、权限检查")
    .stage(
      parallelStages(
        "并行安全扫描",
        [
          agentStage({
            type: "agent",
            name: "认证与授权审查",
            role: "security-reviewer",
            prompt:
              "审查所有认证和授权相关的代码，查找：\n1. 未保护的 API 端点\n2. 弱密码策略\n3. Session 管理问题\n4. 权限绕过风险\n\n列出所有发现的问题，每个包含：严重程度、文件位置、描述、修复建议",
          }),
          agentStage({
            type: "agent",
            name: "输入验证审查",
            role: "security-reviewer",
            prompt:
              "审查所有用户输入处理代码，查找：\n1. SQL 注入风险\n2. XSS 漏洞\n3. CSRF 问题\n4. 命令注入\n5. 路径遍历\n\n列出所有发现的问题，每个包含：严重程度、文件位置、描述、修复建议",
          }),
          agentStage({
            type: "agent",
            name: "数据安全审查",
            role: "security-reviewer",
            prompt:
              "审查数据处理和存储，查找：\n1. 敏感数据泄露\n2. 加密不当\n3. 不安全的默认配置\n4. 日志中的敏感信息\n\n列出所有发现的问题，每个包含：严重程度、文件位置、描述、修复建议",
          }),
        ],
        { maxConcurrency: 3 },
      ),
    )
    .stage(
      adversarialStage(
        "对抗性验证",
        3,
        "你是安全专家。尝试反驳以下安全发现 — 检查每个发现是否真实、严重程度是否准确、证据是否充分。",
        { passThreshold: 0.6 },
      ),
    )
    .stage(
      agentStage({
        type: "agent",
        name: "汇总报告",
        role: "architect",
        prompt:
          "根据经过对抗性验证的安全审计结果，生成一份完整的安全审计报告。\n\n报告应包含：\n1. 执行摘要\n2. 通过验证的发现列表（按严重程度排序）\n3. 每个发现的详细描述、影响范围和修复建议\n4. 总体安全评分\n5. 优先修复建议",
      }),
    )
    .build();
}

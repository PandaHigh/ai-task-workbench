/**
 * 内置 Workflow 模板库
 *
 * 所有内置模板在引擎启动时注册到 WorkflowStore。
 */

import type { WorkflowDefinition } from "../workflow-types.js";
import { createOmxPipelineWorkflow } from "./omx-pipeline.js";
import { createSecurityAuditWorkflow } from "./security-audit.js";
import { createBugSweepWorkflow } from "./bug-sweep.js";
import { createCodeReviewWorkflow } from "./code-review.js";
import { createMigrationWorkflow } from "./migration.js";
import { createDeadCodeWorkflow } from "./dead-code.js";

export const BUILTIN_WORKFLOWS: WorkflowDefinition[] = [
  createOmxPipelineWorkflow(),
  createSecurityAuditWorkflow(),
  createBugSweepWorkflow(),
  createCodeReviewWorkflow(),
  createMigrationWorkflow(),
  createDeadCodeWorkflow(),
];

/** 注册所有内置 workflow 到 store */
export async function registerBuiltinWorkflows(register: (def: WorkflowDefinition) => Promise<void>): Promise<void> {
  for (const def of BUILTIN_WORKFLOWS) {
    await register(def);
  }
}

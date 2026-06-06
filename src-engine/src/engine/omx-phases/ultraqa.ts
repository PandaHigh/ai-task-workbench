/**
 * Phase 5: UltraQA — Quality Assurance testing
 *
 * Tests the implementation using the tester role.
 * If tests fail, the pipeline loops back to RALPLAN with failure details.
 */

import type { CCClient } from "../../cc-integration/cc-client.js";
import type { NotifyFn } from "../omx-pipeline.js";
import { routeRoleForPhase } from "../omx-roles.js";
import { extractJson } from "../../lib/json-extract.js";
import type { UltragoalArtifacts } from "./ultragoal.js";
import type { ExecutionPlan, TestResult, TaskDefinition } from "@ai-workbench/shared";

export interface UltraQaArtifacts {
  testResult: TestResult;
}

export async function runUltraQa(
  task: TaskDefinition,
  plan: ExecutionPlan,
  ultragoalArtifacts: UltragoalArtifacts,
  ccClient: CCClient,
  notify: NotifyFn,
  workingDir: string,
  abortSignal?: AbortSignal,
): Promise<UltraQaArtifacts> {
  const { primary: role } = routeRoleForPhase("ultraqa", task.content);

  const prompt = `## Execution Plan
${plan.understanding}
Steps: ${plan.steps.join("; ")}
Target Files: ${plan.targetFiles.join(", ")}

## Recent Code Changes
${ultragoalArtifacts.diffSummary}

## Test Strategy
${plan.testStrategy}

## Instructions
1. Write tests to verify the code changes above
2. Use the project's existing test framework and conventions
3. Test both happy paths and edge cases
4. Run the tests and report results
5. If existing tests are broken, fix them

Respond ONLY with valid JSON:
{
  "testsWritten": ["path/to/test1.ts", ...],
  "allPassed": true_or_false,
  "failures": ["failure description 1", ...],
  "coverage": "description of what was tested"
}`;

  notify("task.progress", {
    taskId: task.id,
    phase: "ultraqa",
    message: "Running QA tests...",
  });

  const result = await ccClient.executeTask(prompt, {
    workingDir,
    timeoutMinutes: 15,
    maxTurns: role.maxTurns,
    systemPrompt:
      "You are a quality assurance engineer. Write tests and verify code changes. Use the project's existing test framework. Respond with valid JSON only.",
    allowedTools: role.tools,
    abortSignal,
  });

  let testResult: TestResult;
  try {
    testResult = JSON.parse(extractJson(result.result));
  } catch {
    testResult = {
      testsWritten: [],
      allPassed: false,
      failures: ["Failed to parse test results"],
      coverage: "unknown",
    };
  }

  notify("task.progress", {
    taskId: task.id,
    phase: "ultraqa",
    message: testResult.allPassed
      ? `All tests passed (${testResult.testsWritten.length} tests)`
      : `${testResult.failures.length} test failures`,
  });

  return { testResult };
}

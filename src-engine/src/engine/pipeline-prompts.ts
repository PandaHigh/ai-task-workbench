import type { ExecutionPlan, TestResult, ReviewResult, TaskContext } from "@ai-workbench/shared";

export function buildPlannerPrompt(taskContent: string, context: TaskContext): string {
  return `You are a software architect. Analyze the following task and create a concrete execution plan.

## Task
${taskContent}

## Project Goals
${context.goals.map((g, i) => `${i + 1}. ${g}`).join("\n")}

${context.lastTenCommits.length > 0 ? `## Recent Commits\n${context.lastTenCommits.slice(-5).map((c) => `- ${c.hash.substring(0, 7)} ${c.message}`).join("\n")}` : ""}

${context.lessonsLearned.length > 0 ? `## Lessons from Previous Failures\n${context.lessonsLearned.slice(-10).map((l) => `- [${l.category}] ${l.lesson}`).join("\n")}` : ""}

## Instructions
1. Read the project files to understand the codebase structure
2. Identify exactly which files need to be created or modified
3. Break the task into 3-8 concrete implementation steps
4. Identify risks and edge cases
5. Define a testing strategy

Respond ONLY with valid JSON:
{
  "understanding": "your understanding of the task",
  "steps": ["step 1", "step 2", ...],
  "targetFiles": ["path/to/file1.ts", ...],
  "risks": ["risk 1", ...],
  "testStrategy": "how to test this change"
}`;
}

export function buildPlannerSystemPrompt(): string {
  return "You are a software architect. You analyze tasks and produce concrete, actionable execution plans. You must respond with valid JSON only.";
}

export function buildDeveloperPrompt(taskContent: string, plan: ExecutionPlan, fixFeedback?: string): string {
  const parts: string[] = [];

  parts.push(`## Task
${taskContent}`);

  parts.push(`## Execution Plan
Understanding: ${plan.understanding}
Steps:
${plan.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}
Target Files: ${plan.targetFiles.join(", ")}
Risks: ${plan.risks.join("; ")}`);

  if (fixFeedback) {
    parts.push(`## Previous Attempt Feedback
The reviewer rejected your previous changes. Please fix the following issues:

${fixFeedback}

IMPORTANT: Address ALL the issues above. Do not just fix one and ignore the rest.`);
  }

  parts.push(`## Instructions
Implement the task following the execution plan. Make focused, minimal changes. Follow the project's existing code patterns.`);

  return parts.join("\n\n");
}

export function buildDeveloperSystemPrompt(): string {
  return `You are a skilled software developer. Your job is to implement the assigned task with high quality code.

Guidelines:
- Write clean, idiomatic code following the project's existing patterns
- Add appropriate error handling at system boundaries
- Prefer editing existing files over creating new ones
- Do not add unnecessary abstractions or features beyond what the task requires
- Ensure your changes are minimal and focused on the task at hand`;
}

export function buildTesterPrompt(plan: ExecutionPlan, diffSummary: string): string {
  return `## Execution Plan
${plan.understanding}
Steps: ${plan.steps.join("; ")}
Target Files: ${plan.targetFiles.join(", ")}

## Recent Code Changes
${diffSummary}

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
}

export function buildTesterSystemPrompt(): string {
  return `You are a quality assurance engineer. Your job is to write tests and verify that the codebase works correctly.

Guidelines:
- Write unit tests and integration tests as appropriate
- Test both happy paths and edge cases
- Use the project's existing test framework and conventions
- Verify that existing tests still pass after changes
- Report any issues found during testing`;
}

export function buildReviewerPrompt(plan: ExecutionPlan, diffSummary: string, testResult: TestResult): string {
  return `## Execution Plan
${plan.understanding}

## Code Changes
${diffSummary}

## Test Results
Tests written: ${testResult.testsWritten.join(", ") || "none"}
All passed: ${testResult.allPassed}
${testResult.failures.length > 0 ? `Failures:\n${testResult.failures.map((f) => `- ${f}`).join("\n")}` : "No failures"}
Coverage: ${testResult.coverage}

## Instructions
Review the code changes for quality, correctness, and potential issues. Be thorough but fair.

1. Check for correctness, edge cases, and error handling
2. Look for security vulnerabilities (OWASP top 10)
3. Verify the code follows project conventions
4. Assess test coverage adequacy
5. Provide specific, actionable feedback

Respond ONLY with valid JSON:
{
  "approved": true_or_false,
  "score": 0.0_to_1.0,
  "issues": [
    { "severity": "critical"|"major"|"minor", "file": "path", "line": 123, "description": "what's wrong", "suggestion": "how to fix" }
  ],
  "summary": "brief review summary"
}`;
}

export function buildReviewerSystemPrompt(): string {
  return `You are a code reviewer. Your job is to review code changes for quality, correctness, and potential issues.

Guidelines:
- Check for correctness, edge cases, and error handling
- Look for security vulnerabilities (OWASP top 10)
- Verify the code follows project conventions
- Identify any missing tests
- Provide specific, actionable feedback`;
}

export function buildFixFeedback(reviewResult: ReviewResult, testResult: TestResult): string {
  const parts: string[] = [];

  parts.push(`### Reviewer Feedback:\n${reviewResult.summary}`);

  if (reviewResult.issues.length > 0) {
    const critical = reviewResult.issues.filter((i) => i.severity === "critical");
    const major = reviewResult.issues.filter((i) => i.severity === "major");
    const minor = reviewResult.issues.filter((i) => i.severity === "minor");

    if (critical.length > 0) {
      parts.push(`### Critical Issues:\n${critical.map((i) => `- [${i.file}${i.line ? `:${i.line}` : ""}] ${i.description}\n  Fix: ${i.suggestion}`).join("\n")}`);
    }
    if (major.length > 0) {
      parts.push(`### Major Issues:\n${major.map((i) => `- [${i.file}${i.line ? `:${i.line}` : ""}] ${i.description}\n  Fix: ${i.suggestion}`).join("\n")}`);
    }
    if (minor.length > 0) {
      parts.push(`### Minor Issues:\n${minor.map((i) => `- [${i.file}${i.line ? `:${i.line}` : ""}] ${i.description}\n  Fix: ${i.suggestion}`).join("\n")}`);
    }
  }

  if (testResult.failures.length > 0) {
    parts.push(`### Test Failures:\n${testResult.failures.map((f) => `- ${f}`).join("\n")}`);
  }

  return parts.join("\n\n");
}

import { CCClient } from "../cc-integration/cc-client.js";

interface WizardSession {
  sessionId: string;
  workingDir: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  ccSessionId?: string;
  _lastActivity: number;
}

const sessions = new Map<string, WizardSession>();
const ccClient = new CCClient();

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_MESSAGES = 100;

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    const lastActivity = session._lastActivity || 0;
    if (lastActivity && now - lastActivity > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}, 60000).unref();

export function startSession(workingDir: string): WizardSession {
  const session: WizardSession = {
    sessionId: crypto.randomUUID(),
    workingDir,
    messages: [],
    _lastActivity: Date.now(),
  };
  sessions.set(session.sessionId, session);
  return session;
}

export async function chat(
  sessionId: string,
  userMessage: string,
): Promise<{
  response: string;
  shouldExtractParams: boolean;
}> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  session.messages.push({ role: "user", content: userMessage });

  session._lastActivity = Date.now();
  if (session.messages.length > MAX_MESSAGES) {
    session.messages = session.messages.slice(-MAX_MESSAGES);
  }

  const systemPrompt = `你是一个AI任务规划助手。你的任务是通过与用户对话，帮助他们清晰地定义一个AI编程任务。

你需要收集以下信息：
1. **任务内容**：用户想让AI完成什么具体的编程工作？（描述要做什么事）
2. **任务目标**：期望的最终结果是什么？交付物是什么？（描述期望的结果状态）
3. **终止条件**：什么具体、可验证的标志说明任务完成了？（描述可检查的条件，如"所有测试通过"、"文件X生成"、"功能Y可正常使用"）
4. **完成后动作**：任务完成后是否需要执行什么（比如运行测试、部署等）？

重要区分：
- "目标"是期望达成的结果（如"实现用户登录功能"）
- "终止条件"是可验证的检查点（如"登录接口返回200"、"未登录用户被正确拦截"）
- 目标和终止条件不能相同，也不能互相复制

对话策略：
- 如果用户一句话描述了所有内容，你要主动帮用户拆分出不同的目标和终止条件
- 如果用户只说了"做什么"，追问"怎么算做完了？有什么可以检查的？"
- 如果用户的描述模糊，主动追问细节
- 当收集完所有信息后，用以下格式总结：

---TASK_SUMMARY---
内容: [任务内容描述]
目标:
- [目标1]
- [目标2]
终止条件:
- [条件1]
- [条件2]
完成后动作: [动作描述]
---END_SUMMARY---

请用中文回复。`;

  const conversationHistory = session.messages
    .map((m) => `${m.role === "user" ? "用户" : "助手"}: ${m.content}`)
    .join("\n\n");

  const prompt = `${systemPrompt}\n\n对话历史：\n${conversationHistory}\n\n请继续对话：`;

  try {
    const result = await ccClient.executeTask(prompt, {
      workingDir: session.workingDir,
      timeoutMinutes: 3,
      maxTurns: 1,
      systemPrompt: "",
      disallowedTools: ["AskUserQuestion", "Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch"],
    });

    const response = result.result || "抱歉，我无法理解。请再描述一下你的需求。";
    session.messages.push({ role: "assistant", content: response });
    session.ccSessionId = result.sessionId;

    const shouldExtract = response.includes("---TASK_SUMMARY---");

    return { response, shouldExtractParams: shouldExtract };
  } catch (err) {
    console.warn("[wizard] CC client error:", err instanceof Error ? err.message : err);
    const fallback = generateFallbackResponse(userMessage, session.messages);
    session.messages.push({ role: "assistant", content: fallback });
    const shouldExtract = session.messages.filter((m) => m.role === "user").length >= 3;
    return { response: fallback, shouldExtractParams: shouldExtract };
  }
}

export function extractParams(sessionId: string): {
  content: string;
  goals: string[];
  terminationConditions: string[];
  postCompletionAction: string;
} | null {
  const session = sessions.get(sessionId);
  if (!session) return null;

  const lastAssistant = [...session.messages].reverse().find((m) => m.role === "assistant");

  if (lastAssistant?.content.includes("---TASK_SUMMARY---")) {
    return parseSummary(lastAssistant.content);
  }

  // Fallback: extract from conversation
  const userTexts = session.messages.filter((m) => m.role === "user").map((m) => m.content);

  const content = userTexts[0] || "未命名任务";
  const goals = userTexts.length > 1 ? [userTexts[1]] : [`完成${content}`];
  const terminationConditions = userTexts.length > 2 ? [userTexts[2]] : [`所有目标均已达成并验证通过`];

  return { content, goals, terminationConditions, postCompletionAction: "无" };
}

export function validateParams(params: ReturnType<typeof extractParams>): {
  valid: boolean;
  errors: string[];
} {
  if (!params) return { valid: false, errors: ["无法提取任务参数"] };

  const errors: string[] = [];
  if (!params.content?.trim()) errors.push("任务内容不能为空");
  if (!params.goals?.length) errors.push("至少需要一个目标");
  if (!params.terminationConditions?.length) errors.push("至少需要一个终止条件");

  const goalsText = params.goals?.join("").trim().toLowerCase() ?? "";
  const termsText = params.terminationConditions?.join("").trim().toLowerCase() ?? "";
  if (goalsText && termsText && goalsText === termsText) {
    errors.push("目标和终止条件不能完全相同，请区分期望结果和可验证的检查点");
  }

  return { valid: errors.length === 0, errors };
}

function parseSummary(text: string): {
  content: string;
  goals: string[];
  terminationConditions: string[];
  postCompletionAction: string;
} | null {
  const match = text.match(/---TASK_SUMMARY---([\s\S]*?)---END_SUMMARY---/);
  if (!match) return null;

  const body = match[1];
  const content = body.match(/内容:\s*(.+)/)?.[1]?.trim() || "";
  const goalsMatch = body.match(/目标:\s*\n([\s\S]*?)(?=终止条件:|$)/);
  const goals = goalsMatch
    ? goalsMatch[1]
        .split("\n")
        .map((l) => l.replace(/^-\s*/, "").trim())
        .filter(Boolean)
    : [];
  const termMatch = body.match(/终止条件:\s*\n([\s\S]*?)(?=完成后动作:|$)/);
  const terminationConditions = termMatch
    ? termMatch[1]
        .split("\n")
        .map((l) => l.replace(/^-\s*/, "").trim())
        .filter(Boolean)
    : [];
  const postCompletionAction = body.match(/完成后动作:\s*(.+)/)?.[1]?.trim() || "无";

  return { content, goals, terminationConditions, postCompletionAction };
}

function generateFallbackResponse(input: string, history: Array<{ role: string; content: string }>): string {
  const userCount = history.filter((m) => m.role === "user").length;
  if (userCount <= 1) {
    return `好的，"${input}" 听起来是个不错的方向。\n\n请进一步告诉我：\n1. 这个任务的具体目标是什么？\n2. 什么样的结果算完成？\n3. 完成后需要做什么？`;
  }
  if (userCount === 2) {
    return `理解了。再确认一下：\n\n关于终止条件，请告诉我什么样的结果算"完成"？有没有时间或质量上的要求？`;
  }
  return `很好，我已收集了足够信息来定义这个任务。\n\n请查看并确认参数，然后开始执行。`;
}

import { CCClient } from "../../cc-integration/cc-client.js";
import { methodHandlers } from "../../json-rpc/methods.js";
import { buildSystemPrompt } from "./master-prompts.js";
import { buildBrainstormSystemPrompt } from "./brainstorm-prompts.js";
import type { BrainstormState, BrainstormPhase } from "./brainstorm-state.js";

export interface ChatChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

interface MasterSession {
  sessionId: string;
  ccSessionId?: string;
  messages: ChatChatMessage[];
  brainstormState?: BrainstormState;
  _lastActivity: number;
}

type NotifyFn = (method: string, params: Record<string, unknown>) => void;

const TOOL_CALL_REGEX = /<<TOOL_CALL>>\s*(\{[\s\S]*?\})\s*<<\/TOOL_CALL>>/g;
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_MESSAGES = 200;
const MAX_TOOL_CALLS_PER_MESSAGE = 5;

export class MasterAgent {
  private ccClient: CCClient;
  private sessions = new Map<string, MasterSession>();

  constructor(ccClient?: CCClient) {
    this.ccClient = ccClient ?? new CCClient();
    // Periodic session cleanup
    setInterval(() => {
      const now = Date.now();
      for (const [id, session] of this.sessions) {
        if (now - session._lastActivity > SESSION_TTL_MS) {
          this.sessions.delete(id);
        }
      }
    }, 60_000).unref();
  }

  getOrCreateSession(sessionId: string): MasterSession {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = { sessionId, messages: [], _lastActivity: Date.now() };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  getHistory(sessionId: string): ChatChatMessage[] {
    return this.sessions.get(sessionId)?.messages ?? [];
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  async handleMessage(sessionId: string, userMessage: string, notify: NotifyFn): Promise<void> {
    const session = this.getOrCreateSession(sessionId);
    session.messages.push({ role: "user", content: userMessage, timestamp: Date.now() });
    session._lastActivity = Date.now();
    if (session.messages.length > MAX_MESSAGES) {
      session.messages = session.messages.slice(-MAX_MESSAGES);
    }

    // Auto-activate brainstorming for task creation intent
    if (!session.brainstormState && this.detectTaskCreationIntent(userMessage)) {
      session.brainstormState = { phase: "contextualizing", activatedAt: Date.now() };
      session.ccSessionId = undefined;
    }

    // Deactivate brainstorming on explicit cancel
    if (session.brainstormState && this.detectBrainstormCancel(userMessage)) {
      session.brainstormState = undefined;
      session.ccSessionId = undefined;
    }

    try {
      const fullResponse = await this.runAgentLoop(session, notify);
      session.messages.push({ role: "assistant", content: fullResponse, timestamp: Date.now() });
      notify("chat.complete", {
        sessionId,
        message: { role: "assistant", content: fullResponse, timestamp: Date.now() },
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      notify("chat.error", { sessionId, error: errorMsg });
    }
  }

  /** Run the agentic loop: call CC, parse tool calls, execute, feed results back. */
  private async runAgentLoop(session: MasterSession, notify: NotifyFn): Promise<string> {
    const systemPrompt = session.brainstormState
      ? buildBrainstormSystemPrompt(session.brainstormState)
      : buildSystemPrompt();
    let totalToolCalls = 0;
    let accumulatedResponse = "";
    let currentPrompt = this.buildPrompt(session);

    for (let iteration = 0; iteration < 10; iteration++) {
      const stream = this.ccClient.executeTaskStream(currentPrompt, {
        workingDir: process.cwd(),
        sessionId: session.ccSessionId,
        timeoutMinutes: 3,
        maxTurns: 2,
        systemPrompt,
        disallowedTools: [
          "AskUserQuestion",
          "Bash",
          "Read",
          "Write",
          "Edit",
          "Glob",
          "Grep",
          "WebSearch",
          "WebFetch",
          "Agent",
        ],
      });

      let iterationText = "";

      for await (const msg of stream) {
        if (msg.type === "assistant") {
          const text = this.extractTextFromCCMessage(msg as unknown as Record<string, unknown>);
          if (text) iterationText += text;
        }
        if (msg.type === "result" && typeof msg.result === "string") {
          if (!iterationText && msg.result) iterationText = msg.result;
        }
        if (msg.session_id) {
          session.ccSessionId = msg.session_id;
        }
      }

      // Parse tool calls from the accumulated text
      const toolCalls = this.parseToolCalls(iterationText);
      let cleanText = this.stripToolCalls(iterationText);

      // Process brainstorm phase markers
      if (session.brainstormState) {
        cleanText = this.processBrainstormResponse(session, cleanText);
      }

      if (toolCalls.length === 0 || totalToolCalls >= MAX_TOOL_CALLS_PER_MESSAGE) {
        // Final iteration — stream clean text to UI
        if (cleanText) {
          accumulatedResponse += cleanText;
          notify("chat.stream", { sessionId: session.sessionId, type: "text_delta", content: cleanText });
        }
        break;
      }

      // Tool call iteration — only stream non-tool text, then execute tools
      if (cleanText) {
        accumulatedResponse += cleanText;
        notify("chat.stream", { sessionId: session.sessionId, type: "text_delta", content: cleanText });
      }

      // Execute tool calls and build result prompt
      let toolResults = "";
      for (const call of toolCalls) {
        if (totalToolCalls >= MAX_TOOL_CALLS_PER_MESSAGE) break;
        totalToolCalls++;

        notify("chat.stream", {
          sessionId: session.sessionId,
          type: "tool_executing",
          toolName: call.method,
        });

        const result = await this.executeToolCall(call);
        const resultStr = JSON.stringify(result);

        // Exit brainstorming after successful run.create
        if (call.method === "run.create" && result.success && session.brainstormState) {
          session.brainstormState = undefined;
          session.ccSessionId = undefined;
        }

        notify("chat.stream", {
          sessionId: session.sessionId,
          type: "tool_complete",
          toolName: call.method,
          success: result.success,
          resultPreview: resultStr.length > 200 ? resultStr.substring(0, 200) + "..." : resultStr,
        });

        toolResults += `\n<<TOOL_RESULT>>\n${resultStr}\n<</TOOL_RESULT>>\n`;
      }

      // Feed tool results back for next iteration
      currentPrompt = `之前的输出:\n${iterationText}\n\n工具执行结果:\n${toolResults}\n\n请根据工具结果继续回复用户。如果还需要调用其他工具，继续使用 <<TOOL_CALL>> 格式。`;
    }

    return accumulatedResponse.trim() || "(无回复)";
  }

  private buildPrompt(session: MasterSession): string {
    const windowSize = session.brainstormState ? 12 : 20;
    const recentMessages = session.messages.slice(-windowSize);
    const conversation = recentMessages.map((m) => `${m.role === "user" ? "用户" : "助手"}: ${m.content}`).join("\n\n");
    return `对话历史：\n${conversation}\n\n请继续对话：`;
  }

  private parseToolCalls(text: string): Array<{ method: string; params: Record<string, unknown> }> {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    let match: RegExpExecArray | null;
    const regex = new RegExp(TOOL_CALL_REGEX.source, "g");
    while ((match = regex.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        if (typeof parsed.method === "string") {
          calls.push({ method: parsed.method, params: parsed.params ?? {} });
        }
      } catch {
        /* skip malformed JSON */
      }
    }
    return calls;
  }

  private stripToolCalls(text: string): string {
    return text.replace(/<<TOOL_CALL>>[\s\S]*?<<\/TOOL_CALL>>/g, "").trim();
  }

  /** Extract text content from a CC stream-json assistant message.
   *  Format: { type: "assistant", message: { content: [{type:"text",text:"..."}] } }
   *  Or: { type: "assistant", content: "plain text" }
   */
  private extractTextFromCCMessage(msg: Record<string, unknown>): string {
    // Direct string content
    if (typeof msg.content === "string" && msg.content) return msg.content;

    // Nested message.content array (standard stream-json format)
    const message = msg.message as Record<string, unknown> | undefined;
    if (message && Array.isArray(message.content)) {
      return (message.content as Array<Record<string, unknown>>)
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text as string)
        .join("");
    }

    return "";
  }

  private async executeToolCall(call: {
    method: string;
    params: Record<string, unknown>;
  }): Promise<{ success: boolean; data?: unknown; error?: string }> {
    const handler = methodHandlers[call.method];
    if (!handler) {
      return { success: false, error: `Unknown method: ${call.method}` };
    }
    try {
      const result = await handler(call.params);
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private detectTaskCreationIntent(message: string): boolean {
    const lower = message.toLowerCase();
    const patterns = [
      /创建.*(任务|项目)/,
      /帮我?(做|写|开发|实现|构建|build)/,
      /我需要.*(做|开发|实现|build)/,
      /新任务/,
      /我想/,
      /start.*task/i,
      /create.*task/i,
      /帮我?设计/,
      /头脑风暴/,
      /brainstorm/i,
    ];
    return patterns.some((p) => p.test(lower));
  }

  private detectBrainstormCancel(message: string): boolean {
    const lower = message.toLowerCase().trim();
    return /^(取消|算了|cancel|abort|不用了|停止|退出头脑风暴)$/.test(lower);
  }

  private processBrainstormResponse(session: MasterSession, text: string): string {
    if (!session.brainstormState) return text;

    const phaseMatch = text.match(/<<PHASE:(\w+)>>/);
    if (phaseMatch) {
      const newPhase = phaseMatch[1] as BrainstormPhase;
      if (["contextualizing", "exploring", "approaches", "designing", "approved", "inactive"].includes(newPhase)) {
        session.brainstormState.phase = newPhase;
      }
    }

    return text.replace(/<<PHASE:\w+>>/g, "").trim();
  }
}

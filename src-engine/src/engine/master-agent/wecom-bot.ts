import { WSClient, generateReqId } from "@wecom/aibot-node-sdk";
import type {
  WsFrame,
  TextMessage,
  VoiceMessage,
  EventMessageWith,
  EnterChatEvent,
  SendMsgBody,
} from "@wecom/aibot-node-sdk";
import type { MasterAgent } from "./master-agent.js";
import type { Store } from "../../db/store.js";
import { log } from "../../lib/logger.js";

type NotifyFn = (method: string, params: Record<string, unknown>) => void;

/** 企业微信会话 → MasterAgent sessionId 的映射 */
const SESSION_PREFIX_SINGLE = "wecom:single:";
const SESSION_PREFIX_GROUP = "wecom:group:";

/** 流式回复节流间隔 (ms)，避免超出企微 30条/分钟 限制 */
const STREAM_THROTTLE_MS = 300;

/** 企微流式内容最大字节数 */
const MAX_STREAM_BYTES = 20480;

export class WeComBot {
  private wsClient: WSClient | null = null;
  private masterAgent: MasterAgent;
  private store: Store;
  private sessionMap = new Map<string, string>();
  private _connected = false;
  private botId = "";
  private enabled = false;

  constructor(masterAgent: MasterAgent, store: Store) {
    this.masterAgent = masterAgent;
    this.store = store;
  }

  async start(): Promise<void> {
    const enabled = this.store.getConfig("wecom.enabled");
    const botId = this.store.getConfig("wecom.botId");
    const secret = this.store.getConfig("wecom.secret");

    if (enabled !== true && enabled !== "true") {
      log.info("[wecom-bot] Disabled in config, skipping");
      return;
    }

    if (!botId || typeof botId !== "string" || !secret || typeof secret !== "string") {
      log.warn("[wecom-bot] Missing botId or secret in config, skipping");
      return;
    }

    this.botId = botId;
    this.enabled = true;

    this.wsClient = new WSClient({
      botId,
      secret,
      maxReconnectAttempts: -1,
      logger: {
        debug: (msg: string, ...args: unknown[]) => log.debug(`[wecom-sdk] ${msg}`, ...args),
        info: (msg: string, ...args: unknown[]) => log.info(`[wecom-sdk] ${msg}`, ...args),
        warn: (msg: string, ...args: unknown[]) => log.warn(`[wecom-sdk] ${msg}`, ...args),
        error: (msg: string, ...args: unknown[]) => log.error(`[wecom-sdk] ${msg}`, ...args),
      },
    });

    this.setupEventHandlers();
    this.wsClient.connect();
    log.info("[wecom-bot] Connecting...");
  }

  stop(): void {
    if (this.wsClient) {
      this.wsClient.disconnect();
      this.wsClient = null;
      this._connected = false;
      log.info("[wecom-bot] Disconnected");
    }
  }

  isRunning(): boolean {
    return this._connected;
  }

  getStatus(): { enabled: boolean; connected: boolean; botId?: string } {
    return {
      enabled: this.enabled,
      connected: this._connected,
      botId: this.botId || undefined,
    };
  }

  async sendProactiveMessage(target: string, content: string): Promise<void> {
    if (!this.wsClient || !this._connected) {
      throw new Error("WeChat Work bot is not connected");
    }

    const body: SendMsgBody = {
      msgtype: "markdown",
      markdown: { content },
    };

    await this.wsClient.sendMessage(target, body);
  }

  async handleEngineNotification(method: string, params: Record<string, unknown>): Promise<void> {
    if (!this.wsClient || !this._connected) return;

    const runId = params.runId as string | undefined;
    if (!runId) return;

    if (method === "run.status") {
      const status = params.status as string;
      const goal = params.goal as string | undefined;
      if (status === "completed" || status === "failed" || status === "paused") {
        const label = status === "completed" ? "已完成" : status === "failed" ? "执行失败" : "已暂停";
        const msg = `**任务状态更新**\n> Run: \`${runId.slice(0, 8)}\`\n> 状态: **${label}**${goal ? `\n> 目标: ${goal}` : ""}`;
        await this.broadcastToSubscribers(runId, msg).catch(() => {});
      }
    }

    if (method === "approval.requested") {
      const taskId = params.taskId as string | undefined;
      const msg = `**需要审批**\n> Run: \`${runId.slice(0, 8)}\`\n> Task: \`${taskId?.slice(0, 8) || "N/A"}\`\n> 请在工作台中处理`;
      await this.broadcastToSubscribers(runId, msg).catch(() => {});
    }
  }

  /** 向所有与该 runId 关联的企微会话推送消息 */
  private async broadcastToSubscribers(_runId: string, _content: string): Promise<void> {
    // MVP: 暂不实现订阅映射，主动推送依赖 wecom.test 手动触发
    // 后续可通过 config.wecom.notifyTargets 存储映射关系
  }

  private setupEventHandlers(): void {
    if (!this.wsClient) return;

    this.wsClient.on("authenticated", () => {
      this._connected = true;
      log.info("[wecom-bot] Authenticated successfully");
    });

    this.wsClient.on("disconnected", (reason: string) => {
      this._connected = false;
      log.warn(`[wecom-bot] Disconnected: ${reason}`);
    });

    this.wsClient.on("reconnecting", (attempt: number) => {
      this._connected = false;
      log.info(`[wecom-bot] Reconnecting attempt ${attempt}`);
    });

    this.wsClient.on("error", (error: Error) => {
      log.error(`[wecom-bot] Error: ${error.message}`);
    });

    this.wsClient.on("message.text", (frame: WsFrame<TextMessage>) => {
      this.handleTextMessage(frame).catch((err) => {
        log.error(`[wecom-bot] Error handling text message: ${err instanceof Error ? err.message : err}`);
      });
    });

    this.wsClient.on("message.voice", (frame: WsFrame<VoiceMessage>) => {
      this.handleTextMessage(frame as unknown as WsFrame<TextMessage>).catch((err) => {
        log.error(`[wecom-bot] Error handling voice message: ${err instanceof Error ? err.message : err}`);
      });
    });

    this.wsClient.on("event.enter_chat", (frame: WsFrame<EventMessageWith<EnterChatEvent>>) => {
      this.handleWelcome(frame).catch((err) => {
        log.error(`[wecom-bot] Error sending welcome: ${err instanceof Error ? err.message : err}`);
      });
    });
  }

  private getOrCreateSessionId(wecomKey: string): string {
    let sessionId = this.sessionMap.get(wecomKey);
    if (!sessionId) {
      sessionId = `wecom-${generateReqId("session")}`;
      this.sessionMap.set(wecomKey, sessionId);
    }
    return sessionId;
  }

  private async handleTextMessage(frame: WsFrame<TextMessage>): Promise<void> {
    if (!this.wsClient || !this._connected) return;

    const body = frame.body;
    if (!body) return;

    const userMessage = body.text?.content || body.voice?.content || "";
    if (!userMessage.trim()) return;

    const wecomKey = body.chattype === "group"
      ? `${SESSION_PREFIX_GROUP}${body.chatid}`
      : `${SESSION_PREFIX_SINGLE}${body.from.userid}`;

    const sessionId = this.getOrCreateSessionId(wecomKey);
    const streamId = generateReqId("stream");

    // 发送初始 "思考中" 帧
    try {
      await this.wsClient.replyStream(frame, streamId, "...", false);
    } catch {
      // 可能超时，继续处理
    }

    const notifyFn = this.createWeComNotifyFn(frame, streamId, sessionId);

    try {
      await this.masterAgent.handleMessage(sessionId, userMessage, notifyFn);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      try {
        await this.wsClient.replyStream(frame, streamId, `处理出错: ${errorMsg}`, true);
      } catch {
        // 回复失败也只能忽略
      }
    }
  }

  private createWeComNotifyFn(
    frame: WsFrame<TextMessage>,
    streamId: string,
    sessionId: string,
  ): NotifyFn {
    let accumulated = "";
    let lastSentLength = 0;
    let throttleTimer: ReturnType<typeof setTimeout> | null = null;

    const flushStream = async () => {
      if (!this.wsClient || !this._connected) return;
      if (accumulated.length > lastSentLength) {
        const content = Buffer.from(accumulated).byteLength > MAX_STREAM_BYTES
          ? accumulated.slice(0, MAX_STREAM_BYTES)
          : accumulated;
        try {
          await this.wsClient.replyStreamNonBlocking(frame, streamId, content, false);
        } catch {
          // 流式帧丢失可接受
        }
        lastSentLength = accumulated.length;
      }
    };

    const cleanup = () => {
      if (throttleTimer) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }
    };

    return (method: string, params: Record<string, unknown>) => {
      if (params.sessionId !== sessionId) return;

      if (method === "chat.stream" && params.type === "text_delta") {
        accumulated += (params.content as string) || "";
        if (!throttleTimer) {
          throttleTimer = setTimeout(() => {
            flushStream().catch(() => {});
            throttleTimer = null;
          }, STREAM_THROTTLE_MS);
        }
      } else if (method === "chat.stream" && params.type === "tool_executing") {
        const toolName = params.toolName as string;
        accumulated += `\n> 正在执行: \`${toolName}\`...\n`;
        if (!throttleTimer) {
          throttleTimer = setTimeout(() => {
            flushStream().catch(() => {});
            throttleTimer = null;
          }, STREAM_THROTTLE_MS);
        }
      } else if (method === "chat.stream" && params.type === "tool_complete") {
        const toolName = params.toolName as string;
        const success = params.success as boolean;
        accumulated += `\n> \`${toolName}\` ${success ? "完成" : "失败"}\n`;
      } else if (method === "chat.complete") {
        cleanup();
        const finalContent = (params.message as { content?: string })?.content || accumulated;
        const content = Buffer.from(finalContent).byteLength > MAX_STREAM_BYTES
          ? finalContent.slice(0, MAX_STREAM_BYTES)
          : finalContent;
        this.wsClient?.replyStream(frame, streamId, content, true).catch(() => {});
      } else if (method === "chat.error") {
        cleanup();
        const errorMsg = (params.error as string) || "未知错误";
        this.wsClient?.replyStream(frame, streamId, `错误: ${errorMsg}`, true).catch(() => {});
      }
    };
  }

  private async handleWelcome(frame: WsFrame<EventMessageWith<EnterChatEvent>>): Promise<void> {
    if (!this.wsClient) return;
    try {
      await this.wsClient.replyWelcome(frame, {
        msgtype: "text",
        text: { content: "你好！我是 PandaAI 助手，可以帮你管理 AI 编码任务。直接描述你想做的事情即可。" },
      });
    } catch {
      // 欢迎语超时 5 秒，忽略
    }
  }
}

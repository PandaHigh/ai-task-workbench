import { create } from "zustand";

export interface ToolCallInfo {
  method: string;
  status: "executing" | "completed" | "error";
  resultPreview?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  toolCalls?: ToolCallInfo[];
}

interface ChatStore {
  messages: ChatMessage[];
  sessionId: string | null;
  isVisible: boolean;
  isLoading: boolean;
  streamingContent: string;

  toggleVisibility: () => void;
  show: () => void;
  hide: () => void;
  setSessionId: (id: string) => void;
  addUserMessage: (content: string) => void;
  startAssistantMessage: () => void;
  appendStreamContent: (content: string) => void;
  addToolCall: (tool: ToolCallInfo) => void;
  updateToolCall: (method: string, status: string, resultPreview?: string) => void;
  finalizeAssistantMessage: () => void;
  setError: (error: string) => void;
  clearChat: () => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  sessionId: null,
  isVisible: false,
  isLoading: false,
  streamingContent: "",

  toggleVisibility: () => set((s) => ({ isVisible: !s.isVisible })),
  show: () => set({ isVisible: true }),
  hide: () => set({ isVisible: false }),

  setSessionId: (id) => set({ sessionId: id }),

  addUserMessage: (content) =>
    set((s) => ({
      messages: [...s.messages, { id: crypto.randomUUID(), role: "user", content, timestamp: Date.now() }],
    })),

  startAssistantMessage: () =>
    set((s) => ({
      isLoading: true,
      streamingContent: "",
      messages: [
        ...s.messages,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "",
          timestamp: Date.now(),
          isStreaming: true,
          toolCalls: [],
        },
      ],
    })),

  appendStreamContent: (content) =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === "assistant" && last.isStreaming) {
        last.content = s.streamingContent + content;
      }
      return { messages: msgs, streamingContent: s.streamingContent + content };
    }),

  addToolCall: (tool) =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === "assistant") {
        last.toolCalls = [...(last.toolCalls || []), tool];
      }
      return { messages: msgs };
    }),

  updateToolCall: (method, status, resultPreview) =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === "assistant" && last.toolCalls) {
        last.toolCalls = last.toolCalls.map((tc) =>
          tc.method === method && tc.status === "executing"
            ? { ...tc, status: status as ToolCallInfo["status"], resultPreview }
            : tc,
        );
      }
      return { messages: msgs };
    }),

  finalizeAssistantMessage: () =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === "assistant") {
        last.isStreaming = false;
        // Use streamingContent as the final content to avoid partial updates
        if (s.streamingContent) {
          last.content = s.streamingContent;
        }
      }
      return { messages: msgs, isLoading: false, streamingContent: "" };
    }),

  setError: (error) =>
    set((s) => ({
      isLoading: false,
      messages: [
        ...s.messages.filter((m) => !(m.role === "assistant" && m.isStreaming)),
        { id: crypto.randomUUID(), role: "system", content: `错误: ${error}`, timestamp: Date.now() },
      ],
    })),

  clearChat: () => set({ messages: [], sessionId: null, isLoading: false, streamingContent: "" }),
}));

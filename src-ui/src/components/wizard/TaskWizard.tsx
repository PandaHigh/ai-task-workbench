import { useWizardStore } from "../../stores/wizard-store";
import { useNavigate } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { useTaskStore } from "../../stores/task-store";
import { useEngine } from "../../hooks/useEngine";
import type { ExecutionRun } from "@ai-workbench/shared";
import { useToast } from "../common/Toast";
import { Spinner } from "../common/Spinner";
import { pageEnterStyle } from "../../hooks/useAnimations";

function TypewriterText({ text, speed = 20 }: { text: string; speed?: number }) {
  const [displayed, setDisplayed] = useState("");
  const [isTyping, setIsTyping] = useState(true);
  const indexRef = useRef(0);

  useEffect(() => {
    indexRef.current = 0;
    setDisplayed("");
    setIsTyping(true);
    const timer = setInterval(() => {
      indexRef.current += 1;
      if (indexRef.current >= text.length) {
        setDisplayed(text);
        setIsTyping(false);
        clearInterval(timer);
      } else {
        setDisplayed(text.slice(0, indexRef.current));
      }
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed]);

  return (
    <span>
      {displayed}
      {isTyping && <span className="typewriter-cursor" />}
    </span>
  );
}

export function TaskWizard() {
  const navigate = useNavigate();
  const { call } = useEngine();
  const toast = useToast();
  const {
    step, workingDir, messages, taskParams, errors, sessionId,
    setStep, setWorkingDir, setSessionId, addMessage, setTaskParams, setValidation, reset,
  } = useWizardStore();
  const addTask = useTaskStore((s) => s.addTask);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [dirInput, setDirInput] = useState("");
  const [showDirInput, setShowDirInput] = useState(false);
  const [lastAssistantIdx, setLastAssistantIdx] = useState(-1);

  // Track last assistant message for typewriter effect
  useEffect(() => {
    let idx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") { idx = i; break; }
    }
    setLastAssistantIdx(idx);
  }, [messages]);

  const handleSelectDir = () => {
    setShowDirInput(true);
  };

  const confirmDir = () => {
    if (!dirInput.trim()) return;
    setWorkingDir(dirInput.trim());
    startWizardSession(dirInput.trim());
    setShowDirInput(false);
  };

  const startWizardSession = async (dir: string) => {
    try {
      const res = (await call("wizard.start", { workingDir: dir })) as { sessionId: string };
      setSessionId(res.sessionId);
      setStep(1);
    } catch (err) {
      toast.error(`启动向导失败: ${err}`);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    const userMsg = input;
    setInput("");
    addMessage({ role: "user", content: userMsg, timestamp: Date.now() });

    setIsLoading(true);
    try {
      const res = (await call("wizard.chat", {
        sessionId,
        message: userMsg,
      })) as { response: string; shouldExtractParams: boolean };

      addMessage({ role: "assistant", content: res.response, timestamp: Date.now() });

      if (res.shouldExtractParams) {
        const valRes = (await call("wizard.validate", { sessionId })) as {
          valid: boolean;
          errors: string[];
          params: Record<string, unknown> | null;
        };

        if (valRes.valid && valRes.params) {
          setTaskParams(valRes.params as { content: string; goals: string[]; terminationConditions: string[]; postCompletionAction: string });
          setValidation(true, []);
          setStep(2);
        } else {
          setValidation(valRes.valid, valRes.errors);
          const errorMsg = `参数校验未通过:\n${valRes.errors.map((e: string) => `- ${e}`).join("\n")}\n请重新引导用户提供完整信息。`;
          addMessage({ role: "assistant", content: `⚠ 参数校验未通过，正在重新引导...`, timestamp: Date.now() });
          try {
            const retryRes = (await call("wizard.chat", {
              sessionId,
              message: errorMsg,
            })) as { response: string; shouldExtractParams: boolean };
            addMessage({ role: "assistant", content: retryRes.response, timestamp: Date.now() });
          } catch (retryErr) {
            console.warn("Wizard validation retry failed:", retryErr instanceof Error ? retryErr.message : retryErr);
            addMessage({ role: "assistant", content: "请补充以下信息:\n" + valRes.errors.join("\n"), timestamp: Date.now() });
          }
        }
      }
    } catch (err) {
      addMessage({
        role: "assistant",
        content: `[连接错误] ${err instanceof Error ? err.message : err}\n请确认引擎是否运行中。`,
        timestamp: Date.now(),
      });
    }
    setIsLoading(false);
  };

  const handleConfirm = async () => {
    if (!taskParams) return;
    try {
      const run = (await call("run.create", {
        workingDir,
        goals: taskParams.goals,
        terminationConditions: taskParams.terminationConditions,
        tasks: [{
          content: taskParams.content,
          type: "user_defined",
          priority: 1,
          timeoutMinutes: 60,
          agentMode: "single",
        }],
      })) as ExecutionRun;

      addTask(run);
      toast.success("任务创建成功，开始执行");
      reset();
      navigate(`/evolution/${run.id}`);
    } catch (err) {
      toast.error(`创建失败: ${err instanceof Error ? err.message : err}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getMessageId = (msg: typeof messages[0], idx: number) => {
    return `${msg.role}-${msg.timestamp}-${idx}`;
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={pageEnterStyle()}>
      <div
        className="px-6 py-4 border-b"
        style={{ borderColor: "var(--border)", animation: "slideDown 0.3s ease-out" }}
      >
        <div className="flex items-center gap-3">
          <button onClick={() => { reset(); navigate("/"); }} className="text-xs px-2 py-1 rounded" style={{ color: "var(--text-secondary)" }} aria-label="返回">← 返回</button>
          <h2 className="text-sm font-bold">新建 AI 任务</h2>
        </div>
        <div className="flex gap-2 mt-3">
          {["选择目录", "AI 对话", "确认参数"].map((label, i) => (
            <div key={i} className="flex items-center gap-1">
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs" style={{
                background: i <= step ? "var(--blue)" : "var(--bg-tertiary)",
                color: i <= step ? "#0d1117" : "var(--text-secondary)",
              }}>{i + 1}</div>
              <span className="text-xs" style={{ color: i <= step ? "var(--text-primary)" : "var(--text-secondary)" }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {step === 0 && (
        <div className="flex-1 flex items-center justify-center" style={{ animation: "fadeIn 0.4s ease-out" }}>
          <div className="text-center">
            <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>选择 AI 任务的工作目录</p>
            {!showDirInput ? (
              <button onClick={handleSelectDir} className="px-6 py-3 rounded text-sm font-semibold" style={{ background: "var(--blue)", color: "#0d1117" }}>输入目录路径</button>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={dirInput}
                  onChange={(e) => setDirInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && confirmDir()}
                  placeholder="/path/to/project"
                  className="px-3 py-2 rounded text-xs outline-none"
                  style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)", width: 300 }}
                  autoFocus
                />
                <button onClick={confirmDir} className="px-4 py-2 rounded text-xs font-semibold" style={{ background: "var(--green)", color: "#0d1117" }}>确认</button>
              </div>
            )}
            {workingDir && <p className="text-xs mt-2" style={{ color: "var(--green)" }}>已选择: {workingDir}</p>}
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="flex-1 flex flex-col" style={{ animation: "fadeIn 0.3s ease-out" }}>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-10">
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>AI 助手将通过对话帮你定义任务的目标和终止条件。</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={getMessageId(msg, i)}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                style={{
                  animation: "slideUp 0.3s ease-out",
                }}
              >
                <div className={`max-w-[80%] px-3 py-2 rounded-lg text-xs terminal-line whitespace-pre-wrap ${msg.role === "assistant" ? "glass-card-sm" : ""}`} style={{
                  background: msg.role === "user" ? "var(--blue)" : undefined,
                  color: msg.role === "user" ? "#0d1117" : "var(--text-primary)",
                }}>
                  {msg.role === "assistant" && i === lastAssistantIdx && !isLoading
                    ? <TypewriterText text={msg.content} />
                    : msg.content
                  }
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start" style={{ animation: "slideUp 0.25s ease-out" }}>
                <div className="glass-card-sm px-3 py-2 rounded-lg text-xs flex items-center gap-2">
                  <Spinner size="sm" />
                  <span style={{ color: "var(--text-secondary)" }}>AI 正在思考</span>
                </div>
              </div>
            )}
          </div>
          <div className="p-4 border-t" style={{ borderColor: "var(--border)" }}>
            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="描述你的任务... (Enter 发送, Shift+Enter 换行)"
                disabled={isLoading}
                rows={1}
                className="flex-1 px-3 py-2 rounded text-xs outline-none resize-none"
                style={{
                  background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)",
                }}
              />
              <button onClick={handleSend} disabled={isLoading}
                className="px-4 py-2 rounded text-xs font-semibold disabled:opacity-50" style={{ background: "var(--green)", color: "#0d1117" }}>
                发送
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 2 && taskParams && (
        <div className="flex-1 overflow-y-auto p-6" style={{ animation: "fadeIn 0.3s ease-out" }}>
          <div
            className="glass-card p-4"
            style={{ animation: "slideUp 0.35s ease-out" }}
          >
            <h3 className="text-sm font-bold mb-3">任务参数</h3>
            <div className="space-y-3 text-xs">
              <div>
                <span style={{ color: "var(--text-secondary)" }}>工作目录:</span>
                <span className="ml-2" style={{ color: "var(--blue)" }}>{workingDir}</span>
              </div>
              <div>
                <span style={{ color: "var(--text-secondary)" }}>任务内容:</span>
                <p className="mt-1" style={{ color: "var(--text-primary)" }}>{taskParams.content}</p>
              </div>
              <div>
                <span style={{ color: "var(--text-secondary)" }}>目标:</span>
                <ul className="mt-1 space-y-1">
                  {taskParams.goals.map((g, i) => <li key={i} style={{ color: "var(--green)" }}>• {g}</li>)}
                </ul>
              </div>
              <div>
                <span style={{ color: "var(--text-secondary)" }}>终止条件:</span>
                <ul className="mt-1 space-y-1">
                  {taskParams.terminationConditions.map((c, i) => <li key={i} style={{ color: "var(--yellow)" }}>• {c}</li>)}
                </ul>
              </div>
            </div>
            {errors.length > 0 && (
              <div className="mt-4 p-3 rounded" style={{ background: "rgba(248, 81, 73, 0.1)" }}>
                {errors.map((e, i) => <p key={i} className="text-xs" style={{ color: "var(--red)" }}>{e}</p>)}
              </div>
            )}
          </div>
          <div className="flex gap-3 mt-6">
            <button onClick={() => setStep(1)} className="px-4 py-2 rounded text-xs" style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}>返回修改</button>
            <button onClick={handleConfirm} className="px-6 py-2 rounded text-xs font-semibold" style={{ background: "var(--green)", color: "#0d1117" }}>确认并开始执行</button>
          </div>
        </div>
      )}
    </div>
  );
}

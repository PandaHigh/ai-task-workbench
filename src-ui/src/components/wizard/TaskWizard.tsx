import { useWizardStore } from "../../stores/wizard-store";
import { useNavigate } from "react-router-dom";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTaskStore } from "../../stores/task-store";
import { useEngine } from "../../hooks/useEngine";
import { usePersistedDir } from "../../hooks/usePersistedDir";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { QuickCreate } from "./QuickCreate";
import type { ExecutionRun } from "@ai-workbench/shared";
import { useToast } from "../common/Toast";
import { Spinner } from "../common/Spinner";
import { pageEnterStyle } from "../../hooks/useAnimations";
import { open } from "@tauri-apps/plugin-dialog";
import { marked } from "marked";
import { BUILT_IN_TEMPLATES } from "../../lib/task-templates";

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

  const html = useMemo(() => {
    try { return marked.parse(displayed, { async: false }) as string; } catch { return displayed; }
  }, [displayed]);

  return (
    <span>
      <span className="markdown-body text-xs" dangerouslySetInnerHTML={{ __html: html }} />
      {isTyping && <span className="typewriter-cursor" />}
    </span>
  );
}

const STEP_LABELS = ["准备工作", "告诉 AI", "确认任务"] as const;

export function TaskWizard() {
  const navigate = useNavigate();
  const { call } = useEngine();
  const toast = useToast();
  const { getLastDir, saveDir } = usePersistedDir();

  const {
    step, mode, workingDir, messages, taskParams, errors, sessionId,
    editedContent, editedGoals, editedConditions,
    setStep, setMode, setWorkingDir, setSessionId, addMessage, setTaskParams, setValidation, reset,
    setEditedContent, setEditedGoals, setEditedConditions,
    applyTemplate,
  } = useWizardStore();

  const addTask = useTaskStore((s) => s.addTask);
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [dirInput, setDirInput] = useState("");
  const [dirError, setDirError] = useState("");
  const [showDirInput, setShowDirInput] = useState(false);
  const [lastAssistantIdx, setLastAssistantIdx] = useState(-1);
  const [showBackConfirm, setShowBackConfirm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [autonomyLevel, setAutonomyLevel] = useState<"assisted" | "supervised" | "autonomous">("assisted");
  const [maxConcurrent, setMaxConcurrent] = useState(1);
  const [timeoutMinutes, setTimeoutMinutes] = useState(60);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const defaultDir = useCallback(() => {
    return getLastDir();
  }, [getLastDir]);

  useEffect(() => {
    Promise.resolve(call("config.get", { key: "defaultTimeout" }))
      .then((res) => { const v = (res as Record<string, unknown>)?.value; if (typeof v === "number") setTimeoutMinutes(v); })
      .catch(() => {});
  }, [call]);

  useEffect(() => {
    let idx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") { idx = i; break; }
    }
    setLastAssistantIdx(idx);
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Sync taskParams to edited fields when entering step 2
  useEffect(() => {
    if (taskParams && step === 2) {
      setEditedContent(taskParams.content);
      setEditedGoals([...taskParams.goals]);
      setEditedConditions([...taskParams.terminationConditions]);
    }
  }, [taskParams, step]);

  const handleSelectDir = () => {
    setShowDirInput(true);
  };

  const handleUseDefault = () => {
    const dir = defaultDir();
    setDirInput(dir);
    setWorkingDir(dir);
    saveDir(dir);
    startWizardSession(dir);
  };

  const handleBrowse = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected) {
        const dir = typeof selected === "string" ? selected : (selected as string[])[0];
        if (dir) {
          setDirInput(dir);
          setWorkingDir(dir);
          saveDir(dir);
          startWizardSession(dir);
          return;
        }
      }
      return;
    } catch { /* not Tauri, fall through */ }

    if ("showDirectoryPicker" in window) {
      try {
        const handle = await (window as unknown as { showDirectoryPicker: () => Promise<{ name: string }> }).showDirectoryPicker();
        if (handle?.name) {
          const dir = handle.name;
          setDirInput(dir);
          setDirError("");
          toast.info(`浏览器安全限制无法获取完整路径，请手动输入完整路径。目录名: ${dir}`);
          setShowDirInput(true);
          return;
        }
      } catch { /* user cancelled or not supported */ }
    }

    setShowDirInput(true);
  };

  const validateDir = (value: string) => {
    if (!value.trim()) {
      setDirError("目录路径不能为空");
      return false;
    }
    if (value.trim().length < 2) {
      setDirError("目录路径至少 2 个字符");
      return false;
    }
    if (!/^~?\/[\w\-./ ]+$/.test(value.trim()) && !/^[A-Za-z]:[\\/\w\-./ ]+$/.test(value.trim())) {
      setDirError("请输入有效的目录路径（如 ~/project、/home/user/project 或 C:\\Users\\project）");
      return false;
    }
    setDirError("");
    return true;
  };

  const confirmDir = () => {
    if (!validateDir(dirInput)) return;
    setWorkingDir(dirInput.trim());
    saveDir(dirInput.trim());
    startWizardSession(dirInput.trim());
    setShowDirInput(false);
  };

  const startWizardSession = async (dir: string) => {
    setIsStartingSession(true);
    try {
      const res = (await call("wizard.start", { workingDir: dir })) as { sessionId: string };
      setSessionId(res.sessionId);
      setStep(1);
    } catch (err) {
      toast.error(`启动向导失败: ${err}`);
    } finally {
      setIsStartingSession(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim()) {
      setInputError("消息不能为空");
      return;
    }
    if (input.trim().length < 2) {
      setInputError("消息至少 2 个字符");
      return;
    }
    if (isLoading) return;
    setInputError("");
    const userMsg = input;
    setInput("");
    addMessage({ role: "user", content: userMsg, timestamp: Date.now() });

    setIsLoading(true);
    try {
      const res = (await call("wizard.chat", {
        sessionId,
        message: userMsg,
      }, 180_000)) as { response: string; shouldExtractParams: boolean };

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
            }, 180_000)) as { response: string; shouldExtractParams: boolean };
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

  const doCreateRun = async (autoStart: boolean) => {
    const content = editedContent.trim();
    const goals = editedGoals.filter((g) => g.trim());
    const conditions = editedConditions.filter((c) => c.trim());

    if (!content) { toast.error("任务内容不能为空"); return; }
    if (goals.length === 0) { toast.error("至少需要一个目标"); return; }
    if (creating) return;

    setCreating(true);
    try {
      const run = (await call("run.create", {
        workingDir,
        goals,
        terminationConditions: conditions.length > 0 ? conditions : ["所有目标均已达成并验证通过"],
        autonomyLevel,
        maxConcurrentTasks: maxConcurrent,
        tasks: [{
          content,
          type: "user_defined",
          priority: 1,
          timeoutMinutes,
        }],
      })) as ExecutionRun;

      if (autoStart) {
        await call("task.start", { runId: run.id });
      }

      saveDir(workingDir);
      addTask(run);
      toast.success(autoStart ? "任务已创建并开始执行" : "任务创建成功");
      reset();
      navigate(`/evolution/${run.id}`);
    } catch (err) {
      toast.error(`创建失败: ${err instanceof Error ? err.message : err}`);
    } finally {
      setCreating(false);
    }
  };

  const handleConfirm = () => doCreateRun(false);
  const handleConfirmAndStart = () => doCreateRun(true);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getMessageId = (msg: typeof messages[0], idx: number) => {
    return `${msg.role}-${msg.timestamp}-${idx}`;
  };

  const handleTemplateSelect = (t: typeof BUILT_IN_TEMPLATES[number]) => {
    applyTemplate(t);
    setStep(2);
  };

  const renderStepIndicator = () => (
    <>
      {STEP_LABELS.map((label, i) => (
        <div key={i} className="flex items-center gap-1.5" role="tab"
          aria-selected={step === i}
          aria-current={step === i ? "step" : undefined}
          tabIndex={step === i ? 0 : -1}
          id={`wizard-step-${i}`}
          aria-controls={`wizard-panel-${i}`}
        >
          <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-all duration-300" style={{
            background: i < step ? "var(--green)" : i === step ? "var(--blue)" : "var(--bg-tertiary)",
            color: i <= step ? "#fff" : "var(--text-secondary)",
            animation: i === step ? "stepActiveGlow 2s ease-in-out infinite" : "none",
          }}>
            {i < step ? "✓" : i + 1}
          </div>
          <span className="text-xs font-medium" style={{ color: i <= step ? "var(--text-primary)" : "var(--text-secondary)" }}>{label}</span>
          {i < STEP_LABELS.length - 1 && (
            <div className="w-4 h-px" style={{ background: i < step ? "var(--green)" : "var(--border)" }} />
          )}
        </div>
      ))}
    </>
  );

  const renderEditableList = (
    items: string[],
    setItems: (items: string[]) => void,
    color: string,
    addLabel: string,
  ) => (
    <div className="space-y-1.5">
      {items.map((g, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-xs" style={{ color }}>•</span>
          <input
            value={g}
            onChange={(e) => {
              const next = [...items];
              next[i] = e.target.value;
              setItems(next);
            }}
            className="flex-1 px-2 py-1 rounded text-xs outline-none"
            style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
          />
          <button
            onClick={() => setItems(items.filter((_, j) => j !== i))}
            className="text-[10px] px-1"
            style={{ color: "var(--red)" }}
          >✕</button>
        </div>
      ))}
      <button
        onClick={() => setItems([...items, ""])}
        className="text-xs px-2 py-0.5 rounded"
        style={{ color: "var(--blue)", background: "rgba(77, 107, 254, 0.08)" }}
      >{addLabel}</button>
    </div>
  );

  return (
    <>
    <div className="flex-1 flex flex-col overflow-hidden" style={pageEnterStyle()}>
      <div
        className="px-6 py-4 border-b max-md:px-4 max-md:py-3"
        style={{ borderColor: "var(--border)", animation: "slideDown 0.3s ease-out" }}
      >
        <div className="flex items-center gap-3">
          <button onClick={() => {
            if (messages.length > 0 || step > 0) {
              setShowBackConfirm(true);
            } else {
              reset(); navigate("/");
            }
          }} className="text-xs px-2 py-1 rounded" style={{ color: "var(--text-secondary)" }} aria-label="返回">← 返回</button>
          <h2 className="text-sm font-bold">创建新任务</h2>
        </div>

        {/* Mode switcher */}
        <div className="flex gap-1 mt-3 p-1 rounded-lg max-w-xs" style={{ background: "var(--bg-tertiary)" }}>
          <button
            onClick={() => setMode("quick")}
            className="flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200"
            style={{
              background: mode === "quick" ? "var(--bg-primary)" : "transparent",
              color: mode === "quick" ? "var(--text-primary)" : "var(--text-secondary)",
              boxShadow: mode === "quick" ? "0 1px 3px rgba(0,0,0,0.2)" : "none",
            }}
          >快速创建</button>
          <button
            onClick={() => setMode("wizard")}
            className="flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200"
            style={{
              background: mode === "wizard" ? "var(--bg-primary)" : "transparent",
              color: mode === "wizard" ? "var(--text-primary)" : "var(--text-secondary)",
              boxShadow: mode === "wizard" ? "0 1px 3px rgba(0,0,0,0.2)" : "none",
            }}
          >AI 对话创建</button>
        </div>

        {mode === "wizard" && (
        <div className="flex gap-2 mt-3 max-md:hidden" role="tablist" aria-label="任务创建步骤">
          {renderStepIndicator()}
        </div>
        )}
      </div>

      {mode === "quick" ? (
        <QuickCreate />
      ) : (<>
      <div
        className="hidden max-md:flex fixed bottom-0 left-0 right-0 z-50 px-4 py-3 justify-around"
        role="tablist"
        aria-label="任务创建步骤"
        style={{ background: "var(--bg-primary)", borderTop: "1px solid var(--border)" }}
      >
        {renderStepIndicator()}
      </div>

      {step === 0 && (
        <div className="flex-1 flex items-center justify-center max-md:pb-16" role="tabpanel"
          id="wizard-panel-0" aria-labelledby="wizard-step-0"
          style={{ animation: "fadeIn 0.4s ease-out" }}>
          {isStartingSession ? (
            <div className="text-center">
              <div className="w-48 h-24 mx-auto rounded-lg mb-3" style={{ background: "var(--bg-tertiary)", animation: "pulse 1.5s ease-in-out infinite" }} />
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>正在初始化...</p>
            </div>
          ) : (
          <div className="text-center px-4 max-w-md w-full">
            <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>选择你的项目文件夹</p>

            <div className="glass-card p-4 mb-4 text-left">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>默认目录</span>
                {getLastDir() !== "~/ai-workspace" && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(77, 107, 254, 0.15)", color: "var(--blue)" }}>上次使用</span>
                )}
              </div>
              <p className="text-sm mb-3 font-mono" style={{ color: "var(--green)" }}>{defaultDir()}</p>
              <button onClick={handleUseDefault} className="w-full px-4 py-2 rounded text-xs font-semibold" style={{ background: "var(--green)", color: "#fff" }}>使用默认位置</button>
            </div>

            {!showDirInput ? (
              <div className="flex gap-3">
                <button onClick={handleBrowse} className="flex-1 px-4 py-3 rounded text-sm font-semibold" style={{ background: "var(--blue)", color: "#fff" }}>选择文件夹</button>
                <button onClick={handleSelectDir} className="flex-1 px-4 py-3 rounded text-sm max-md:hidden" style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>输入路径</button>
              </div>
            ) : (
              <div className="flex gap-2 justify-center flex-wrap">
                <div className="flex flex-col flex-1 max-md:w-full">
                  <input
                    type="text"
                    value={dirInput}
                    onChange={(e) => { setDirInput(e.target.value); validateDir(e.target.value); }}
                    onKeyDown={(e) => e.key === "Enter" && confirmDir()}
                    placeholder="/path/to/project"
                    required
                    minLength={2}
                    className="w-full px-3 py-2 rounded text-xs outline-none"
                    style={{
                      background: "var(--bg-tertiary)", color: "var(--text-primary)",
                      border: dirError ? "1px solid var(--red)" : "1px solid var(--border)",
                    }}
                    autoFocus
                    aria-invalid={!!dirError}
                    aria-describedby={dirError ? "dir-error" : undefined}
                  />
                  {dirError && (
                    <p id="dir-error" className="text-xs mt-1 text-left" style={{ color: "var(--red)" }} role="alert">{dirError}</p>
                  )}
                </div>
                <button onClick={confirmDir} className="px-4 py-2 rounded text-xs font-semibold shrink-0" style={{ background: "var(--green)", color: "#fff" }}>确认</button>
                <button onClick={() => setShowDirInput(false)} className="px-3 py-2 rounded text-xs shrink-0" style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}>取消</button>
              </div>
            )}

            {workingDir && <p className="text-xs mt-3" style={{ color: "var(--green)" }}>已选择: {workingDir}</p>}
          </div>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="flex-1 flex flex-col overflow-hidden max-md:pb-16" role="tabpanel"
          id="wizard-panel-1" aria-labelledby="wizard-step-1"
          style={{ animation: "fadeIn 0.3s ease-out" }}>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-10">
                <p className="text-xs mb-4" style={{ color: "var(--text-secondary)" }}>告诉我你想要完成什么，我会帮你规划。</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {BUILT_IN_TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => handleTemplateSelect(t)}
                      className="px-3 py-2 rounded-lg text-xs flex items-center gap-1.5 transition-all duration-200"
                      style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
                    >
                      <span>{t.icon}</span>
                      <span>{t.label}</span>
                    </button>
                  ))}
                </div>
                <p className="text-[10px] mt-3" style={{ color: "var(--text-muted)" }}>选择模板可跳过对话，直接确认任务</p>
              </div>
            )}
            {messages.map((msg, i) => {
              const isAssistant = msg.role === "assistant";
              const isTypingTarget = isAssistant && i === lastAssistantIdx && !isLoading;
              const mdHtml = isAssistant && !isTypingTarget
                ? (marked.parse(msg.content, { async: false }) as string)
                : "";
              return (
                <div
                  key={getMessageId(msg, i)}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  style={{ animation: "slideUp 0.3s ease-out" }}
                >
                  <div className={`max-w-[80%] px-3 py-2 rounded-lg text-xs ${isAssistant ? "glass-card-sm" : ""}`} style={{
                    background: msg.role === "user" ? "var(--blue)" : undefined,
                    color: msg.role === "user" ? "#fff" : "var(--text-primary)",
                  }}>
                    {msg.role === "user" && <span className="whitespace-pre-wrap">{msg.content}</span>}
                    {isTypingTarget && <TypewriterText text={msg.content} />}
                    {isAssistant && !isTypingTarget && (
                      <span className="markdown-body text-xs" dangerouslySetInnerHTML={{ __html: mdHtml }} />
                    )}
                  </div>
                </div>
              );
            })}
            {isLoading && (
              <div className="flex justify-start" style={{ animation: "slideUp 0.25s ease-out" }}>
                <div className="glass-card-sm px-3 py-2 rounded-lg text-xs flex items-center gap-2">
                  <Spinner size="sm" />
                  <span style={{ color: "var(--text-secondary)" }}>AI 正在思考</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          <div className="p-4 border-t max-md:p-3" style={{ borderColor: "var(--border)" }}>
            <div className="flex gap-2">
              <div className="flex-1 flex flex-col">
                <textarea
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    if (inputError) {
                      if (e.target.value.trim().length >= 2) setInputError("");
                      else if (!e.target.value.trim()) setInputError("消息不能为空");
                    }
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="你想做什么？"
                  disabled={isLoading}
                  required
                  minLength={2}
                  rows={5}
                  className="w-full px-5 py-4 rounded-xl text-base outline-none resize-none leading-relaxed"
                  style={{
                    background: "var(--bg-tertiary)", color: "var(--text-primary)",
                    border: inputError ? "2px solid var(--red)" : "2px solid var(--blue)",
                    boxShadow: "0 0 12px rgba(77, 107, 254, 0.15), 0 4px 16px rgba(0, 0, 0, 0.3)",
                    transition: "border-color 0.2s, box-shadow 0.2s",
                  }}
                  aria-invalid={!!inputError}
                  aria-describedby={inputError ? "chat-error" : undefined}
                />
                <div className="flex items-center justify-between mt-1">
                  {inputError ? (
                    <p id="chat-error" className="text-xs" style={{ color: "var(--red)" }} role="alert">{inputError}</p>
                  ) : (
                    <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>Enter 发送 · Shift+Enter 换行</span>
                  )}
                  <button onClick={handleSend} disabled={isLoading}
                    className="px-6 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50" style={{ background: "var(--green)", color: "#fff" }}>
                    发送
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 2 && taskParams && (
        <div className="flex-1 overflow-y-auto p-6 max-md:p-4 max-md:pb-20" role="tabpanel"
          id="wizard-panel-2" aria-labelledby="wizard-step-2"
          style={{ animation: "fadeIn 0.3s ease-out" }}>
          <div
            className="glass-card p-4"
            style={{ animation: "slideUp 0.35s ease-out" }}
          >
            <h3 className="text-sm font-bold mb-3">确认任务</h3>
            <div className="space-y-3 text-xs">
              <div>
                <span style={{ color: "var(--text-secondary)" }}>项目:</span>
                <span className="ml-2" style={{ color: "var(--blue)" }}>{workingDir}</span>
              </div>

              {/* Editable content */}
              <div>
                <label className="block mb-1 font-bold" style={{ color: "var(--text-secondary)" }}>任务内容</label>
                <textarea
                  value={editedContent}
                  onChange={(e) => setEditedContent(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 rounded text-xs outline-none resize-none"
                  style={{
                    background: "var(--bg-tertiary)", color: "var(--text-primary)",
                    border: "1px solid var(--border)",
                  }}
                />
              </div>

              {/* Editable goals */}
              <div>
                <label className="block mb-1 font-bold" style={{ color: "var(--text-secondary)" }}>目标</label>
                {renderEditableList(editedGoals, setEditedGoals, "var(--green)", "+ 添加目标")}
              </div>

              {/* Editable conditions (always visible) */}
              <div>
                <label className="block mb-1 font-bold" style={{ color: "var(--text-secondary)" }}>完成标准</label>
                {renderEditableList(editedConditions, setEditedConditions, "var(--yellow)", "+ 添加条件")}
              </div>

              {/* Autonomy Level */}
              <div>
                <label className="block mb-1 font-bold" style={{ color: "var(--text-secondary)" }}>自主级别</label>
                <div className="flex gap-1.5">
                  {([
                    { value: "supervised", label: "受监督" },
                    { value: "assisted", label: "辅助" },
                    { value: "autonomous", label: "自主" },
                  ] as const).map((opt) => (
                    <button key={opt.value} onClick={() => setAutonomyLevel(opt.value)}
                      className="flex-1 px-2 py-1.5 rounded text-xs font-medium"
                      style={{
                        background: autonomyLevel === opt.value ? "var(--blue)" : "var(--bg-tertiary)",
                        color: autonomyLevel === opt.value ? "#fff" : "var(--text-secondary)",
                        border: autonomyLevel === opt.value ? "1px solid var(--blue)" : "1px solid var(--border)",
                      }}
                    >{opt.label}</button>
                  ))}
                </div>
              </div>

              {/* Max Concurrent Tasks */}
              <div>
                <label className="block mb-1 font-bold" style={{ color: "var(--text-secondary)" }}>并发任务数: {maxConcurrent}</label>
                <input type="range" min="1" max="5" value={maxConcurrent}
                  onChange={(e) => setMaxConcurrent(Number(e.target.value))}
                  className="w-full"
                />
              </div>

              {/* Timeout */}
              <div>
                <label className="block mb-1 font-bold" style={{ color: "var(--text-secondary)" }}>超时: {timeoutMinutes} 分钟</label>
                <input type="range" min="5" max="180" step="5" value={timeoutMinutes}
                  onChange={(e) => setTimeoutMinutes(Number(e.target.value))}
                  className="w-full"
                />
              </div>
            </div>

            {errors.length > 0 && (
              <div className="mt-4 p-3 rounded" style={{ background: "rgba(239, 68, 68, 0.1)" }}>
                {errors.map((e, i) => <p key={i} className="text-xs" style={{ color: "var(--red)" }}>{e}</p>)}
              </div>
            )}
          </div>
          <div className="flex gap-3 mt-6">
            <button onClick={() => setStep(1)} className="px-4 py-2 rounded text-xs" style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}>继续对话</button>
            <button onClick={handleConfirm} disabled={creating} className="px-6 py-3 rounded text-sm font-semibold disabled:opacity-50" style={{ background: "var(--blue)", color: "#fff" }}>{creating ? "创建中..." : "创建"}</button>
            <button onClick={handleConfirmAndStart} disabled={creating} className="px-6 py-3 rounded text-sm font-semibold disabled:opacity-50" style={{ background: "var(--green)", color: "#fff" }}>{creating ? "创建中..." : "创建并开始"}</button>
          </div>
        </div>
      )}
      </>
      )}
    </div>
      <ConfirmDialog
        open={showBackConfirm}
        title="放弃当前进度？"
        message="你正在编辑的任务内容将会丢失，确定要返回吗？"
        confirmLabel="放弃并返回"
        variant="danger"
        onConfirm={() => { setShowBackConfirm(false); reset(); navigate("/"); }}
        onCancel={() => setShowBackConfirm(false)}
      />
    </>
  );
}

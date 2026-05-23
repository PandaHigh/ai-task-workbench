import { useWizardStore } from "../../stores/wizard-store";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { useTaskStore } from "../../stores/task-store";
import { useEngine } from "../../hooks/useEngine";
import type { ExecutionRun } from "@ai-workbench/shared";

export function TaskWizard() {
  const navigate = useNavigate();
  const { call } = useEngine();
  const {
    step, workingDir, messages, taskParams, errors,
    setStep, setWorkingDir, addMessage, setTaskParams, setValidation, reset,
  } = useWizardStore();
  const addTask = useTaskStore((s) => s.addTask);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSelectDir = () => {
    const dir = prompt("请输入项目目录路径:");
    if (dir) {
      setWorkingDir(dir);
      setStep(1);
    }
  };

  const handleSend = () => {
    if (!input.trim()) return;
    addMessage({ role: "user", content: input, timestamp: Date.now() });

    setIsLoading(true);
    setTimeout(() => {
      const response = generateBrainstormResponse(input, messages);
      addMessage({ role: "assistant", content: response, timestamp: Date.now() });
      setIsLoading(false);

      if (messages.length >= 4) {
        const params = extractParams(messages, input);
        setTaskParams(params);
        setStep(2);
      }
    }, 300);

    setInput("");
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
      reset();
      navigate(`/evolution/${run.id}`);
    } catch (err) {
      alert(`创建失败: ${err instanceof Error ? err.message : err}`);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-6 py-4 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { reset(); navigate("/"); }}
            className="text-xs px-2 py-1 rounded"
            style={{ color: "var(--text-secondary)" }}
          >
            ← 返回
          </button>
          <h2 className="text-sm font-bold">新建 AI 任务</h2>
        </div>
        <div className="flex gap-2 mt-3">
          {["选择目录", "定义任务", "确认参数"].map((label, i) => (
            <div key={i} className="flex items-center gap-1">
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center text-xs"
                style={{
                  background: i <= step ? "var(--blue)" : "var(--bg-tertiary)",
                  color: i <= step ? "#0d1117" : "var(--text-secondary)",
                }}
              >
                {i + 1}
              </div>
              <span className="text-xs" style={{
                color: i <= step ? "var(--text-primary)" : "var(--text-secondary)",
              }}>
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {step === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
              选择 AI 任务的工作目录
            </p>
            <button
              onClick={handleSelectDir}
              className="px-6 py-3 rounded text-sm font-semibold"
              style={{ background: "var(--blue)", color: "#0d1117" }}
            >
              输入目录路径
            </button>
            {workingDir && (
              <p className="text-xs mt-2" style={{ color: "var(--green)" }}>
                已选择: {workingDir}
              </p>
            )}
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="flex-1 flex flex-col">
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-10">
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  告诉我你想完成什么任务？我会帮你梳理目标、终止条件和后续行动。
                </p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className="max-w-[80%] px-3 py-2 rounded-lg text-xs terminal-line"
                  style={{
                    background: msg.role === "user" ? "var(--blue)" : "var(--bg-tertiary)",
                    color: msg.role === "user" ? "#0d1117" : "var(--text-primary)",
                  }}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="px-3 py-2 rounded-lg text-xs cursor-blink" style={{ background: "var(--bg-tertiary)" }}>
                  <span style={{ color: "var(--text-secondary)" }}>思考中</span>
                </div>
              </div>
            )}
          </div>
          <div className="p-4 border-t" style={{ borderColor: "var(--border)" }}>
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="描述你的任务..."
                className="flex-1 px-3 py-2 rounded text-xs outline-none"
                style={{
                  background: "var(--bg-tertiary)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border)",
                }}
              />
              <button
                onClick={handleSend}
                className="px-4 py-2 rounded text-xs font-semibold"
                style={{ background: "var(--green)", color: "#0d1117" }}
              >
                发送
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 2 && taskParams && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="rounded-lg border p-4" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
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
                  {taskParams.goals.map((g, i) => (
                    <li key={i} style={{ color: "var(--green)" }}>• {g}</li>
                  ))}
                </ul>
              </div>
              <div>
                <span style={{ color: "var(--text-secondary)" }}>终止条件:</span>
                <ul className="mt-1 space-y-1">
                  {taskParams.terminationConditions.map((c, i) => (
                    <li key={i} style={{ color: "var(--yellow)" }}>• {c}</li>
                  ))}
                </ul>
              </div>
            </div>
            {errors.length > 0 && (
              <div className="mt-4 p-3 rounded" style={{ background: "rgba(248, 81, 73, 0.1)" }}>
                {errors.map((e, i) => (
                  <p key={i} className="text-xs" style={{ color: "var(--red)" }}>{e}</p>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-3 mt-6">
            <button
              onClick={() => setStep(1)}
              className="px-4 py-2 rounded text-xs"
              style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
            >
              返回修改
            </button>
            <button
              onClick={handleConfirm}
              className="px-6 py-2 rounded text-xs font-semibold"
              style={{ background: "var(--green)", color: "#0d1117" }}
            >
              确认并开始执行
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function generateBrainstormResponse(input: string, history: Array<{role: string; content: string}>): string {
  const userMessages = history.filter((m) => m.role === "user");

  if (userMessages.length === 0) {
    return `好的，"${input}" 听起来是个不错的任务方向。\n\n请进一步描述：\n1. 这个任务的具体目标是什么？\n2. 你希望什么时候算完成？\n3. 完成后需要做什么？`;
  }
  if (userMessages.length === 1) {
    return `理解了。让我确认一下目标：\n\n关于终止条件，请告诉我：\n- 什么样的结果算"完成"？\n- 有没有时间或预算限制？`;
  }
  return `很好，我已经收集了足够的信息。让我整理一下任务参数...\n\n请查看参数确认页面。`;
}

function extractParams(messages: Array<{role: string; content: string}>, lastInput: string): {
  content: string;
  goals: string[];
  terminationConditions: string[];
  postCompletionAction: string;
} {
  const userTexts = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content);
  userTexts.push(lastInput);

  return {
    content: userTexts[0] || "未命名任务",
    goals: userTexts.length > 1 ? [userTexts[1]] : ["完成用户描述的任务"],
    terminationConditions: userTexts.length > 2
      ? [userTexts[2]]
      : ["任务目标全部达成"],
    postCompletionAction: "无",
  };
}

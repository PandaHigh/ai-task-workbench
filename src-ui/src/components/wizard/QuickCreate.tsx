import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useEngine } from "../../hooks/useEngine";
import { useTaskStore } from "../../stores/task-store";
import { usePersistedDir } from "../../hooks/usePersistedDir";
import { useToast } from "../common/Toast";
import { BUILT_IN_TEMPLATES, type TaskTemplate } from "../../lib/task-templates";
import { pageEnterStyle } from "../../hooks/useAnimations";
import type { ExecutionRun, UserTaskTemplate } from "@ai-workbench/shared";
import { open } from "@tauri-apps/plugin-dialog";

export function QuickCreate() {
  const navigate = useNavigate();
  const { connected, call } = useEngine();
  const addTask = useTaskStore((s) => s.addTask);
  const toast = useToast();
  const { getLastDir, saveDir } = usePersistedDir();

  const [workingDir, setWorkingDir] = useState(getLastDir);
  const [content, setContent] = useState("");
  const [goalsText, setGoalsText] = useState("");
  const [priority, setPriority] = useState(5);
  const [timeoutMinutes, setTimeoutMinutes] = useState(60);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [userTemplates, setUserTemplates] = useState<UserTaskTemplate[]>([]);
  const [creating, setCreating] = useState(false);
  const [autonomyLevel, setAutonomyLevel] = useState<"assisted" | "supervised" | "autonomous">("assisted");
  const [maxConcurrent, setMaxConcurrent] = useState(1);
  const [dirError, setDirError] = useState("");
  const [contentError, setContentError] = useState("");
  const [showDirInput, setShowDirInput] = useState(false);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    (async () => {
      try {
        const list = (await call("template.list", {}) as UserTaskTemplate[] | null) ?? [];
        if (!cancelled) setUserTemplates(list);
      } catch { /* ignore */ }
      try {
        const res = await call("config.get", { key: "defaultTimeout" }) as Record<string, unknown>;
        if (!cancelled && typeof res?.value === "number") setTimeoutMinutes(res.value);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [connected]);

  const validateDir = (value: string) => {
    if (!value.trim()) { setDirError("目录路径不能为空"); return false; }
    if (value.trim().length < 2) { setDirError("目录路径至少 2 个字符"); return false; }
    if (!/^~?\/[\w\-./ ]+$/.test(value.trim()) && !/^[A-Za-z]:[\\/\w\-./ ]+$/.test(value.trim())) {
      setDirError("请输入有效的目录路径");
      return false;
    }
    setDirError("");
    return true;
  };

  const handleBrowse = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected) {
        const dir = typeof selected === "string" ? selected : (selected as string[])[0];
        if (dir) { setWorkingDir(dir); saveDir(dir); setDirError(""); return; }
      }
      return;
    } catch { /* not Tauri */ }
    setShowDirInput(true);
  };

  const applyBuiltInTemplate = useCallback((t: TaskTemplate) => {
    setSelectedTemplate(t.id);
    setContent(t.content);
    setGoalsText(t.goals.join(", "));
    setPriority(5);
    setTimeoutMinutes(60);
    setContentError("");
  }, []);

  const applyUserTemplate = useCallback((t: UserTaskTemplate) => {
    setSelectedTemplate(t.id);
    setContent(t.content);
    setPriority(t.priority);
    setTimeoutMinutes(t.timeoutMinutes);
    setContentError("");
  }, []);

  const handleCreate = async (autoStart: boolean) => {
    if (!validateDir(workingDir)) return;
    if (!content.trim()) { setContentError("请填写任务描述"); return; }
    if (content.trim().length < 2) { setContentError("任务描述至少 2 个字符"); return; }
    if (creating) return;

    setCreating(true);
    setContentError("");
    try {
      const goals = goalsText.trim()
        ? goalsText.split(/[,，]/).map((g) => g.trim()).filter(Boolean)
        : [`完成: ${content.trim()}`];

      const conditions = selectedTemplate
        ? BUILT_IN_TEMPLATES.find((t) => t.id === selectedTemplate)?.terminationConditions ?? ["所有目标均已达成"]
        : ["所有目标均已达成并验证通过"];

      const run = (await call("run.create", {
        workingDir: workingDir.trim(),
        goals,
        terminationConditions: conditions,
        autonomyLevel,
        maxConcurrentTasks: maxConcurrent,
      })) as ExecutionRun;

      if (autoStart) {
        await call("task.start", { runId: run.id });
      }

      saveDir(workingDir.trim());
      addTask(run);
      toast.success(autoStart ? "任务已创建并开始执行" : "任务创建成功");
      navigate(`/evolution/${run.id}`);
    } catch (err) {
      toast.error(`创建失败: ${err instanceof Error ? err.message : err}`);
    } finally {
      setCreating(false);
    }
  };

  const lastDir = getLastDir();

  return (
    <div className="flex-1 overflow-y-auto p-6 max-md:p-4" style={pageEnterStyle()}>
      <div className="max-w-lg mx-auto space-y-5">

        {/* Working directory */}
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>项目目录</h3>
            <button onClick={handleBrowse} className="text-[10px] px-2 py-0.5 rounded" style={{ color: "var(--blue)", background: "rgba(77, 107, 254, 0.1)" }}>浏览</button>
          </div>
          {showDirInput ? (
            <div className="flex gap-2">
              <input
                value={workingDir}
                onChange={(e) => { setWorkingDir(e.target.value); if (dirError) validateDir(e.target.value); }}
                onBlur={() => validateDir(workingDir)}
                className="flex-1 px-3 py-2 rounded text-xs outline-none"
                style={{
                  background: "var(--bg-tertiary)", color: "var(--text-primary)",
                  border: dirError ? "1px solid var(--red)" : "1px solid var(--border)",
                }}
                placeholder="/path/to/project"
              />
              <button onClick={() => { if (validateDir(workingDir)) { saveDir(workingDir); setShowDirInput(false); } }}
                className="px-3 py-2 rounded text-xs" style={{ background: "var(--green)", color: "#fff" }}>确定</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono flex-1 px-3 py-2 rounded" style={{ background: "var(--bg-tertiary)", color: "var(--green)" }}>
                {workingDir}
              </span>
              <button onClick={() => setShowDirInput(true)} className="text-xs underline" style={{ color: "var(--text-secondary)" }}>修改</button>
            </div>
          )}
          {dirError && <p className="text-xs mt-1" style={{ color: "var(--red)" }} role="alert">{dirError}</p>}
          {lastDir !== "~/ai-workspace" && lastDir !== workingDir && (
            <button onClick={() => { setWorkingDir(lastDir); saveDir(lastDir); }} className="text-[10px] mt-1" style={{ color: "var(--text-secondary)" }}>
              上次使用: {lastDir}
            </button>
          )}
        </div>

        {/* Templates */}
        <div>
          <h3 className="text-xs font-bold mb-2" style={{ color: "var(--text-secondary)" }}>快速模板</h3>
          <div className="flex flex-wrap gap-2">
            {BUILT_IN_TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => applyBuiltInTemplate(t)}
                className="px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition-all duration-200"
                style={{
                  background: selectedTemplate === t.id ? "rgba(77, 107, 254, 0.15)" : "var(--bg-tertiary)",
                  color: "var(--text-primary)",
                  border: selectedTemplate === t.id ? "1px solid var(--blue)" : "1px solid var(--border)",
                }}
              >
                <span>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
            {userTemplates.map((t) => (
              <button
                key={t.id}
                onClick={() => applyUserTemplate(t)}
                className="px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition-all duration-200"
                style={{
                  background: selectedTemplate === t.id ? "rgba(77, 107, 254, 0.15)" : "var(--bg-tertiary)",
                  color: "var(--text-primary)",
                  border: selectedTemplate === t.id ? "1px solid var(--blue)" : "1px solid var(--border)",
                }}
              >
                <span>{t.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Task description */}
        <div>
          <h3 className="text-xs font-bold mb-2" style={{ color: "var(--text-secondary)" }}>任务描述</h3>
          <textarea
            value={content}
            onChange={(e) => { setContent(e.target.value); if (contentError && e.target.value.trim().length >= 2) setContentError(""); }}
            placeholder="你想让 AI 做什么？"
            rows={4}
            className="w-full px-4 py-3 rounded-xl text-sm outline-none resize-none leading-relaxed"
            style={{
              background: "var(--bg-tertiary)", color: "var(--text-primary)",
              border: contentError ? "2px solid var(--red)" : "2px solid var(--border)",
              transition: "border-color 0.2s",
            }}
          />
          {contentError && <p className="text-xs mt-1" style={{ color: "var(--red)" }} role="alert">{contentError}</p>}
        </div>

        {/* Goals (optional) */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>目标</h3>
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>可选，逗号分隔</span>
          </div>
          <input
            value={goalsText}
            onChange={(e) => setGoalsText(e.target.value)}
            placeholder={goalsText ? undefined : "功能已实现, 测试通过, 代码已提交"}
            className="w-full px-3 py-2 rounded text-xs outline-none"
            style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
          />
        </div>

        {/* Priority & Timeout */}
        <div className="glass-card p-4">
          <div className="flex items-center gap-6 text-xs flex-wrap">
            <div className="flex items-center gap-2">
              <span className="font-bold" style={{ color: "var(--text-secondary)" }}>优先级</span>
              <select
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                className="px-2 py-1 rounded text-xs outline-none"
                style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
              >
                {Array.from({ length: 10 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>P{i + 1}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold" style={{ color: "var(--text-secondary)" }}>超时</span>
              <select
                value={timeoutMinutes}
                onChange={(e) => setTimeoutMinutes(Number(e.target.value))}
                className="px-2 py-1 rounded text-xs outline-none"
                style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
              >
                {[15, 30, 60, 90, 120, 180].map((v) => (
                  <option key={v} value={v}>{v}分钟</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold" style={{ color: "var(--text-secondary)" }}>自主级别</span>
              <select
                value={autonomyLevel}
                onChange={(e) => setAutonomyLevel(e.target.value as typeof autonomyLevel)}
                className="px-2 py-1 rounded text-xs outline-none"
                style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
              >
                <option value="supervised">受监督</option>
                <option value="assisted">辅助</option>
                <option value="autonomous">自主</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold" style={{ color: "var(--text-secondary)" }}>并发</span>
              <input type="range" min="1" max="5" value={maxConcurrent}
                onChange={(e) => setMaxConcurrent(Number(e.target.value))}
                className="w-16"
              />
              <span style={{ color: "var(--text-primary)" }}>{maxConcurrent}</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={() => handleCreate(false)}
            disabled={creating}
            className="flex-1 px-6 py-3 rounded-lg text-sm font-semibold disabled:opacity-50"
            style={{ background: "var(--blue)", color: "#fff" }}
          >
            {creating ? "创建中..." : "创建任务"}
          </button>
          <button
            onClick={() => handleCreate(true)}
            disabled={creating}
            className="flex-1 px-6 py-3 rounded-lg text-sm font-semibold disabled:opacity-50"
            style={{ background: "var(--green)", color: "#fff" }}
          >
            {creating ? "创建中..." : "创建并开始"}
          </button>
        </div>

        <p className="text-[10px] text-center" style={{ color: "var(--text-muted)" }}>
          "创建" 仅创建任务 · "创建并开始" 会自动启动执行
        </p>
      </div>
    </div>
  );
}

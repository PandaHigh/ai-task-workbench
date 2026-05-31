import { useEngine } from "../../hooks/useEngine";
import { useState, useEffect, useCallback } from "react";
import { Skeleton } from "../common/Skeleton";
import { useToast } from "../common/Toast";
import { pageEnterStyle } from "../../hooks/useAnimations";
import { SkillsManager } from "./SkillsManager";
import { PluginManager } from "./PluginManager";
import { ProfileManager } from "./ProfileManager";
import { ScheduleManager } from "./ScheduleManager";
import type { UserTaskTemplate } from "@ai-workbench/shared";

interface OrigValues {
  qualityThreshold: number;
  defaultTimeout: number;
  claudePath: string;
}

const CONSTRAINTS = {
  qualityThreshold: { min: 0, max: 1, step: 0.05, label: "质量要求" },
  defaultTimeout: { min: 5, max: 180, step: 5, label: "每个任务最长用时" },
} as const;

function validateNumber(value: number, min: number, max: number, label: string): string {
  if (Number.isNaN(value)) return `${label}必须是有效数字`;
  if (value < min) return `${label}不能低于 ${min}`;
  if (value > max) return `${label}不能超过 ${max}`;
  return "";
}

export function SettingsPage() {
  const { connected, call } = useEngine();
  const toast = useToast();
  const [qualityThreshold, setQualityThreshold] = useState(0.6);
  const [defaultTimeout, setDefaultTimeout] = useState(60);
  const [claudePath, setClaudePath] = useState("claude");
  const [claudePathError, setClaudePathError] = useState("");
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [origValues, setOrigValues] = useState<OrigValues | null>(null);
  const [publicUrl, setPublicUrl] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isDirty = origValues != null && (
    origValues.qualityThreshold !== qualityThreshold
    || origValues.defaultTimeout !== defaultTimeout
    || origValues.claudePath !== claudePath
  );

  const qtError = validateNumber(qualityThreshold, CONSTRAINTS.qualityThreshold.min, CONSTRAINTS.qualityThreshold.max, CONSTRAINTS.qualityThreshold.label);
  const dtError = validateNumber(defaultTimeout, CONSTRAINTS.defaultTimeout.min, CONSTRAINTS.defaultTimeout.max, CONSTRAINTS.defaultTimeout.label);

  const validateClaudePath = useCallback((value: string) => {
    if (!value.trim()) {
      setClaudePathError("请填写 AI 程序位置");
      return false;
    }
    if (value.trim().length < 1) {
      setClaudePathError("路径至少 1 个字符");
      return false;
    }
    setClaudePathError("");
    return true;
  }, []);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;

    const load = async () => {
      const [qtRes, dtRes, cpRes, puRes] = await Promise.allSettled([
        call("config.get", { key: "qualityThreshold" }),
        call("config.get", { key: "defaultTimeout" }),
        call("config.get", { key: "claudePath" }),
        call("config.get", { key: "publicUrl" }),
      ]);

      if (cancelled) return;

      const qt = qtRes.status === "fulfilled" ? Number((qtRes.value as Record<string, unknown>)?.value ?? 0.6) : 0.6;
      const dt = dtRes.status === "fulfilled" ? Number((dtRes.value as Record<string, unknown>)?.value ?? 60) : 60;
      const cpRaw = cpRes.status === "fulfilled" ? (cpRes.value as Record<string, unknown>)?.value : null;
      const cp = cpRaw ? String(cpRaw) : "claude";
      const puRaw = puRes.status === "fulfilled" ? (puRes.value as Record<string, unknown>)?.value : null;
      const pu = puRaw ? String(puRaw) : "";

      if (qtRes.status === "rejected") toast.error("加载质量设置失败");
      if (dtRes.status === "rejected") toast.error("加载超时设置失败");
      if (cpRes.status === "rejected") toast.error("加载 AI 路径失败");

      setQualityThreshold(qt);
      setDefaultTimeout(dt);
      setClaudePath(cp);
      setPublicUrl(pu);
      setOrigValues({ qualityThreshold: qt, defaultTimeout: dt, claudePath: cp });
      setLoaded(true);
    };
    load();
    return () => { cancelled = true; };
  }, [connected]);

  const handleSave = async () => {
    if (qtError || dtError) {
      toast.error("请修正验证错误后再保存");
      return;
    }
    if (!validateClaudePath(claudePath)) return;
    try {
      await call("config.set", { key: "qualityThreshold", value: qualityThreshold });
      await call("config.set", { key: "defaultTimeout", value: defaultTimeout });
      await call("config.set", { key: "claudePath", value: claudePath });
      await call("config.set", { key: "publicUrl", value: publicUrl });
      setOrigValues({ qualityThreshold, defaultTimeout, claudePath });
      setSaved(true);
      toast.success("设置已保存");
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      toast.error(`保存失败: ${err instanceof Error ? err.message : err}`);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 max-md:p-4" style={pageEnterStyle()}>
      <h2 className="text-lg font-semibold mb-6 max-md:mb-4" style={{ color: "var(--text-primary)" }}>设置</h2>

      {!loaded ? (
        <div className="max-w-lg space-y-6">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} variant="card" height={80} />
          ))}
        </div>
      ) : (
      <div className="max-w-lg space-y-6">
        {/* Connection status */}
        <div className="glass-card p-4">
          <h3 className="text-xs font-bold mb-3" style={{ color: "var(--text-secondary)" }}>连接状态</h3>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ background: connected ? "var(--green)" : "var(--red)" }} />
            <span className="text-xs" style={{ color: connected ? "var(--green)" : "var(--red)" }}>
              {connected ? "已连接" : "未连接"}
            </span>
          </div>
        </div>

        {/* Quality threshold */}
        <div className="glass-card p-4">
          <h3 className="text-xs font-bold mb-3" style={{ color: "var(--text-secondary)" }}>质量要求（默认值）</h3>
          <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
            创建任务时的默认质量分数。当前: {(qualityThreshold * 100).toFixed(0)}%
          </p>
          <input type="range" min="0" max="100" value={qualityThreshold * 100}
            onChange={(e) => setQualityThreshold(Number(e.target.value) / 100)}
            aria-label={`质量要求: 当前 ${(qualityThreshold * 100).toFixed(0)}%，范围 0% 到 100%`}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(qualityThreshold * 100)}
            className="w-full" />
          <div className="flex items-center gap-2 mt-2">
            <input type="number" min={CONSTRAINTS.qualityThreshold.min} max={CONSTRAINTS.qualityThreshold.max}
              step={CONSTRAINTS.qualityThreshold.step}
              value={qualityThreshold}
              onChange={(e) => setQualityThreshold(Number(e.target.value))}
              className="w-20 px-2 py-1 rounded text-xs outline-none"
              style={{
                background: "var(--bg-tertiary)", color: "var(--text-primary)",
                border: qtError ? "1px solid var(--red)" : "1px solid var(--border)",
              }}
              aria-label="质量要求数值输入"
            />
            {qtError && <span className="text-xs" style={{ color: "var(--red)" }} role="alert">{qtError}</span>}
          </div>
        </div>

        {/* Default timeout */}
        <div className="glass-card p-4">
          <h3 className="text-xs font-bold mb-3" style={{ color: "var(--text-secondary)" }}>任务默认超时</h3>
          <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
            创建任务时的默认超时时间。当前: {defaultTimeout} 分钟
          </p>
          <input type="range" min="5" max="180" value={defaultTimeout}
            onChange={(e) => setDefaultTimeout(Number(e.target.value))}
            aria-label={`每个任务最长用时: 当前 ${defaultTimeout} 分钟，范围 5 到 180 分钟`}
            aria-valuemin={5} aria-valuemax={180} aria-valuenow={defaultTimeout}
            className="w-full" />
          <div className="flex items-center gap-2 mt-2">
            <input type="number" min={CONSTRAINTS.defaultTimeout.min} max={CONSTRAINTS.defaultTimeout.max}
              step={CONSTRAINTS.defaultTimeout.step}
              value={defaultTimeout}
              onChange={(e) => setDefaultTimeout(Number(e.target.value))}
              className="w-20 px-2 py-1 rounded text-xs outline-none"
              style={{
                background: "var(--bg-tertiary)", color: "var(--text-primary)",
                border: dtError ? "1px solid var(--red)" : "1px solid var(--border)",
              }}
              aria-label="最长用时数值输入"
            />
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>分钟</span>
            {dtError && <span className="text-xs" style={{ color: "var(--red)" }} role="alert">{dtError}</span>}
          </div>
        </div>

        {/* Save button */}
        <button onClick={handleSave} disabled={!isDirty || !!qtError || !!dtError}
          className="px-6 py-2 rounded text-xs font-semibold disabled:opacity-40"
          style={{ background: "var(--blue)", color: "#fff" }}>
          {saved ? <span style={{ color: "var(--green)" }}>✓ 已保存</span> : isDirty ? "保存设置" : "未修改"}
        </button>

        {/* Skills Management */}
        <div className="mt-6 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
          <h3 className="text-xs font-bold mb-4" style={{ color: "var(--text-secondary)" }}>Skills 管理</h3>
          <SkillsManager />
        </div>

        {/* Plugin Management */}
        <div className="mt-6 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
          <h3 className="text-xs font-bold mb-4" style={{ color: "var(--text-secondary)" }}>MCP 插件管理</h3>
          <PluginManager />
        </div>

        {/* Orchestrator Profiles */}
        <div className="mt-6 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
          <h3 className="text-xs font-bold mb-4" style={{ color: "var(--text-secondary)" }}>编排配置</h3>
          <ProfileManager />
        </div>

        {/* Task Templates */}
        <div className="mt-6 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
          <h3 className="text-xs font-bold mb-4" style={{ color: "var(--text-secondary)" }}>任务模板</h3>
          <TemplateSection />
        </div>

        {/* Scheduled Jobs */}
        <div className="mt-6 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
          <h3 className="text-xs font-bold mb-4" style={{ color: "var(--text-secondary)" }}>定时任务</h3>
          <ScheduleManager />
        </div>

        {/* Advanced settings */}
        <div className="mt-4">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-xs underline"
            style={{ color: "var(--text-secondary)", background: "none", border: "none", cursor: "pointer" }}
          >
            {showAdvanced ? "收起高级设置" : "高级设置"}
          </button>
        </div>

        {showAdvanced && (
          <div className="space-y-6" style={{ animation: "fadeIn 0.3s ease-out" }}>
            {/* Claude path */}
            <div className="glass-card p-4">
              <h3 className="text-xs font-bold mb-3" style={{ color: "var(--text-secondary)" }}>AI 程序位置</h3>
              <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
                如果你安装的 AI 程序不在默认路径，可以在这里修改
              </p>
              <input type="text" value={claudePath}
                onChange={(e) => {
                  setClaudePath(e.target.value);
                  if (claudePathError) validateClaudePath(e.target.value);
                }}
                onBlur={() => validateClaudePath(claudePath)}
                required
                minLength={1}
                className="w-full px-3 py-2 rounded text-xs outline-none"
                style={{
                  background: "var(--bg-tertiary)", color: "var(--text-primary)",
                  border: claudePathError ? "1px solid var(--red)" : "1px solid var(--border)",
                }}
                aria-invalid={!!claudePathError}
                aria-describedby={claudePathError ? "claude-path-error" : undefined}
              />
              {claudePathError && (
                <p id="claude-path-error" className="text-xs mt-1" style={{ color: "var(--red)" }} role="alert">{claudePathError}</p>
              )}
            </div>

            {/* Share settings */}
            <div className="glass-card p-4">
              <h3 className="text-xs font-bold mb-3" style={{ color: "var(--text-secondary)" }}>分享设置</h3>
              <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
                如果你需要把任务分享给别人，填写公网访问地址
              </p>
              <input type="text" value={publicUrl}
                onChange={(e) => setPublicUrl(e.target.value)}
                placeholder="https://my-tunnel.ngrok.io"
                className="w-full px-3 py-2 rounded text-xs outline-none"
                style={{
                  background: "var(--bg-tertiary)", color: "var(--text-primary)",
                  border: "1px solid var(--border)",
                }}
              />
              <p className="text-[10px] mt-1" style={{ color: "var(--text-secondary)" }}>
                留空则使用 http://localhost:9731
              </p>
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

function TemplateSection() {
  const { call } = useEngine();
  const toast = useToast();
  const [templates, setTemplates] = useState<UserTaskTemplate[]>([]);
  const [newName, setNewName] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newPriority, setNewPriority] = useState(5);
  const [newTimeout, setNewTimeout] = useState(60);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editPriority, setEditPriority] = useState(5);
  const [editTimeout, setEditTimeout] = useState(60);

  const loadTemplates = useCallback(async () => {
    try { setTemplates(((await call("template.list", {})) as UserTaskTemplate[] | null) ?? []); } catch { /* ignore */ }
  }, [call]);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const handleCreate = async () => {
    if (!newName.trim() || !newContent.trim()) return;
    try {
      await call("template.create", { name: newName.trim(), content: newContent.trim(), priority: newPriority, timeoutMinutes: newTimeout });
      setNewName("");
      setNewContent("");
      setNewPriority(5);
      setNewTimeout(60);
      loadTemplates();
      toast.success("模板已创建");
    } catch (err) { toast.error(`创建失败: ${err instanceof Error ? err.message : err}`); }
  };

  const handleDelete = async (id: string) => {
    try { await call("template.delete", { id }); loadTemplates(); toast.success("已删除"); } catch (err) { toast.error(`删除失败: ${err instanceof Error ? err.message : err}`); }
  };

  const handleUpdate = async (id: string) => {
    try {
      await call("template.update", { id, name: editName.trim(), content: editContent.trim(), priority: editPriority, timeoutMinutes: editTimeout });
      setEditingId(null);
      loadTemplates();
      toast.success("已更新");
    } catch (err) { toast.error(`更新失败: ${err instanceof Error ? err.message : err}`); }
  };

  return (
    <div className="space-y-3">
      {templates.length === 0 && <p className="text-xs text-center py-2" style={{ color: "var(--text-secondary)" }}>暂无自定义模板</p>}
      {templates.map((tpl) => (
        <div key={tpl.id} className="px-3 py-2.5 rounded-lg text-xs" style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)" }}>
          {editingId === tpl.id ? (
            <div className="space-y-2">
              <input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full px-2 py-1.5 rounded text-xs outline-none" style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)" }} />
              <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={2} className="w-full px-2 py-1.5 rounded text-xs outline-none resize-none" style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)" }} />
              <div className="flex items-center gap-4 text-[10px]" style={{ color: "var(--text-secondary)" }}>
                <div className="flex items-center gap-1">
                  <span>优先级</span>
                  <select value={editPriority} onChange={(e) => setEditPriority(Number(e.target.value))} className="px-1 py-0.5 rounded text-[10px] outline-none" style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>
                    {Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={i + 1}>P{i + 1}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-1">
                  <span>超时</span>
                  <select value={editTimeout} onChange={(e) => setEditTimeout(Number(e.target.value))} className="px-1 py-0.5 rounded text-[10px] outline-none" style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>
                    {[15, 30, 60, 90, 120, 180].map((v) => <option key={v} value={v}>{v}分钟</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setEditingId(null)} className="px-2 py-1 rounded text-[10px]" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>取消</button>
                <button onClick={() => handleUpdate(tpl.id)} className="px-2 py-1 rounded text-[10px] font-semibold" style={{ background: "var(--blue)", color: "#fff" }}>保存</button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold truncate" style={{ color: "var(--text-primary)" }}>{tpl.name}</span>
                  {tpl.isBuiltIn && <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: "rgba(125,133,144,0.15)", color: "var(--text-secondary)" }}>内置</span>}
                  <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>P{tpl.priority}</span>
                  <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{tpl.timeoutMinutes}min</span>
                </div>
                <p className="truncate mt-0.5" style={{ color: "var(--text-secondary)" }}>{tpl.content}</p>
              </div>
              {!tpl.isBuiltIn && (
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => { setEditingId(tpl.id); setEditName(tpl.name); setEditContent(tpl.content); setEditPriority(tpl.priority); setEditTimeout(tpl.timeoutMinutes); }} className="px-2 py-1 rounded text-[10px]" style={{ background: "var(--blue)", color: "#fff" }}>编辑</button>
                  <button onClick={() => handleDelete(tpl.id)} className="px-2 py-1 rounded text-[10px]" style={{ background: "var(--red)", color: "#fff" }}>删除</button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      <div className="p-3 rounded-lg space-y-2" style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)" }}>
        <h4 className="text-[10px] font-bold" style={{ color: "var(--text-secondary)" }}>创建模板</h4>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="模板名称" className="w-full px-2 py-1.5 rounded text-xs outline-none" style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)" }} />
        <textarea value={newContent} onChange={(e) => setNewContent(e.target.value)} placeholder="任务描述模板..." rows={2} className="w-full px-2 py-1.5 rounded text-xs outline-none resize-none" style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)" }} />
        <div className="flex items-center gap-4 text-[10px]" style={{ color: "var(--text-secondary)" }}>
          <div className="flex items-center gap-1">
            <span>优先级</span>
            <select value={newPriority} onChange={(e) => setNewPriority(Number(e.target.value))} className="px-1 py-0.5 rounded text-[10px] outline-none" style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>
              {Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={i + 1}>P{i + 1}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <span>超时</span>
            <select value={newTimeout} onChange={(e) => setNewTimeout(Number(e.target.value))} className="px-1 py-0.5 rounded text-[10px] outline-none" style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>
              {[15, 30, 60, 90, 120, 180].map((v) => <option key={v} value={v}>{v}分钟</option>)}
            </select>
          </div>
        </div>
        <button onClick={handleCreate} disabled={!newName.trim() || !newContent.trim()} className="w-full px-3 py-2 rounded text-xs font-semibold disabled:opacity-40" style={{ background: "var(--green)", color: "#fff" }}>创建</button>
      </div>
    </div>
  );
}

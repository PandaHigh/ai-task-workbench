import { useParams } from "react-router-dom";
import { useShareView } from "../../hooks/useShareView";
import { formatDuration, formatTimestamp } from "../../lib/utils";
import { useState, useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useToast } from "../common/Toast";
import { TaskCreateForm } from "../common/TaskCreateForm";

type TabType = "logs" | "commits" | "lessons" | "report";

type PermissionMode = "view" | "collaborate";

function levelColor(level: string): string {
  switch (level) {
    case "error": return "var(--red)";
    case "warn": return "var(--yellow)";
    case "info": return "var(--blue)";
    default: return "var(--text-secondary)";
  }
}

export function ShareDashboard() {
  const { token } = useParams<{ token: string }>();
  const { loading, error, run, tasks, commits, lessons, queue, report, logs, call, refresh, wsConnected } = useShareView(token!);
  const toast = useToast();
  const [tab, setTab] = useState<TabType>("logs");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Permission: default to "collaborate" for now — the token itself doesn't carry permission info yet
  // When engine adds permission to ShareToken, we can read it from the initial data
  const permission: PermissionMode = "collaborate";
  const canEdit = permission === "collaborate";

  const completedTasks = useMemo(() => tasks.filter(t => t.status === "completed"), [tasks]);
  const failedTasks = useMemo(() => tasks.filter(t => t.status === "failed" || t.status === "reverted"), [tasks]);

  const isRunning = run?.status === "running";
  const elapsed = run?.startedAt
    ? formatDuration((run.completedAt || Date.now()) - run.startedAt)
    : "未开始";

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
      toast.success("已刷新");
    } catch { /* ignore */ }
    finally { setRefreshing(false); }
  };

  const handleRetry = async (taskId: string) => {
    if (!token || !canEdit) return;
    try { await call("task.retry", { taskId }); refresh(); } catch (err) { toast.error(`重试失败: ${err instanceof Error ? err.message : "未知错误"}`); }
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: "var(--bg-primary)" }}>
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-t-transparent rounded-full mx-auto mb-4" style={{ borderColor: "var(--blue)", borderTopColor: "transparent" }} />
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>加载分享看板...</p>
        </div>
      </div>
    );
  }

  if (error) {
    const isExpired = error.includes("expired") || error.includes("过期");
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: "var(--bg-primary)" }}>
        <div className="text-center max-w-md px-6">
          <div className="text-4xl mb-4" style={{ opacity: 0.3 }}>{isExpired ? "🔒" : ":("}</div>
          <p className="text-sm font-semibold mb-2" style={{ color: isExpired ? "var(--yellow)" : "var(--red)" }}>
            {isExpired ? "此分享链接已过期" : "加载失败"}
          </p>
          <p className="text-xs mb-4" style={{ color: "var(--text-secondary)" }}>
            {isExpired ? "请联系分享者获取新的链接" : error}
          </p>
          {!isExpired && (
            <button
              onClick={() => refresh()}
              className="px-4 py-2 rounded-lg text-xs font-semibold"
              style={{ background: "var(--blue)", color: "#fff" }}
            >
              重试
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col" style={{ background: "var(--bg-primary)", color: "var(--text-primary)" }}>
      {/* Header */}
      <div className="px-6 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ background: isRunning ? "var(--green)" : run?.status === "completed" ? "var(--blue)" : "var(--text-secondary)" }} />
          <h2 className="text-sm font-bold truncate">{run?.goals?.[0] || "分享看板"}</h2>
          <span className="status-badge" style={{
            background: isRunning ? "rgba(16, 185, 129, 0.15)" : run?.status === "completed" ? "rgba(77, 107, 254, 0.15)" : "rgba(125, 133, 144, 0.15)",
            color: isRunning ? "var(--green)" : run?.status === "completed" ? "var(--blue)" : "var(--text-secondary)",
          }}>
            {isRunning ? "运行中" : run?.status === "completed" ? "已完成" : run?.status === "failed" ? "失败" : "空闲"}
          </span>
          {/* Connection indicator */}
          <span className="text-[10px] px-1.5 py-0.5 rounded hidden md:inline" style={{
            background: wsConnected ? "rgba(16, 185, 129, 0.1)" : "rgba(245, 158, 11, 0.1)",
            color: wsConnected ? "var(--green)" : "var(--yellow)",
          }}>
            {wsConnected ? "实时" : "轮询中"}
          </span>
          {/* Permission badge */}
          <span className="text-[10px] px-1.5 py-0.5 rounded hidden md:inline" style={{
            background: canEdit ? "rgba(77, 107, 254, 0.15)" : "rgba(125, 133, 144, 0.15)",
            color: canEdit ? "var(--blue)" : "var(--text-secondary)",
          }}>
            {canEdit ? "协作" : "查看"}
          </span>
          <span className="text-xs hidden md:inline" style={{ color: "var(--text-secondary)" }}>{elapsed}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-xs px-2 py-1 rounded hidden md:inline"
            style={{
              background: "var(--bg-tertiary)",
              color: "var(--text-secondary)",
              opacity: refreshing ? 0.5 : 1,
            }}
          >
            {refreshing ? "刷新中..." : "刷新"}
          </button>
          <button className="md:hidden text-xs px-2 py-1 rounded" style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }} onClick={() => setShowQueue(true)}>☰ 任务</button>
          <button className="md:hidden text-xs px-2 py-1 rounded" style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }} onClick={() => setShowSidebar(true)}>📊 统计</button>
          <button className="md:hidden text-xs px-2 py-1 rounded" style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }} onClick={handleRefresh}>
            {refreshing ? "..." : "刷新"}
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Task Queue */}
        <div className={`w-72 border-r flex flex-col shrink-0 max-md:mobile-drawer max-md:mobile-drawer-left ${showQueue ? "" : "max-md:drawer-closed"}`} style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
          <div className="px-4 py-2.5 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
            <h3 className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>任务队列 ({queue.length})</h3>
            <button onClick={() => setShowQueue(false)} className="md:hidden text-xs" style={{ color: "var(--text-secondary)" }}>✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {queue.map((task, i) => (
              <div key={task.id} className="px-3 py-2 rounded text-xs" style={{
                background: "var(--bg-tertiary)",
                borderLeft: "3px solid var(--blue)",
              }}>
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0" style={{
                    background: task.type === "user_defined" ? "var(--purple)" : "var(--bg-secondary)",
                    color: task.type === "user_defined" ? "#fff" : "var(--text-secondary)",
                  }}>{i + 1}</span>
                  <span className="flex-1 whitespace-pre-wrap break-words" style={{ color: "var(--text-primary)" }}>{task.content}</span>
                </div>
                <div className="mt-1 flex gap-2 ml-6" style={{ color: "var(--text-secondary)" }}>
                  <span className="text-[10px]">{task.type === "user_defined" ? "用户" : "智能"}</span>
                  <span className="text-[10px]">P{task.priority}</span>
                </div>
              </div>
            ))}
            {completedTasks.length > 0 && (
              <>
                <div className="text-[10px] font-bold mt-3 mb-1 px-1" style={{ color: "var(--green)" }}>已完成 ({completedTasks.length})</div>
                {completedTasks.map(t => (
                  <div key={t.id} className="px-3 py-2 rounded text-xs" style={{
                    background: "rgba(16, 185, 129, 0.06)",
                    borderLeft: "3px solid var(--green)",
                  }}>
                    <div className="flex items-start gap-2">
                      <span className="shrink-0 text-[10px] mt-0.5" style={{ color: "var(--green)" }}>✓</span>
                      <span className="flex-1 whitespace-pre-wrap break-words" style={{ color: "var(--text-primary)" }}>{t.content}</span>
                    </div>
                    <div className="mt-0.5 flex gap-2 text-[10px] ml-5" style={{ color: "var(--text-secondary)" }}>
                      <span>{t.type === "user_defined" ? "用户" : "智能"}</span>
                      {t.completedAt && <span>{new Date(t.completedAt).toLocaleTimeString()}</span>}
                    </div>
                  </div>
                ))}
              </>
            )}
            {failedTasks.length > 0 && (
              <>
                <div className="text-[10px] font-bold mt-3 mb-1 px-1" style={{ color: "var(--red)" }}>失败 ({failedTasks.length})</div>
                {failedTasks.map(t => (
                  <div key={t.id} className="px-3 py-2 rounded text-xs" style={{
                    background: "rgba(239, 68, 68, 0.06)",
                    borderLeft: "3px solid var(--red)",
                  }}>
                    <div className="flex items-center justify-between gap-1">
                      <span className="flex-1 truncate" style={{ color: "var(--text-primary)" }}>{t.content}</span>
                      {canEdit && (
                        <button onClick={() => handleRetry(t.id)} className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: "var(--blue)", color: "#fff" }}>重试</button>
                      )}
                    </div>
                    {t.errorMessage && <p className="mt-1 text-[10px] truncate" style={{ color: "var(--text-secondary)" }} title={t.errorMessage}>{t.errorMessage}</p>}
                  </div>
                ))}
              </>
            )}
            {queue.length === 0 && completedTasks.length === 0 && failedTasks.length === 0 && (
              <p className="text-xs text-center py-8" style={{ color: "var(--text-secondary)" }}>暂无任务</p>
            )}
          </div>
          {/* Add task button — only in collaborate mode */}
          {canEdit && (
            <div className="p-2 border-t" style={{ borderColor: "var(--border)" }}>
              <button onClick={() => setShowAddModal(true)} className="w-full px-3 py-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-2"
                style={{ background: "var(--green)", color: "#fff", boxShadow: "0 2px 8px rgba(16, 185, 129, 0.3)" }}>
                + 新增任务
              </button>
            </div>
          )}
        </div>

        {/* Center: Tabs */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex border-b px-4 gap-1 py-2" style={{ borderColor: "var(--border)" }}>
            {(["logs", "commits", "lessons", ...(run?.finalReport ? ["report" as const] : [])] as TabType[]).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className="px-3 py-1.5 rounded text-xs font-semibold transition-colors"
                style={{
                  background: tab === t ? "var(--bg-tertiary)" : "transparent",
                  color: tab === t ? "var(--text-primary)" : "var(--text-secondary)",
                }}>
                {t === "logs" ? `日志 (${logs.length})` : t === "commits" ? `Git 提交 (${commits.length})` : t === "lessons" ? `经验教训 (${lessons.length})` : "最终报告"}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-4 font-mono text-xs" style={{ background: "var(--bg-tertiary)" }}>
            {tab === "logs" && (
              logs.length === 0 ? (
                <p className="text-center py-8" style={{ color: "var(--text-secondary)" }}>暂无日志</p>
              ) : (
                <div className="space-y-0.5">
                  {logs.map(log => (
                    <div key={log.id} className="terminal-line">
                      <span style={{ color: "var(--text-secondary)" }}>[{new Date(log.timestamp).toLocaleTimeString()}]</span>{" "}
                      <span style={{ color: levelColor(log.level) }}>[{log.level.toUpperCase()}]</span>{" "}
                      <span style={{ color: "var(--text-secondary)" }}>[{log.source}]</span>{" "}
                      <span style={{ color: "var(--text-primary)" }}>{log.message}</span>
                    </div>
                  ))}
                </div>
              )
            )}
            {tab === "commits" && (
              <div className="space-y-2" style={{ fontFamily: "inherit" }}>
                {commits.map(c => (
                  <div key={c.id} className="glass-card-sm px-3 py-2">
                    <div className="flex items-center gap-2 mb-1">
                      <code style={{ color: "var(--blue)" }}>{c.hash?.slice(0, 7) || "—"}</code>
                      {c.isAiCommit && (
                        <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: "rgba(16, 185, 129, 0.15)", color: "var(--green)" }}>#AI</span>
                      )}
                      <span style={{ color: "var(--text-secondary)" }}>{formatTimestamp(c.timestamp)}</span>
                    </div>
                    <p className="whitespace-pre-wrap break-words" style={{ color: "var(--text-primary)" }}>{c.message}</p>
                    {(c.additions > 0 || c.deletions > 0) && (
                      <span style={{ color: "var(--text-secondary)" }}>+{c.additions} -{c.deletions}</span>
                    )}
                  </div>
                ))}
                {commits.length === 0 && <p className="text-center py-8" style={{ color: "var(--text-secondary)" }}>暂无提交</p>}
              </div>
            )}
            {tab === "lessons" && (
              <div className="space-y-2" style={{ fontFamily: "inherit" }}>
                {lessons.map(l => (
                  <div key={l.id} className="glass-card-sm px-3 py-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-1.5 py-0.5 rounded text-[10px]" style={{
                        background: l.category === "failure" ? "rgba(239, 68, 68, 0.15)" :
                          l.category === "success" ? "rgba(16, 185, 129, 0.15)" : "rgba(210, 153, 34, 0.15)",
                        color: l.category === "failure" ? "var(--red)" :
                          l.category === "success" ? "var(--green)" : "var(--yellow)",
                      }}>{l.category}</span>
                      {l.score != null && (
                        <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>Score: {(l.score * 100).toFixed(0)}%</span>
                      )}
                      <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{formatTimestamp(l.createdAt)}</span>
                    </div>
                    <p style={{ color: "var(--text-primary)" }}>{l.lesson}</p>
                  </div>
                ))}
                {lessons.length === 0 && <p className="text-center py-8" style={{ color: "var(--text-secondary)" }}>暂无经验教训</p>}
              </div>
            )}
            {tab === "report" && (
              report ? (
                <div className="markdown-body prose-sm max-w-none" style={{ fontFamily: "inherit" }} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked(report.report) as string) }} />
              ) : (
                <p className="text-center py-8" style={{ color: "var(--text-secondary)" }}>暂无报告</p>
              )
            )}
          </div>
        </div>

        {/* Right: Stats */}
        <div className={`w-64 border-l p-4 overflow-y-auto shrink-0 max-md:mobile-drawer max-md:mobile-drawer-right ${showSidebar ? "" : "max-md:drawer-closed"}`} style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>运行统计</h3>
            <button onClick={() => setShowSidebar(false)} className="md:hidden text-xs" style={{ color: "var(--text-secondary)" }}>✕</button>
          </div>
          <div className="space-y-3 text-xs">
            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-2">
              <div className="px-2 py-2 rounded text-center" style={{ background: "var(--bg-tertiary)" }}>
                <div className="text-lg font-bold" style={{ color: "var(--green)" }}>{completedTasks.length}</div>
                <div className="text-[10px]" style={{ color: "var(--text-secondary)" }}>已完成</div>
              </div>
              <div className="px-2 py-2 rounded text-center" style={{ background: "var(--bg-tertiary)" }}>
                <div className="text-lg font-bold" style={{ color: "var(--red)" }}>{failedTasks.length}</div>
                <div className="text-[10px]" style={{ color: "var(--text-secondary)" }}>失败</div>
              </div>
              <div className="px-2 py-2 rounded text-center" style={{ background: "var(--bg-tertiary)" }}>
                <div className="text-lg font-bold" style={{ color: "var(--blue)" }}>{commits.length}</div>
                <div className="text-[10px]" style={{ color: "var(--text-secondary)" }}>提交</div>
              </div>
              <div className="px-2 py-2 rounded text-center" style={{ background: "var(--bg-tertiary)" }}>
                <div className="text-lg font-bold" style={{ color: "var(--yellow)" }}>{lessons.length}</div>
                <div className="text-[10px]" style={{ color: "var(--text-secondary)" }}>教训</div>
              </div>
            </div>

            {/* Budget */}
            {run && (
              <div className="pt-2 border-t" style={{ borderColor: "var(--border)" }}>
                <div className="flex justify-between items-center">
                  <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>预算消耗</span>
                  <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>${(run.totalCostUsd ?? 0).toFixed(2)}</span>
                </div>
              </div>
            )}

            {/* Connection status */}
            <div className="pt-2 border-t" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ background: wsConnected ? "var(--green)" : "var(--yellow)" }} />
                <span className="text-[10px]" style={{ color: wsConnected ? "var(--green)" : "var(--yellow)" }}>
                  {wsConnected ? "WebSocket 实时连接" : "HTTP 轮询模式"}
                </span>
              </div>
            </div>

            {/* Goals */}
            {run?.goals?.length && (
              <div className="pt-2 border-t" style={{ borderColor: "var(--border)" }}>
                <h4 className="text-xs font-bold mb-2" style={{ color: "var(--text-secondary)" }}>目标</h4>
                {run.goals.map((g, i) => (
                  <p key={i} className="text-xs mb-1.5 flex items-start gap-1.5">
                    <span className="mt-0.5" style={{ color: "var(--green)" }}>•</span>
                    <span style={{ color: "var(--text-primary)" }}>{g}</span>
                  </p>
                ))}
              </div>
            )}

            {/* Termination Conditions */}
            {run?.terminationConditions?.length && (
              <div className="pt-2 border-t" style={{ borderColor: "var(--border)" }}>
                <h4 className="text-xs font-bold mb-2" style={{ color: "var(--text-secondary)" }}>终止条件</h4>
                {run.terminationConditions.map((c, i) => (
                  <p key={i} className="text-xs mb-1.5 flex items-start gap-1.5">
                    <span className="mt-0.5" style={{ color: "var(--yellow)" }}>•</span>
                    <span style={{ color: "var(--text-primary)" }}>{c}</span>
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile drawer backdrop */}
      {(showQueue || showSidebar) && (
        <div
          className="fixed inset-0 md:hidden"
          style={{ background: "rgba(0,0,0,0.5)", zIndex: 49 }}
          onClick={() => { setShowQueue(false); setShowSidebar(false); }}
        />
      )}

      {/* Add Task Modal — only in collaborate mode */}
      {canEdit && showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} onClick={() => setShowAddModal(false)}>
          <div className="p-6 w-full max-w-md" style={{
            background: "var(--bg-secondary)", border: "1px solid var(--border)",
            borderRadius: "12px", animation: "slideUp 0.2s ease-out",
          }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold mb-3">新增任务</h3>
            <TaskCreateForm
              onSubmit={async ({ content, priority, timeoutMinutes }) => {
                try {
                  await call("task.create", { content, type: "user_defined", priority, timeoutMinutes });
                  setShowAddModal(false);
                  refresh();
                } catch (err) {
                  toast.error(`添加失败: ${err instanceof Error ? err.message : "未知错误"}`);
                }
              }}
              onCancel={() => setShowAddModal(false)}
              submitLabel="确认添加"
            />
          </div>
        </div>
      )}
    </div>
  );
}

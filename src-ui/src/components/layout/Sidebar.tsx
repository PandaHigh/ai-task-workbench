import { useLocation, useNavigate } from "react-router-dom";
import { useState, useCallback } from "react";
import { useEngine } from "../../hooks/useEngine";
import { useTheme } from "../../hooks/useTheme";
import { useDesktopEngine } from "../../hooks/useDesktopEngine";
import { RobotMascot } from "../dashboard/RobotMascot";

const navItems = [
  {
    path: "/",
    label: "首页",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 6.5L8 2l6 4.5V13a1 1 0 01-1 1H3a1 1 0 01-1-1V6.5z" />
        <path d="M6 14V8h4v6" />
      </svg>
    ),
  },
  {
    path: "/wizard",
    label: "创建任务",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="8" y1="2" x2="8" y2="14" />
        <line x1="2" y1="8" x2="14" y2="8" />
      </svg>
    ),
  },
  {
    path: "/settings",
    label: "设置",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="8" r="2.5" />
        <path d="M13.3 10a1.2 1.2 0 00.2 1.3l.1.1a1.45 1.45 0 11-2.05 2.05l-.1-.1a1.2 1.2 0 00-1.3-.2 1.2 1.2 0 00-.73 1.1v.3a1.45 1.45 0 11-2.9 0v-.15a1.2 1.2 0 00-.78-1.1 1.2 1.2 0 00-1.3.2l-.1.1a1.45 1.45 0 11-2.05-2.05l.1-.1a1.2 1.2 0 00.2-1.3 1.2 1.2 0 00-1.1-.73h-.3a1.45 1.45 0 110-2.9h.15a1.2 1.2 0 001.1-.78 1.2 1.2 0 00-.2-1.3l-.1-.1A1.45 1.45 0 114.45 2.7l.1.1a1.2 1.2 0 001.3.2h.06a1.2 1.2 0 00.73-1.1v-.3a1.45 1.45 0 012.9 0v.15a1.2 1.2 0 00.73 1.1 1.2 1.2 0 001.3-.2l.1-.1a1.45 1.45 0 112.05 2.05l-.1.1a1.2 1.2 0 00-.2 1.3v.06a1.2 1.2 0 001.1.73h.3a1.45 1.45 0 010 2.9h-.15a1.2 1.2 0 00-1.1.73z" />
      </svg>
    ),
  },
];

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { connected } = useEngine();
  const { theme, toggle } = useTheme();
  const { isDesktop, restarting, restartEngine } = useDesktopEngine();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleNav = useCallback((path: string) => {
    navigate(path);
    setMobileOpen(false);
  }, [navigate]);

  return (
    <>
      {/* Mobile hamburger */}
      <button
        className="fixed top-3 left-3 z-[60] md:hidden w-9 h-9 flex items-center justify-center rounded-lg"
        style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)" }}
        onClick={() => setMobileOpen((v) => !v)}
        aria-label={mobileOpen ? "关闭导航菜单" : "打开导航菜单"}
        aria-expanded={mobileOpen}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round">
          {mobileOpen ? (
            <>
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </>
          ) : (
            <>
              <line x1="3" y1="4" x2="13" y2="4" />
              <line x1="3" y1="8" x2="13" y2="8" />
              <line x1="3" y1="12" x2="13" y2="12" />
            </>
          )}
        </svg>
      </button>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`glass-sidebar flex flex-col border-r max-md:mobile-drawer max-md:mobile-drawer-left ${
          mobileOpen ? "" : "max-md:drawer-closed"
        } md:!transform-none md:!static md:w-56`}
        style={{ borderColor: "var(--border)" }}
      >
        {/* Brand */}
        <div className="px-4 py-5 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RobotMascot mood="idle" size={28} />
              <h1 className="text-sm font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
                PandaAI
              </h1>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={toggle}
                className="w-7 h-7 rounded-md flex items-center justify-center"
                style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)", cursor: "pointer" }}
                aria-label={theme === "light" ? "切换到深色模式" : "切换到浅色模式"}
                title={theme === "light" ? "深色模式" : "浅色模式"}
              >
                {theme === "light" ? (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 8.5A6.5 6.5 0 117.5 2a5 5 0 006.5 6.5z" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--yellow)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="8" cy="8" r="3.5" />
                    <line x1="8" y1="1" x2="8" y2="3" />
                    <line x1="8" y1="13" x2="8" y2="15" />
                    <line x1="1" y1="8" x2="3" y2="8" />
                    <line x1="13" y1="8" x2="15" y2="8" />
                    <line x1="3.05" y1="3.05" x2="4.46" y2="4.46" />
                    <line x1="11.54" y1="11.54" x2="12.95" y2="12.95" />
                    <line x1="3.05" y1="12.95" x2="4.46" y2="11.54" />
                    <line x1="11.54" y1="4.46" x2="12.95" y2="3.05" />
                  </svg>
                )}
              </button>
              <button
                onClick={() => setMobileOpen(false)}
                className="md:hidden text-xs px-1"
                style={{ color: "var(--text-secondary)" }}
                aria-label="关闭导航"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <line x1="3" y1="3" x2="11" y2="11" />
                  <line x1="11" y1="3" x2="3" y2="11" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2 space-y-0.5" aria-label="主导航">
          {navItems.map((item) => {
            const isActive =
              item.path === "/"
                ? location.pathname === "/"
                : location.pathname.startsWith(item.path);

            return (
              <button
                key={item.path}
                onClick={() => handleNav(item.path)}
                aria-current={isActive ? "page" : undefined}
                aria-label={item.label}
                className={`nav-item ${isActive ? "active" : ""}`}
              >
                <span className="nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Status */}
        <div className="px-4 py-3 border-t" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{
                  background: connected ? "var(--green)" : "var(--red)",
                  transition: "background 0.3s ease",
                }}
              />
              <span className="text-[11px]" style={{ color: connected ? "var(--green)" : "var(--red)" }}>
                {connected ? "AI 已就绪" : "AI 未连接"}
              </span>
            </div>
            {isDesktop && !connected && (
              <button
                onClick={() => restartEngine()}
                disabled={restarting}
                className="text-[10px] px-2 py-0.5 rounded disabled:opacity-50"
                style={{ background: "var(--blue)", color: "#fff", cursor: "pointer" }}
                title="重启引擎进程"
              >
                {restarting ? "重启中..." : "重启"}
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

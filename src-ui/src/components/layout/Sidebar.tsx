import { useLocation, useNavigate } from "react-router-dom";
import { useState, useCallback } from "react";
import { useEngine } from "../../hooks/useEngine";

const navItems = [
  { path: "/", label: "仪表盘", icon: "◎" },
  { path: "/wizard", label: "新建任务", icon: "+" },
  { path: "/settings", label: "设置", icon: "⚙" },
];

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { connected } = useEngine();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleNav = useCallback((path: string) => {
    navigate(path);
    setMobileOpen(false);
  }, [navigate]);

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        className="fixed top-3 left-3 z-[60] md:hidden w-10 h-10 flex items-center justify-center rounded-lg"
        style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)" }}
        onClick={() => setMobileOpen((v) => !v)}
        aria-label={mobileOpen ? "关闭导航菜单" : "打开导航菜单"}
        aria-expanded={mobileOpen}
      >
        <span style={{ color: "var(--text-primary)", fontSize: "18px" }}>
          {mobileOpen ? "✕" : "☰"}
        </span>
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
        <div className="p-4 border-b max-md:p-2 max-md:text-center" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center justify-between">
            <h1 className="text-sm font-bold max-md:text-xs" style={{ color: "var(--text-primary)" }}>
              <span className="max-md:hidden">AI Task Workbench</span>
              <span className="hidden max-md:inline">AI</span>
            </h1>
            <button
              onClick={() => setMobileOpen(false)}
              className="md:hidden text-xs px-1"
              style={{ color: "var(--text-secondary)" }}
              aria-label="关闭导航"
            >
              ✕
            </button>
          </div>
          <p className="text-xs mt-1 max-md:hidden" style={{ color: "var(--text-secondary)" }}>
            全自动任务AI工具台
          </p>
        </div>

        <nav className="flex-1 p-2" aria-label="主导航">
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
                className="sidebar-nav-item w-full flex items-center gap-2 px-3 py-2 rounded text-xs mb-1 max-md:justify-start"
                style={{
                  background: isActive ? "var(--bg-tertiary)" : "transparent",
                  color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                  cursor: "pointer",
                  border: "none",
                  transition: "background 0.2s ease, color 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = "var(--bg-tertiary)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = "transparent";
                }}
              >
                <span className="text-base">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t space-y-2" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{
                background: connected ? "var(--green)" : "var(--red)",
                boxShadow: connected ? "0 0 6px var(--green)" : "none",
                transition: "background 0.3s ease, box-shadow 0.3s ease",
              }}
            />
            <span className="text-[11px]" style={{ color: connected ? "var(--green)" : "var(--red)" }}>
              {connected ? "Engine connected" : "Engine offline"}
            </span>
          </div>
          <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
            v0.1.0
          </div>
        </div>
      </aside>
    </>
  );
}

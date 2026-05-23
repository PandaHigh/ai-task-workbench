import { useLocation, useNavigate } from "react-router-dom";
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

  return (
    <aside
      className="w-56 flex flex-col border-r max-md:w-14"
      style={{
        background: "var(--bg-secondary)",
        borderColor: "var(--border)",
      }}
    >
      <div className="p-4 border-b max-md:p-2 max-md:text-center" style={{ borderColor: "var(--border)" }}>
        <h1 className="text-sm font-bold max-md:text-xs" style={{ color: "var(--text-primary)" }}>
          <span className="max-md:hidden">AI Task Workbench</span>
          <span className="hidden max-md:inline">AI</span>
        </h1>
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
              onClick={() => navigate(item.path)}
              aria-current={isActive ? "page" : undefined}
              aria-label={item.label}
              className="sidebar-nav-item w-full flex items-center gap-2 px-3 py-2 rounded text-xs mb-1 max-md:justify-center"
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
              <span className="max-md:hidden">{item.label}</span>
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
          <span className="text-[11px] max-md:hidden" style={{ color: connected ? "var(--green)" : "var(--red)" }}>
            {connected ? "Engine connected" : "Engine offline"}
          </span>
        </div>
        <div className="text-xs max-md:hidden" style={{ color: "var(--text-secondary)" }}>
          v0.1.0
        </div>
      </div>
    </aside>
  );
}

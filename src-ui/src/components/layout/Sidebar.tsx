import { useLocation, useNavigate } from "react-router-dom";

const navItems = [
  { path: "/", label: "仪表盘", icon: "◎" },
  { path: "/wizard", label: "新建任务", icon: "+" },
  { path: "/settings", label: "设置", icon: "⚙" },
];

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <aside
      className="w-56 flex flex-col border-r"
      style={{
        background: "var(--bg-secondary)",
        borderColor: "var(--border)",
      }}
    >
      <div className="p-4 border-b" style={{ borderColor: "var(--border)" }}>
        <h1 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
          AI Task Workbench
        </h1>
        <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
          全自动任务AI工具台
        </p>
      </div>

      <nav className="flex-1 p-2">
        {navItems.map((item) => {
          const isActive =
            item.path === "/"
              ? location.pathname === "/"
              : location.pathname.startsWith(item.path);

          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded text-xs transition-colors mb-1"
              style={{
                background: isActive ? "var(--bg-tertiary)" : "transparent",
                color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.background = "var(--bg-tertiary)";
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.background = "transparent";
              }}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t" style={{ borderColor: "var(--border)" }}>
        <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
          v0.1.0
        </div>
      </div>
    </aside>
  );
}

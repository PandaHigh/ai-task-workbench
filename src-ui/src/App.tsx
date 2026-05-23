import { Routes, Route, useNavigate } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { MainDashboard } from "./components/dashboard/MainDashboard";
import { TaskWizard } from "./components/wizard/TaskWizard";
import { EvolutionDashboard } from "./components/evolution/EvolutionDashboard";
import { SettingsPage } from "./components/settings/SettingsPage";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/common/Toast";
import { useEngine } from "./hooks/useEngine";
import { useNotifications } from "./hooks/useNotifications";

function NotFound() {
  const navigate = useNavigate();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 16 }}>
      <div style={{ fontSize: 48, opacity: 0.3 }}>404</div>
      <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>页面不存在</p>
      <button
        onClick={() => navigate("/")}
        style={{ padding: "6px 16px", background: "var(--blue)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
      >
        返回首页
      </button>
    </div>
  );
}

export function App() {
  const { connected } = useEngine();
  useNotifications();

  return (
    <ToastProvider>
      <AppShell>
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<MainDashboard />} />
            <Route path="/wizard" element={<TaskWizard />} />
            <Route path="/evolution/:runId" element={<EvolutionDashboard />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </ErrorBoundary>
      </AppShell>
    </ToastProvider>
  );
}

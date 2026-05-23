import { Routes, Route, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
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

const EXIT_DURATION = 250;

function RouteTransition({ children, locationKey }: { children: React.ReactNode; locationKey: string }) {
  const [displayKey, setDisplayKey] = useState(locationKey);
  const [phase, setPhase] = useState<"enter" | "exit">("enter");
  const [displayChildren, setDisplayChildren] = useState(children);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (locationKey !== displayKey) {
      setPhase("exit");
      timerRef.current = setTimeout(() => {
        setDisplayChildren(children);
        setDisplayKey(locationKey);
        setPhase("enter");
      }, EXIT_DURATION);
    } else {
      setDisplayChildren(children);
      setPhase("enter");
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [locationKey, displayKey, children]);

  return (
    <div
      key={displayKey}
      className={phase === "exit" ? "page-exit" : "page-enter"}
      style={{ display: "flex", flex: 1, flexDirection: "column", overflow: "hidden" }}
    >
      {displayChildren}
    </div>
  );
}

export function App() {
  useEngine();
  useNotifications();
  const location = useLocation();

  return (
    <ToastProvider>
      <AppShell>
        <ErrorBoundary>
          <RouteTransition locationKey={location.pathname + location.search}>
            <Routes location={location}>
              <Route path="/" element={<MainDashboard />} />
              <Route path="/wizard" element={<TaskWizard />} />
              <Route path="/evolution/:runId" element={<EvolutionDashboard />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </RouteTransition>
        </ErrorBoundary>
      </AppShell>
    </ToastProvider>
  );
}

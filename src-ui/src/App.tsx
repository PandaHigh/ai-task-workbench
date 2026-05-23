import { Routes, Route } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { MainDashboard } from "./components/dashboard/MainDashboard";
import { TaskWizard } from "./components/wizard/TaskWizard";
import { EvolutionDashboard } from "./components/evolution/EvolutionDashboard";
import { SettingsPage } from "./components/settings/SettingsPage";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useEngine } from "./hooks/useEngine";
import { useNotifications } from "./hooks/useNotifications";

export function App() {
  const { connected } = useEngine();
  useNotifications();

  return (
    <AppShell>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<MainDashboard />} />
          <Route path="/wizard" element={<TaskWizard />} />
          <Route path="/evolution/:runId" element={<EvolutionDashboard />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </ErrorBoundary>
    </AppShell>
  );
}

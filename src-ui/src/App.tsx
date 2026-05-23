import { Routes, Route } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { MainDashboard } from "./components/dashboard/MainDashboard";
import { TaskWizard } from "./components/wizard/TaskWizard";
import { EvolutionDashboard } from "./components/evolution/EvolutionDashboard";

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<MainDashboard />} />
        <Route path="/wizard" element={<TaskWizard />} />
        <Route path="/evolution/:runId" element={<EvolutionDashboard />} />
      </Routes>
    </AppShell>
  );
}

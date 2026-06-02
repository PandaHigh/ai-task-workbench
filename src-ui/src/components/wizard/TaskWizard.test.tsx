import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { useWizardStore } from "../../stores/wizard-store";

const mockCall = vi.fn();
const mockAddTask = vi.fn();
const mockNavigate = vi.fn();

vi.mock("../../hooks/useEngine", () => ({
  useEngine: () => ({ connected: true, call: mockCall }),
}));

vi.mock("../../stores/task-store", () => ({
  useTaskStore: () => mockAddTask,
}));

vi.mock("../../hooks/usePersistedDir", () => ({
  usePersistedDir: () => ({
    getLastDir: () => "~/test-workspace",
    saveDir: vi.fn(),
  }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn().mockRejectedValue("not tauri"),
}));

vi.mock("../../hooks/useKeyboard", () => ({
  setModalActive: vi.fn(),
  useRegisterShortcut: vi.fn(),
}));

import { TaskWizard } from "./TaskWizard";

function renderWizard() {
  return render(
    <MemoryRouter initialEntries={["/wizard"]}>
      <Routes>
        <Route path="/wizard" element={<TaskWizard />} />
        <Route path="/" element={<div>Home</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("TaskWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWizardStore.getState().reset();
  });

  describe("mode switching", () => {
    it("should render mode tabs in wizard mode", () => {
      renderWizard();
      expect(screen.getByRole("button", { name: "快速创建" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "AI 对话创建" })).toBeInTheDocument();
    });

    it("should switch to quick create mode", async () => {
      const user = userEvent.setup();
      renderWizard();

      await user.click(screen.getByRole("button", { name: "快速创建" }));

      expect(screen.getByText("任务描述")).toBeInTheDocument();
      expect(screen.queryByRole("tablist", { name: "任务创建步骤" })).not.toBeInTheDocument();
    });

    it("should switch back to wizard mode from quick create", async () => {
      const user = userEvent.setup();
      renderWizard();

      await user.click(screen.getByRole("button", { name: "快速创建" }));
      expect(screen.getByText("任务描述")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "AI 对话创建" }));
      const tablists = screen.getAllByRole("tablist", { name: "任务创建步骤" });
      expect(tablists.length).toBeGreaterThan(0);
    });
  });

});

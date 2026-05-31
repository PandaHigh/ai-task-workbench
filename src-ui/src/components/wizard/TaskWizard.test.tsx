import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
import type { ExecutionRun } from "@ai-workbench/shared";

function makeRun(overrides: Partial<ExecutionRun> = {}): ExecutionRun {
  return {
    id: "run-wizard-001",
    workingDir: "~/test-workspace",
    goals: ["goal1"],
    terminationConditions: ["cond1"],
    status: "idle",
    totalCostUsd: 0,
    totalTasksCompleted: 0,
    ...overrides,
  };
}

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

      expect(screen.getByText("快速模板")).toBeInTheDocument();
      expect(screen.queryByRole("tablist", { name: "任务创建步骤" })).not.toBeInTheDocument();
    });

    it("should switch back to wizard mode from quick create", async () => {
      const user = userEvent.setup();
      renderWizard();

      await user.click(screen.getByRole("button", { name: "快速创建" }));
      expect(screen.getByText("快速模板")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "AI 对话创建" }));
      const tablists = screen.getAllByRole("tablist", { name: "任务创建步骤" });
      expect(tablists.length).toBeGreaterThan(0);
      expect(screen.queryByText("快速模板")).not.toBeInTheDocument();
    });
  });

  describe("template jump in wizard mode", () => {
    it("should show template buttons on step 1", async () => {
      const user = userEvent.setup();
      mockCall.mockResolvedValueOnce({ value: 60 });
      mockCall.mockResolvedValueOnce({ sessionId: "sess-1" });
      renderWizard();

      await user.click(screen.getByRole("button", { name: "使用默认位置" }));

      await waitFor(() => {
        expect(screen.getByText("修复 Bug")).toBeInTheDocument();
        expect(screen.getByText("选择模板可跳过对话，直接确认任务")).toBeInTheDocument();
      });
    });

    it("should jump to step 2 when template selected", async () => {
      const user = userEvent.setup();
      mockCall.mockResolvedValueOnce({ value: 60 });
      mockCall.mockResolvedValueOnce({ sessionId: "sess-1" });
      renderWizard();

      await user.click(screen.getByRole("button", { name: "使用默认位置" }));

      await waitFor(() => {
        expect(screen.getByText("写测试")).toBeInTheDocument();
      });

      await user.click(screen.getByText("写测试"));

      await waitFor(() => {
        // Step 2 should show editable content area
        expect(screen.getByText("任务内容")).toBeInTheDocument();
        expect(screen.getByText("目标")).toBeInTheDocument();
        expect(screen.getByText("完成标准")).toBeInTheDocument();
      });
    });

    it("should prefill template content in step 2", async () => {
      const user = userEvent.setup();
      mockCall.mockResolvedValueOnce({ value: 60 });
      mockCall.mockResolvedValueOnce({ sessionId: "sess-1" });
      renderWizard();

      await user.click(screen.getByRole("button", { name: "使用默认位置" }));

      await waitFor(() => {
        expect(screen.getByText("重构")).toBeInTheDocument();
      });

      await user.click(screen.getByText("重构"));

      await waitFor(() => {
        const textarea = screen.getByDisplayValue("重构 [模块/文件]");
        expect(textarea).toBeInTheDocument();
      });
    });
  });

  describe("editable step 2", () => {
    it("should render editable fields", async () => {
      const user = userEvent.setup();
      mockCall.mockResolvedValueOnce({ value: 60 });
      mockCall.mockResolvedValueOnce({ sessionId: "sess-1" });
      renderWizard();

      await user.click(screen.getByRole("button", { name: "使用默认位置" }));

      await waitFor(() => {
        expect(screen.getByText("新功能")).toBeInTheDocument();
      });

      await user.click(screen.getByText("新功能"));

      await waitFor(() => {
        expect(screen.getByText("任务内容")).toBeInTheDocument();
        expect(screen.getByText("+ 添加目标")).toBeInTheDocument();
        expect(screen.getByText("+ 添加条件")).toBeInTheDocument();
      });
    });

    it("should show create and create-and-start buttons", async () => {
      const user = userEvent.setup();
      mockCall.mockResolvedValueOnce({ value: 60 });
      mockCall.mockResolvedValueOnce({ sessionId: "sess-1" });
      renderWizard();

      await user.click(screen.getByRole("button", { name: "使用默认位置" }));

      await waitFor(() => {
        expect(screen.getByText("新功能")).toBeInTheDocument();
      });

      await user.click(screen.getByText("新功能"));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "创建" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "创建并开始" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "继续对话" })).toBeInTheDocument();
      });
    });
  });

  describe("create and start", () => {
    it("should call run.create with edited fields on create", async () => {
      const user = userEvent.setup();
      const run = makeRun();
      mockCall.mockResolvedValueOnce({ value: 60 });
      mockCall.mockResolvedValueOnce({ sessionId: "sess-1" });
      mockCall.mockResolvedValueOnce(run);

      renderWizard();

      await user.click(screen.getByRole("button", { name: "使用默认位置" }));

      await waitFor(() => {
        expect(screen.getByText("新功能")).toBeInTheDocument();
      });

      await user.click(screen.getByText("新功能"));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "创建" })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "创建" }));

      await waitFor(() => {
        expect(mockCall).toHaveBeenCalledWith("run.create", expect.objectContaining({
          workingDir: "~/test-workspace",
        }));
        expect(mockNavigate).toHaveBeenCalledWith("/evolution/run-wizard-001");
      });
    });

    it("should call task.start after create when using create-and-start", async () => {
      const user = userEvent.setup();
      const run = makeRun();
      mockCall.mockResolvedValueOnce({ value: 60 });
      mockCall.mockResolvedValueOnce({ sessionId: "sess-1" });
      mockCall.mockResolvedValueOnce(run);
      mockCall.mockResolvedValueOnce(undefined);

      renderWizard();

      await user.click(screen.getByRole("button", { name: "使用默认位置" }));

      await waitFor(() => {
        expect(screen.getByText("修复 Bug")).toBeInTheDocument();
      });

      await user.click(screen.getByText("修复 Bug"));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "创建并开始" })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "创建并开始" }));

      await waitFor(() => {
        expect(mockCall).toHaveBeenCalledWith("run.create", expect.any(Object));
        expect(mockCall).toHaveBeenCalledWith("task.start", { runId: "run-wizard-001" });
        expect(mockNavigate).toHaveBeenCalledWith("/evolution/run-wizard-001");
      });
    });
  });
});

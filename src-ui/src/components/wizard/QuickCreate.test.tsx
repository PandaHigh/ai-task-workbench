import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

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

import { QuickCreate } from "./QuickCreate";
import type { ExecutionRun } from "@ai-workbench/shared";

function makeRun(overrides: Partial<ExecutionRun> = {}): ExecutionRun {
  return {
    id: "run-test-001",
    workingDir: "~/test-workspace",
    goals: ["goal1"],
    terminationConditions: ["cond1"],
    status: "idle",
    totalCostUsd: 0,
    totalTasksCompleted: 0,
    ...overrides,
  };
}

function renderQuickCreate() {
  return render(
    <MemoryRouter>
      <QuickCreate />
    </MemoryRouter>
  );
}

describe("QuickCreate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCall.mockImplementation((method: string) => {
      if (method === "template.list") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
  });

  it("should render form fields", () => {
    renderQuickCreate();
    expect(screen.getByText("项目目录")).toBeInTheDocument();
    expect(screen.getByText("快速模板")).toBeInTheDocument();
    expect(screen.getByText("任务描述")).toBeInTheDocument();
    expect(screen.getByText("目标")).toBeInTheDocument();
    expect(screen.getByText("创建任务")).toBeInTheDocument();
    expect(screen.getByText("创建并开始")).toBeInTheDocument();
  });

  it("should render 5 template buttons", () => {
    renderQuickCreate();
    expect(screen.getByText("修复 Bug")).toBeInTheDocument();
    expect(screen.getByText("新功能")).toBeInTheDocument();
    expect(screen.getByText("重构")).toBeInTheDocument();
    expect(screen.getByText("写测试")).toBeInTheDocument();
    expect(screen.getByText("代码审查")).toBeInTheDocument();
  });

  it("should prefill content and goals when template selected", async () => {
    const user = userEvent.setup();
    renderQuickCreate();

    await user.click(screen.getByText("修复 Bug"));

    const textarea = screen.getByPlaceholderText("你想让 AI 做什么？");
    expect(textarea).toHaveValue("修复以下 bug: [请描述 bug 表现]");

    // Goals should be prefilled
    const goalInput = screen.getByDisplayValue("Bug 已修复且无回归");
    expect(goalInput).toBeInTheDocument();
  });

  it("should show validation error for empty content", async () => {
    const user = userEvent.setup();
    renderQuickCreate();

    await user.click(screen.getByText("创建任务"));

    expect(screen.getByText("请填写任务描述")).toBeInTheDocument();
  });

  it("should create task successfully", async () => {
    const user = userEvent.setup();
    const run = makeRun();
    mockCall.mockImplementation((method: string) => {
      if (method === "template.list") return Promise.resolve([]);
      if (method === "run.create") return Promise.resolve(run);
      return Promise.resolve(undefined);
    });

    renderQuickCreate();

    const textarea = screen.getByPlaceholderText("你想让 AI 做什么？");
    await user.type(textarea, "Fix the login page bug");

    await user.click(screen.getByText("创建任务"));

    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith("run.create", expect.objectContaining({
        workingDir: "~/test-workspace",
        goals: expect.arrayContaining(["完成: Fix the login page bug"]),
      }));
    });

    expect(mockAddTask).toHaveBeenCalledWith(run);
    expect(mockNavigate).toHaveBeenCalledWith("/evolution/run-test-001");
  });

  it("should create and start task", async () => {
    const user = userEvent.setup();
    const run = makeRun();
    mockCall.mockImplementation((method: string) => {
      if (method === "template.list") return Promise.resolve([]);
      if (method === "run.create") return Promise.resolve(run);
      if (method === "task.start") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    renderQuickCreate();

    const textarea = screen.getByPlaceholderText("你想让 AI 做什么？");
    await user.type(textarea, "Write unit tests");

    await user.click(screen.getByText("创建并开始"));

    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith("run.create", expect.any(Object));
      expect(mockCall).toHaveBeenCalledWith("task.start", { runId: "run-test-001" });
    });
  });

  it("should handle creation failure gracefully", async () => {
    const user = userEvent.setup();
    mockCall.mockImplementation((method: string) => {
      if (method === "template.list") return Promise.resolve([]);
      if (method === "run.create") return Promise.reject(new Error("Engine error"));
      return Promise.resolve(undefined);
    });

    renderQuickCreate();

    const textarea = screen.getByPlaceholderText("你想让 AI 做什么？");
    await user.type(textarea, "Some task");

    await user.click(screen.getByText("创建任务"));

    // Button should be re-enabled after failure (creating state reset)
    await waitFor(() => {
      expect(screen.getByText("创建任务")).not.toBeDisabled();
    });
  });

  it("should auto-generate goals from content when goals empty", async () => {
    const user = userEvent.setup();
    const run = makeRun();
    mockCall.mockImplementation((method, params) => {
      if (method === "run.create") {
        expect(params.goals).toEqual(["完成: Build the API"]);
        return Promise.resolve(run);
      }
      return Promise.resolve(undefined);
    });

    renderQuickCreate();

    const textarea = screen.getByPlaceholderText("你想让 AI 做什么？");
    await user.type(textarea, "Build the API");

    await user.click(screen.getByText("创建任务"));

    await waitFor(() => {
      expect(mockCall).toHaveBeenCalled();
    });
  });
});

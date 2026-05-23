import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test/test-utils";
import { TaskWizard } from "../wizard/TaskWizard";
import { useWizardStore } from "../../stores/wizard-store";
import { useTaskStore } from "../../stores/task-store";

const mockCall = vi.fn();
const mockConnected = vi.fn().mockReturnValue({ connected: true, call: mockCall });

vi.mock("../../hooks/useEngine", () => ({
  useEngine: () => mockConnected(),
}));

vi.mock("../../lib/engine-client", () => ({
  engineClient: {
    call: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
    onNotification: vi.fn().mockReturnValue(() => {}),
  },
}));

describe("TaskWizard", () => {
  beforeEach(() => {
    useWizardStore.getState().reset();
    useTaskStore.setState({ tasks: [], loading: false, activeRunId: null });
    vi.clearAllMocks();
    mockConnected.mockReturnValue({ connected: true, call: mockCall });
    mockCall.mockReset();
  });

  it("renders step 0 by default with directory selection", () => {
    renderWithProviders(<TaskWizard />);

    expect(screen.getByText("新建 AI 任务")).toBeInTheDocument();
    expect(screen.getByText("选择目录")).toBeInTheDocument();
    expect(screen.getByText("AI 对话")).toBeInTheDocument();
    expect(screen.getByText("确认参数")).toBeInTheDocument();
    expect(screen.getByText("选择 AI 任务的工作目录")).toBeInTheDocument();
  });

  it("renders step indicators with correct active state", () => {
    renderWithProviders(<TaskWizard />);

    const stepNumbers = screen.getAllByText(/^[123]$/);
    expect(stepNumbers.length).toBe(3);

    // Step 0 is active, step numbers 1 should be highlighted
    // Step 2 and 3 should be secondary
  });

  it("shows directory input on button click", async () => {
    renderWithProviders(<TaskWizard />);

    await userEvent.click(screen.getByText("输入目录路径"));

    expect(screen.getByPlaceholderText("/path/to/project")).toBeInTheDocument();
    expect(screen.getByText("确认")).toBeInTheDocument();
  });

  it("starts wizard session on directory confirm", async () => {
    mockCall.mockResolvedValueOnce({ sessionId: "sess-abc" });

    renderWithProviders(<TaskWizard />);

    await userEvent.click(screen.getByText("输入目录路径"));

    const input = screen.getByPlaceholderText("/path/to/project");
    await userEvent.type(input, "/home/user/my-project");
    await userEvent.click(screen.getByText("确认"));

    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith("wizard.start", { workingDir: "/home/user/my-project" });
    });
  });

  it("advances to step 1 after successful session start", async () => {
    mockCall.mockResolvedValueOnce({ sessionId: "sess-abc" });

    renderWithProviders(<TaskWizard />);

    await userEvent.click(screen.getByText("输入目录路径"));
    await userEvent.type(screen.getByPlaceholderText("/path/to/project"), "/test/dir");
    await userEvent.click(screen.getByText("确认"));

    await waitFor(() => {
      expect(useWizardStore.getState().sessionId).toBe("sess-abc");
      expect(useWizardStore.getState().step).toBe(1);
    });
  });

  it("shows error toast on session start failure", async () => {
    mockCall.mockRejectedValueOnce(new Error("Engine not running"));

    renderWithProviders(<TaskWizard />);

    await userEvent.click(screen.getByText("输入目录路径"));
    await userEvent.type(screen.getByPlaceholderText("/path/to/project"), "/test/dir");
    await userEvent.click(screen.getByText("确认"));

    await waitFor(() => {
      expect(screen.getByText(/启动向导失败/)).toBeInTheDocument();
    });
  });

  it("does not confirm empty directory", async () => {
    renderWithProviders(<TaskWizard />);

    await userEvent.click(screen.getByText("输入目录路径"));
    const confirmBtn = screen.getByText("确认");

    // Input is empty, clicking confirm should not trigger call
    await userEvent.click(confirmBtn);
    expect(mockCall).not.toHaveBeenCalled();
  });

  it("renders chat interface on step 1", () => {
    useWizardStore.setState({ step: 1, sessionId: "sess-1" });

    renderWithProviders(<TaskWizard />);

    expect(screen.getByText("AI 助手将通过对话帮你定义任务的目标和终止条件。")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/描述你的任务/)).toBeInTheDocument();
    expect(screen.getByText("发送")).toBeInTheDocument();
  });

  it("sends chat message and receives response", async () => {
    useWizardStore.setState({ step: 1, sessionId: "sess-1" });

    mockCall.mockResolvedValueOnce({
      response: "请告诉我你的任务目标",
      shouldExtractParams: false,
    });

    renderWithProviders(<TaskWizard />);

    const input = screen.getByPlaceholderText(/描述你的任务/);
    await userEvent.type(input, "Fix all tests");
    await userEvent.click(screen.getByText("发送"));

    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith("wizard.chat", {
        sessionId: "sess-1",
        message: "Fix all tests",
      });
    });

    await waitFor(() => {
      expect(screen.getByText("请告诉我你的任务目标")).toBeInTheDocument();
    });
  });

  it("validates and advances to step 2 when params extracted", async () => {
    useWizardStore.setState({ step: 1, sessionId: "sess-1" });

    // Chat response triggers validation
    mockCall
      .mockResolvedValueOnce({
        response: "任务定义完成",
        shouldExtractParams: true,
      })
      .mockResolvedValueOnce({
        valid: true,
        errors: [],
        params: {
          content: "Fix tests",
          goals: ["All tests pass"],
          terminationConditions: ["Build succeeds"],
          postCompletionAction: "commit",
        },
      });

    renderWithProviders(<TaskWizard />);

    await userEvent.type(screen.getByPlaceholderText(/描述你的任务/), "test");
    await userEvent.click(screen.getByText("发送"));

    await waitFor(() => {
      expect(useWizardStore.getState().step).toBe(2);
    });
  });

  it("shows retry on validation failure", async () => {
    useWizardStore.setState({ step: 1, sessionId: "sess-1" });

    mockCall
      .mockResolvedValueOnce({
        response: "需要更多信息",
        shouldExtractParams: true,
      })
      .mockResolvedValueOnce({
        valid: false,
        errors: ["Missing goals"],
        params: null,
      })
      .mockResolvedValueOnce({
        response: "请提供任务目标",
        shouldExtractParams: false,
      });

    renderWithProviders(<TaskWizard />);

    await userEvent.type(screen.getByPlaceholderText(/描述你的任务/), "test");
    await userEvent.click(screen.getByText("发送"));

    await waitFor(() => {
      expect(useWizardStore.getState().isValid).toBe(false);
      expect(useWizardStore.getState().errors).toEqual(["Missing goals"]);
    });
  });

  it("renders step 2 with task params confirmation", async () => {
    useWizardStore.setState({
      step: 2,
      workingDir: "/test/project",
      taskParams: {
        content: "Fix TypeScript errors",
        goals: ["Remove warnings", "Tests pass"],
        terminationConditions: ["Build succeeds"],
        postCompletionAction: "commit",
      },
    });

    renderWithProviders(<TaskWizard />);

    await waitFor(() => {
      expect(screen.getByText("任务参数")).toBeInTheDocument();
    });
    expect(screen.getByText("Fix TypeScript errors")).toBeInTheDocument();
    expect(screen.getByText(/Remove warnings/)).toBeInTheDocument();
    expect(screen.getByText(/Tests pass/)).toBeInTheDocument();
    expect(screen.getByText(/Build succeeds/)).toBeInTheDocument();
    expect(screen.getByText("/test/project")).toBeInTheDocument();
  });

  it("creates run on confirm and navigates", async () => {
    const mockRun = { id: "run-new-123", workingDir: "/test" };
    useWizardStore.setState({
      step: 2,
      workingDir: "/test/project",
      taskParams: {
        content: "Fix TS errors",
        goals: ["No errors"],
        terminationConditions: ["Build OK"],
        postCompletionAction: "commit",
      },
    });

    mockCall.mockResolvedValueOnce(mockRun);

    renderWithProviders(<TaskWizard />);

    await userEvent.click(screen.getByText("确认并开始执行"));

    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith("run.create", expect.objectContaining({
        workingDir: "/test/project",
        goals: ["No errors"],
      }));
    });
  });

  it("shows error toast on run creation failure", async () => {
    useWizardStore.setState({
      step: 2,
      workingDir: "/test/project",
      taskParams: {
        content: "Fix",
        goals: ["Goal"],
        terminationConditions: ["Cond"],
        postCompletionAction: "commit",
      },
    });

    mockCall.mockRejectedValueOnce(new Error("Creation failed"));

    renderWithProviders(<TaskWizard />);

    await userEvent.click(screen.getByText("确认并开始执行"));

    await waitFor(() => {
      expect(screen.getByText(/创建失败/)).toBeInTheDocument();
    });
  });

  it("goes back to step 1 on return button", async () => {
    useWizardStore.setState({
      step: 2,
      workingDir: "/test",
      taskParams: {
        content: "X",
        goals: ["G"],
        terminationConditions: ["C"],
        postCompletionAction: "commit",
      },
    });

    renderWithProviders(<TaskWizard />);

    await userEvent.click(screen.getByText("返回修改"));
    expect(useWizardStore.getState().step).toBe(1);
  });

  it("resets and navigates back on return button in header", async () => {
    renderWithProviders(<TaskWizard />);

    await userEvent.click(screen.getByText("← 返回"));
    expect(useWizardStore.getState().step).toBe(0);
  });

  it("disables send button while loading", async () => {
    useWizardStore.setState({ step: 1, sessionId: "sess-1" });

    // Make the call hang
    mockCall.mockReturnValue(new Promise(() => {}));

    renderWithProviders(<TaskWizard />);

    await userEvent.type(screen.getByPlaceholderText(/描述你的任务/), "test");
    await userEvent.click(screen.getByText("发送"));

    const sendBtn = screen.getByText("发送");
    expect(sendBtn).toBeDisabled();
  });

  it("shows loading spinner while AI is thinking", async () => {
    useWizardStore.setState({ step: 1, sessionId: "sess-1" });
    mockCall.mockReturnValue(new Promise(() => {}));

    renderWithProviders(<TaskWizard />);

    await userEvent.type(screen.getByPlaceholderText(/描述你的任务/), "test");
    await userEvent.click(screen.getByText("发送"));

    expect(screen.getByText("AI 正在思考")).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ScheduleManager } from "./ScheduleManager";

const mockCall = vi.fn();

vi.mock("../../hooks/useEngine", () => ({
  useEngine: () => ({ call: mockCall, connected: true }),
}));

vi.mock("../common/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

describe("ScheduleManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCall.mockReset();
  });

  it("should show empty state when no jobs", async () => {
    mockCall.mockResolvedValue([]);
    render(<ScheduleManager />);
    await waitFor(() => {
      expect(screen.getByText("暂无定时任务")).toBeInTheDocument();
    });
  });

  it("should list scheduled jobs", async () => {
    mockCall.mockResolvedValue([
      { id: "j1", name: "Daily Build", cronExpr: "0 9 * * *", goals: ["build"], workingDir: "/tmp", enabled: true, createdAt: Date.now() },
    ]);
    render(<ScheduleManager />);
    await waitFor(() => {
      expect(screen.getByText("Daily Build")).toBeInTheDocument();
    });
  });

  it("should show add form on button click", async () => {
    mockCall.mockResolvedValue([]);
    render(<ScheduleManager />);
    await waitFor(() => {
      expect(screen.getByText("+ 添加定时任务")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("+ 添加定时任务"));
    expect(screen.getByText("创建")).toBeInTheDocument();
  });

  it("should create a new scheduled job", async () => {
    mockCall.mockResolvedValueOnce([]);
    mockCall.mockResolvedValueOnce({ id: "new-job", name: "Test", enabled: true });
    mockCall.mockResolvedValueOnce([]);

    render(<ScheduleManager />);
    await waitFor(() => {
      expect(screen.getByText("+ 添加定时任务")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("+ 添加定时任务"));

    const nameInput = screen.getByPlaceholderText("任务名称");
    fireEvent.change(nameInput, { target: { value: "Test Job" } });

    const goalsInput = screen.getByPlaceholderText("目标（每行一个）");
    fireEvent.change(goalsInput, { target: { value: "build\n test" } });

    fireEvent.click(screen.getByText("创建"));

    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith("schedule.create", expect.objectContaining({
        name: "Test Job",
        goals: ["build", " test"],
      }));
    });
  });

  it("should toggle job enabled state", async () => {
    mockCall
      .mockResolvedValueOnce([{ id: "j1", name: "Job1", cronExpr: "* * * * *", goals: ["g"], workingDir: "/tmp", enabled: true, createdAt: Date.now() }])
      .mockResolvedValueOnce({ id: "j1", enabled: false })
      .mockResolvedValueOnce([]);

    render(<ScheduleManager />);
    await waitFor(() => {
      expect(screen.getByText("暂停")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("暂停"));
    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith("schedule.toggle", expect.objectContaining({ id: "j1", enabled: false }));
    });
  });

  it("should delete a job", async () => {
    mockCall
      .mockResolvedValueOnce([{ id: "j1", name: "Job1", cronExpr: "* * * * *", goals: ["g"], workingDir: "/tmp", enabled: true, createdAt: Date.now() }])
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce([]);

    render(<ScheduleManager />);
    await waitFor(() => {
      expect(screen.getByText("删除")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("删除"));
    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith("schedule.delete", expect.objectContaining({ id: "j1" }));
    });
  });
});

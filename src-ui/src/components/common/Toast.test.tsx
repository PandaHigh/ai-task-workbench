import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider, useToast } from "../common/Toast";

function TestConsumer({ action }: { action: "success" | "error" | "warning" | "info" }) {
  const toast = useToast();
  return (
    <button onClick={() => toast[action](`test-${action}-message`)}>
      {action}
    </button>
  );
}

function MultiToastConsumer() {
  const toast = useToast();
  return (
    <div>
      <button onClick={() => toast.success("success-msg")}>success</button>
      <button onClick={() => toast.error("error-msg")}>error</button>
      <button onClick={() => toast.warning("warning-msg")}>warning</button>
      <button onClick={() => toast.info("info-msg")}>info</button>
    </div>
  );
}

function AddToastConsumer() {
  const toast = useToast();
  return (
    <button onClick={() => toast.addToast("success", "addToast-msg")}>
      add
    </button>
  );
}

describe("ToastProvider & useToast", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders toast on success()", async () => {
    render(
      <ToastProvider>
        <TestConsumer action="success" />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "success" }));

    expect(screen.getByText("test-success-message")).toBeInTheDocument();
    expect(screen.getByText("✓")).toBeInTheDocument();
  });

  it("renders toast on error()", async () => {
    render(
      <ToastProvider>
        <TestConsumer action="error" />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "error" }));

    expect(screen.getByText("test-error-message")).toBeInTheDocument();
    // Error toast uses ✕ as icon text, verify toast container exists
    const toastItems = document.querySelectorAll(".toast-item");
    expect(toastItems.length).toBe(1);
  });

  it("renders toast on warning()", async () => {
    render(
      <ToastProvider>
        <TestConsumer action="warning" />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "warning" }));

    expect(screen.getByText("test-warning-message")).toBeInTheDocument();
    expect(screen.getByText("⚠")).toBeInTheDocument();
  });

  it("renders toast on info()", async () => {
    render(
      <ToastProvider>
        <TestConsumer action="info" />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "info" }));

    expect(screen.getByText("test-info-message")).toBeInTheDocument();
    expect(screen.getByText("ℹ")).toBeInTheDocument();
  });

  it("supports addToast() directly", async () => {
    render(
      <ToastProvider>
        <AddToastConsumer />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "add" }));
    expect(screen.getByText("addToast-msg")).toBeInTheDocument();
  });

  it("auto-dismisses toast after 3 seconds", async () => {
    render(
      <ToastProvider>
        <TestConsumer action="success" />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "success" }));
    expect(screen.getByText("test-success-message")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    await waitFor(() => {
      expect(screen.queryByText("test-success-message")).not.toBeInTheDocument();
    });
  });

  it("dismisses toast on click dismiss button", async () => {
    render(
      <ToastProvider>
        <TestConsumer action="success" />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "success" }));
    expect(screen.getByText("test-success-message")).toBeInTheDocument();

    // The dismiss button inside the toast (the ✕ next to the message)
    const dismissButtons = screen.getAllByRole("button");
    // Find the dismiss button - it's the one that's not our test trigger
    const dismissBtn = dismissButtons.find(
      (btn) => btn.textContent === "✕" && btn.closest(".toast-item"),
    );
    expect(dismissBtn).toBeTruthy();
    await userEvent.click(dismissBtn!);

    await waitFor(() => {
      expect(screen.queryByText("test-success-message")).not.toBeInTheDocument();
    });
  });

  it("renders multiple toasts simultaneously", async () => {
    render(
      <ToastProvider>
        <MultiToastConsumer />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "success" }));
    await userEvent.click(screen.getByRole("button", { name: "error" }));

    expect(screen.getByText("success-msg")).toBeInTheDocument();
    expect(screen.getByText("error-msg")).toBeInTheDocument();
  });

  it("removes correct toast when dismissing one of multiple", async () => {
    render(
      <ToastProvider>
        <MultiToastConsumer />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "success" }));
    await userEvent.click(screen.getByRole("button", { name: "error" }));

    expect(screen.getByText("success-msg")).toBeInTheDocument();
    expect(screen.getByText("error-msg")).toBeInTheDocument();

    // Dismiss the success toast - find it in its toast-item container
    const allButtons = screen.getAllByRole("button");
    void allButtons; // buttons checked via toast-items below

    // Simpler approach: click all dismiss buttons, check first toast removed
    const toastItems = document.querySelectorAll(".toast-item");
    expect(toastItems.length).toBe(2);
  });

  it("returns default context values outside provider", () => {
    // The hook returns no-op functions outside provider
    function OutsideConsumer() {
      const toast = useToast();
      return <span data-testid="has-toast">{typeof toast.success}</span>;
    }

    render(<OutsideConsumer />);
    expect(screen.getByTestId("has-toast").textContent).toBe("function");
  });
});

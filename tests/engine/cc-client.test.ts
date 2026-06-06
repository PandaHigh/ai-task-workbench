import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { CCClient } from "../../src-engine/src/cc-integration/cc-client.js";
import type { Mock } from "vitest";

// Mock child_process.spawn
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "child_process";

interface MockChildProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: Mock;
  pid: number;
}

function createMockProc(): MockChildProcess {
  const proc = new EventEmitter() as unknown as MockChildProcess;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  proc.pid = 12345;
  return proc;
}

describe("CCClient", () => {
  let client: CCClient;

  beforeEach(() => {
    client = new CCClient();
    vi.clearAllMocks();
  });

  it("should execute a task and return result", async () => {
    const proc = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const promise = client.executeTask("test prompt", {
      workingDir: "/tmp/test",
      timeoutMinutes: 5,
    });

    // Simulate stdout with result
    proc.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          type: "result",
          subtype: "success",
          result: "done",
          session_id: "sess-1",
          total_cost_usd: 0.01,
          duration_ms: 1000,
          num_turns: 1,
        }) + "\n",
      ),
    );

    proc.emit("close", 0);

    const result = await promise;
    expect(result.result).toBe("done");
    expect(result.sessionId).toBe("sess-1");
    expect(result.totalCostUsd).toBe(0.01);
  });

  it("should reject on non-zero exit code without result", async () => {
    const proc = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const promise = client.executeTask("test", {
      workingDir: "/tmp",
      timeoutMinutes: 1,
    });

    proc.stderr.emit("data", Buffer.from("error output"));
    proc.emit("close", 1);

    await expect(promise).rejects.toThrow("CC process exited with code 1");
  });

  it("should reject on spawn error", async () => {
    const proc = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const promise = client.executeTask("test", {
      workingDir: "/tmp",
      timeoutMinutes: 1,
    });

    proc.emit("error", new Error("spawn failed"));

    await expect(promise).rejects.toThrow("spawn failed");
  });

  it("should timeout and kill process", async () => {
    const proc = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    // Use a very short timeout
    const promise = client.executeTask("test", {
      workingDir: "/tmp",
      timeoutMinutes: 0.001, // ~60ms
    });

    await expect(promise).rejects.toThrow("timed out");
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("should support abort signal", async () => {
    const proc = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const controller = new AbortController();
    const promise = client.executeTask("test", {
      workingDir: "/tmp",
      timeoutMinutes: 60,
      abortSignal: controller.signal,
    });

    controller.abort();

    await expect(promise).rejects.toThrow("aborted");
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("should flush remaining buffer on close", async () => {
    const proc = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const promise = client.executeTask("test", {
      workingDir: "/tmp",
      timeoutMinutes: 5,
    });

    // Emit partial JSON (no trailing newline)
    proc.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          type: "result",
          subtype: "success",
          result: "flushed",
          session_id: "s1",
          total_cost_usd: 0,
          duration_ms: 100,
          num_turns: 1,
        }),
      ),
    );

    // Close without the data ever being split by newline
    proc.emit("close", 0);

    const result = await promise;
    expect(result.result).toBe("flushed");
  });

  it("should stream messages via executeTaskStream", async () => {
    const proc = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const gen = client.executeTaskStream("test", {
      workingDir: "/tmp",
      timeoutMinutes: 5,
    });

    // Emit a message
    setTimeout(() => {
      proc.stdout.emit("data", Buffer.from(JSON.stringify({ type: "assistant" }) + "\n"));
    }, 10);

    const first = await gen.next();
    expect(first.value.type).toBe("assistant");

    // Close the stream
    setTimeout(() => proc.emit("close", 0), 10);
    const done = await gen.next();
    expect(done.done).toBe(true);
  });

  it("should throw on stream spawn error", async () => {
    const proc = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const gen = client.executeTaskStream("test", {
      workingDir: "/tmp",
      timeoutMinutes: 5,
    });

    setTimeout(() => proc.emit("error", new Error("stream spawn fail")), 10);
    setTimeout(() => proc.emit("close", 1), 20);

    // Consume generator — should end cleanly (error is thrown after loop completes)
    const items: unknown[] = [];
    try {
      for await (const msg of gen) {
        items.push(msg);
      }
    } catch (err: unknown) {
      expect((err as Error).message).toBe("stream spawn fail");
    }
  });
});

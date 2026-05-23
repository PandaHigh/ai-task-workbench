import { describe, it, expect, beforeEach } from "vitest";
import { useWizardStore } from "./wizard-store";

describe("wizard-store", () => {
  beforeEach(() => {
    useWizardStore.getState().reset();
  });

  it("starts with default state", () => {
    const state = useWizardStore.getState();
    expect(state.step).toBe(0);
    expect(state.workingDir).toBe("");
    expect(state.sessionId).toBeNull();
    expect(state.messages).toEqual([]);
    expect(state.taskParams).toBeNull();
    expect(state.isValid).toBe(false);
    expect(state.errors).toEqual([]);
  });

  it("setStep updates step", () => {
    useWizardStore.getState().setStep(1);
    expect(useWizardStore.getState().step).toBe(1);
  });

  it("setWorkingDir updates working directory", () => {
    useWizardStore.getState().setWorkingDir("/home/user/project");
    expect(useWizardStore.getState().workingDir).toBe("/home/user/project");
  });

  it("setSessionId updates session id", () => {
    useWizardStore.getState().setSessionId("sess-123");
    expect(useWizardStore.getState().sessionId).toBe("sess-123");
  });

  it("addMessage appends messages", () => {
    const msg = { role: "user" as const, content: "Hello", timestamp: Date.now() };
    useWizardStore.getState().addMessage(msg);
    expect(useWizardStore.getState().messages).toHaveLength(1);
    expect(useWizardStore.getState().messages[0].content).toBe("Hello");

    const msg2 = { role: "assistant" as const, content: "Hi", timestamp: Date.now() };
    useWizardStore.getState().addMessage(msg2);
    expect(useWizardStore.getState().messages).toHaveLength(2);
  });

  it("setTaskParams updates task params", () => {
    const params = {
      content: "Fix TS errors",
      goals: ["No errors", "Tests pass"],
      terminationConditions: ["Build succeeds"],
      postCompletionAction: "commit",
    };
    useWizardStore.getState().setTaskParams(params);
    expect(useWizardStore.getState().taskParams).toEqual(params);
  });

  it("setValidation updates validity and errors", () => {
    useWizardStore.getState().setValidation(true, []);
    expect(useWizardStore.getState().isValid).toBe(true);
    expect(useWizardStore.getState().errors).toEqual([]);

    useWizardStore.getState().setValidation(false, ["Missing goals"]);
    expect(useWizardStore.getState().isValid).toBe(false);
    expect(useWizardStore.getState().errors).toEqual(["Missing goals"]);
  });

  it("reset restores initial state", () => {
    useWizardStore.getState().setStep(2);
    useWizardStore.getState().setWorkingDir("/x");
    useWizardStore.getState().addMessage({ role: "user", content: "test", timestamp: 1 });
    useWizardStore.getState().setValidation(false, ["err"]);

    useWizardStore.getState().reset();

    const state = useWizardStore.getState();
    expect(state.step).toBe(0);
    expect(state.workingDir).toBe("");
    expect(state.messages).toEqual([]);
    expect(state.taskParams).toBeNull();
    expect(state.isValid).toBe(false);
    expect(state.errors).toEqual([]);
  });
});

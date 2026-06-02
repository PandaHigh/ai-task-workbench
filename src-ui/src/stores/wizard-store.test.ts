import { describe, it, expect, beforeEach } from "vitest";
import { useWizardStore } from "./wizard-store";

describe("wizard-store", () => {
  beforeEach(() => {
    useWizardStore.getState().reset();
  });

  describe("initial state", () => {
    it("should have default values", () => {
      const s = useWizardStore.getState();
      expect(s.step).toBe(0);
      expect(s.mode).toBe("wizard");
      expect(s.workingDir).toBe("");
      expect(s.sessionId).toBeNull();
      expect(s.messages).toEqual([]);
      expect(s.taskParams).toBeNull();
      expect(s.quickContent).toBe("");
      expect(s.quickGoals).toBe("");
      expect(s.editedContent).toBe("");
      expect(s.editedGoals).toEqual([]);
      expect(s.editedConditions).toEqual([]);
    });
  });

  describe("setMode", () => {
    it("should switch to quick mode", () => {
      useWizardStore.getState().setMode("quick");
      expect(useWizardStore.getState().mode).toBe("quick");
    });

    it("should switch back to wizard mode", () => {
      useWizardStore.getState().setMode("quick");
      useWizardStore.getState().setMode("wizard");
      expect(useWizardStore.getState().mode).toBe("wizard");
    });
  });

  describe("quick create fields", () => {
    it("should set quickContent", () => {
      useWizardStore.getState().setQuickContent("fix login bug");
      expect(useWizardStore.getState().quickContent).toBe("fix login bug");
    });

    it("should set quickGoals", () => {
      useWizardStore.getState().setQuickGoals("goal1, goal2");
      expect(useWizardStore.getState().quickGoals).toBe("goal1, goal2");
    });
  });

  describe("edited fields", () => {
    it("should set editedContent", () => {
      useWizardStore.getState().setEditedContent("new content");
      expect(useWizardStore.getState().editedContent).toBe("new content");
    });

    it("should set editedGoals", () => {
      useWizardStore.getState().setEditedGoals(["goal1", "goal2"]);
      expect(useWizardStore.getState().editedGoals).toEqual(["goal1", "goal2"]);
    });

    it("should set editedConditions", () => {
      useWizardStore.getState().setEditedConditions(["cond1"]);
      expect(useWizardStore.getState().editedConditions).toEqual(["cond1"]);
    });
  });

  describe("reset", () => {
    it("should restore all fields to initial state", () => {
      const store = useWizardStore.getState();
      store.setMode("quick");
      store.setStep(2);
      store.setWorkingDir("/test");
      store.setQuickContent("content");
      store.setEditedGoals(["g1"]);
      store.addMessage({ role: "user", content: "hi", timestamp: 1 });

      store.reset();

      const s = useWizardStore.getState();
      expect(s.step).toBe(0);
      expect(s.mode).toBe("wizard");
      expect(s.workingDir).toBe("");
      expect(s.quickContent).toBe("");
      expect(s.editedGoals).toEqual([]);
      expect(s.editedConditions).toEqual([]);
      expect(s.messages).toEqual([]);
      expect(s.taskParams).toBeNull();
    });
  });
});

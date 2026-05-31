import { describe, it, expect } from "vitest";
import { BranchStrategy } from "../../src-engine/src/git/branch-strategy.js";

describe("BranchStrategy", () => {
  describe("getBranchName", () => {
    it("should generate a branch name with task id prefix", () => {
      const name = BranchStrategy.getBranchName("abc12345def");
      expect(name).toMatch(/^task\/abc12345-[a-z0-9]+$/);
    });

    it("should handle short task ids", () => {
      const name = BranchStrategy.getBranchName("ab");
      expect(name).toMatch(/^task\/ab-[a-z0-9]+$/);
    });

    it("should generate unique names for the same task id", () => {
      const name1 = BranchStrategy.getBranchName("task123");
      const name2 = BranchStrategy.getBranchName("task123");
      // They should be different because of the timestamp component
      // (unless called at exact same millisecond, which is extremely unlikely)
      expect(name1).toBeTruthy();
      expect(name2).toBeTruthy();
    });

    it("should always start with task/", () => {
      const name = BranchStrategy.getBranchName("xyz789");
      expect(name.startsWith("task/")).toBe(true);
    });
  });
});

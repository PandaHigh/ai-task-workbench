export interface TaskTemplate {
  id: string;
  label: string;
  icon: string;
  content: string;
  goals: string[];
  terminationConditions: string[];
}

export const BUILT_IN_TEMPLATES: TaskTemplate[] = [
  {
    id: "bugfix",
    label: "修复 Bug",
    icon: "🐛",
    content: "修复以下 bug: [请描述 bug 表现]",
    goals: ["Bug 已修复且无回归"],
    terminationConditions: ["相关测试通过"],
  },
  {
    id: "feature",
    label: "新功能",
    icon: "✨",
    content: "实现 [请描述功能]",
    goals: ["功能已实现且可用"],
    terminationConditions: ["手动验证通过"],
  },
  {
    id: "refactor",
    label: "重构",
    icon: "♻️",
    content: "重构 [模块/文件]",
    goals: ["代码更清晰且功能不变"],
    terminationConditions: ["所有现有测试通过"],
  },
  {
    id: "test",
    label: "写测试",
    icon: "🧪",
    content: "为 [模块] 编写测试",
    goals: ["测试覆盖关键路径"],
    terminationConditions: ["npx vitest run 通过"],
  },
  {
    id: "review",
    label: "代码审查",
    icon: "🔍",
    content: "审查 [代码/文件]",
    goals: ["发现潜在问题并给出建议"],
    terminationConditions: ["审查报告已生成"],
  },
];

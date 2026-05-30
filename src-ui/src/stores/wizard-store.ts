import { create } from "zustand";
import type { TaskTemplate } from "../lib/task-templates";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

interface WizardStore {
  step: number;
  mode: "quick" | "wizard";
  workingDir: string;
  sessionId: string | null;
  messages: ChatMessage[];
  taskParams: {
    content: string;
    goals: string[];
    terminationConditions: string[];
    postCompletionAction: string;
  } | null;
  isValid: boolean;
  errors: string[];
  quickContent: string;
  quickGoals: string;
  editedContent: string;
  editedGoals: string[];
  editedConditions: string[];
  selectedTemplate: string | null;

  setStep: (step: number) => void;
  setMode: (mode: "quick" | "wizard") => void;
  setWorkingDir: (dir: string) => void;
  setSessionId: (id: string | null) => void;
  addMessage: (msg: ChatMessage) => void;
  setTaskParams: (params: WizardStore["taskParams"]) => void;
  setValidation: (isValid: boolean, errors: string[]) => void;
  setQuickContent: (content: string) => void;
  setQuickGoals: (goals: string) => void;
  setEditedContent: (content: string) => void;
  setEditedGoals: (goals: string[]) => void;
  setEditedConditions: (conditions: string[]) => void;
  setSelectedTemplate: (id: string | null) => void;
  applyTemplate: (template: TaskTemplate) => void;
  reset: () => void;
}

const initialState = {
  step: 0,
  mode: "wizard" as const,
  workingDir: "",
  sessionId: null as string | null,
  messages: [] as ChatMessage[],
  taskParams: null as WizardStore["taskParams"],
  isValid: false,
  errors: [] as string[],
  quickContent: "",
  quickGoals: "",
  editedContent: "",
  editedGoals: [] as string[],
  editedConditions: [] as string[],
  selectedTemplate: null as string | null,
};

export const useWizardStore = create<WizardStore>((set) => ({
  ...initialState,

  setStep: (step) => set({ step }),
  setMode: (mode) => set({ mode }),
  setWorkingDir: (dir) => set({ workingDir: dir }),
  setSessionId: (id) => set({ sessionId: id }),
  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),
  setTaskParams: (params) => set({ taskParams: params }),
  setValidation: (isValid, errors) => set({ isValid, errors }),
  setQuickContent: (quickContent) => set({ quickContent }),
  setQuickGoals: (quickGoals) => set({ quickGoals }),
  setEditedContent: (editedContent) => set({ editedContent }),
  setEditedGoals: (editedGoals) => set({ editedGoals }),
  setEditedConditions: (editedConditions) => set({ editedConditions }),
  setSelectedTemplate: (selectedTemplate) => set({ selectedTemplate }),
  applyTemplate: (template) =>
    set({
      selectedTemplate: template.id,
      editedContent: template.content,
      editedGoals: [...template.goals],
      editedConditions: [...template.terminationConditions],
      taskParams: {
        content: template.content,
        goals: [...template.goals],
        terminationConditions: [...template.terminationConditions],
        postCompletionAction: "无",
      },
      isValid: true,
      errors: [],
    }),
  reset: () => set(initialState),
}));

import { create } from "zustand";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

interface WizardStore {
  step: number;
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

  setStep: (step: number) => void;
  setWorkingDir: (dir: string) => void;
  setSessionId: (id: string | null) => void;
  addMessage: (msg: ChatMessage) => void;
  setTaskParams: (params: WizardStore["taskParams"]) => void;
  setValidation: (isValid: boolean, errors: string[]) => void;
  reset: () => void;
}

const initialState = {
  step: 0,
  workingDir: "",
  sessionId: null,
  messages: [],
  taskParams: null,
  isValid: false,
  errors: [],
};

export const useWizardStore = create<WizardStore>((set) => ({
  ...initialState,

  setStep: (step) => set({ step }),
  setWorkingDir: (dir) => set({ workingDir: dir }),
  setSessionId: (id) => set({ sessionId: id }),
  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),
  setTaskParams: (params) => set({ taskParams: params }),
  setValidation: (isValid, errors) => set({ isValid, errors }),
  reset: () => set(initialState),
}));

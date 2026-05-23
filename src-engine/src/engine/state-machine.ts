import { setup, createActor, type EventObject } from "xstate";
import type { ScoreDetails } from "@ai-workbench/shared";

export interface TaskContext {
  taskId: string;
  runId: string;
  result?: string;
  score?: ScoreDetails;
  error?: string;
  commitHash?: string;
}

export type TaskEvent =
  | { type: "START" }
  | { type: "COMPLETE"; result: string }
  | { type: "TIMEOUT" }
  | { type: "ERROR"; error: string }
  | { type: "SCORE_PASS"; score: ScoreDetails }
  | { type: "SCORE_FAIL"; score: ScoreDetails }
  | { type: "COMMIT_SUCCESS"; hash: string }
  | { type: "COMMIT_ERROR"; error: string }
  | { type: "REVERT_SUCCESS" }
  | { type: "REVERT_ERROR"; error: string }
  | { type: "CANCEL" };

export const taskMachine = setup({
  types: {
    context: {} as TaskContext,
    events: {} as TaskEvent,
  },
}).createMachine({
  id: "task",
  initial: "pending",
  context: {
    taskId: "",
    runId: "",
  },
  states: {
    pending: {
      on: {
        START: { target: "running" },
        CANCEL: { target: "cancelled" },
      },
    },

    running: {
      on: {
        COMPLETE: { target: "scoring", actions: ({ event, context }) => {
          if (event.type === "COMPLETE") context.result = event.result;
        }},
        TIMEOUT: { target: "failed", actions: ({ context }) => {
          context.error = "Task timed out";
        }},
        ERROR: { target: "failed", actions: ({ event, context }) => {
          if (event.type === "ERROR") context.error = event.error;
        }},
        CANCEL: { target: "cancelled" },
      },
    },

    scoring: {
      on: {
        SCORE_PASS: { target: "committing", actions: ({ event, context }) => {
          if (event.type === "SCORE_PASS") context.score = event.score;
        }},
        SCORE_FAIL: { target: "reverting", actions: ({ event, context }) => {
          if (event.type === "SCORE_FAIL") context.score = event.score;
        }},
        ERROR: { target: "failed", actions: ({ event, context }) => {
          if (event.type === "ERROR") context.error = event.error;
        }},
      },
    },

    committing: {
      on: {
        COMMIT_SUCCESS: { target: "completed", actions: ({ event, context }) => {
          if (event.type === "COMMIT_SUCCESS") context.commitHash = event.hash;
        }},
        COMMIT_ERROR: { target: "failed", actions: ({ event, context }) => {
          if (event.type === "COMMIT_ERROR") context.error = event.error;
        }},
      },
    },

    reverting: {
      on: {
        REVERT_SUCCESS: { target: "reverted" },
        REVERT_ERROR: { target: "failed", actions: ({ event, context }) => {
          if (event.type === "REVERT_ERROR") context.error = event.error;
        }},
      },
    },

    completed: { type: "final" },
    reverted: { type: "final" },
    failed: { type: "final" },
    cancelled: { type: "final" },
  },
});

export function createTaskActor(taskId: string, runId: string) {
  return createActor(taskMachine, {
    input: { taskId, runId },
  });
}

export type TaskState = typeof taskMachine;
export type TaskSnapshot = ReturnType<ReturnType<typeof createTaskActor>["getSnapshot"]>;

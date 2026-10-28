import type { ProjectPlan, ProjectStep, StepCheck } from './types';

// Pure Project mode session engine. No React Native imports: the glasses,
// phone, and tests all drive the same step state machine.

export interface ProjectSessionState {
  plan: ProjectPlan;
  currentStep: number;
  completed: boolean[];
  status: 'building' | 'done';
  lastCheck: StepCheck | null;
}

/** Starts a session at step 0. Throws on a plan with no steps. */
export function createSession(plan: ProjectPlan): ProjectSessionState {
  if (!plan.steps || plan.steps.length === 0) {
    throw new Error('project plan has no steps');
  }
  return {
    plan,
    currentStep: 0,
    completed: plan.steps.map(() => false),
    status: 'building',
    lastCheck: null,
  };
}

/**
 * Returns a NEW state with the vision verdict applied; the input state is
 * never mutated. 'complete' marks the current step done and advances
 * (finishing the last step sets status 'done'); 'mistake' and 'unclear'
 * stay on the step. Every verdict is recorded in lastCheck.
 */
export function applyCheck(
  state: ProjectSessionState,
  check: StepCheck,
): ProjectSessionState {
  if (state.status === 'done') {
    return { ...state, completed: [...state.completed], lastCheck: check };
  }
  if (check.verdict !== 'complete') {
    return { ...state, completed: [...state.completed], lastCheck: check };
  }
  const completed = [...state.completed];
  completed[state.currentStep] = true;
  const nextStep = state.currentStep + 1;
  const isDone = nextStep >= state.plan.steps.length;
  return {
    ...state,
    completed,
    currentStep: isDone ? state.plan.steps.length : nextStep,
    status: isDone ? 'done' : 'building',
    lastCheck: check,
  };
}

/**
 * Synthetic verdict for the manual "Next step" button. Manual advance goes
 * through applyCheck with this check so session state stays the single
 * source of truth — never bump currentStep directly.
 */
export const MANUAL_STEP_CHECK: StepCheck = {
  verdict: 'complete',
  detail: 'Manually marked complete.',
  confidence: 1,
};

/**
 * Returns a NEW state moved back one step; the input state is never
 * mutated. Reopens a finished session on its last step and clamps at the
 * first step. Completed flags are kept — re-completing a revisited step
 * goes through applyCheck again.
 */
export function previousStep(
  state: ProjectSessionState,
): ProjectSessionState {
  const target =
    state.status === 'done'
      ? state.plan.steps.length - 1
      : Math.max(0, state.currentStep - 1);
  return {
    ...state,
    completed: [...state.completed],
    currentStep: Math.max(0, target),
    status: 'building',
  };
}

/** The step the user should be working on, or null when done. */
export function currentStepOf(state: ProjectSessionState): ProjectStep | null {
  if (state.status === 'done') return null;
  return state.plan.steps[state.currentStep] ?? null;
}

export function stepProgress(state: ProjectSessionState): {
  done: number;
  total: number;
} {
  return {
    done: state.completed.filter(Boolean).length,
    total: state.plan.steps.length,
  };
}

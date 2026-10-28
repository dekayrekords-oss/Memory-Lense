import { describe, expect, it } from '@jest/globals';
import {
  applyCheck,
  createSession,
  currentStepOf,
  stepProgress,
} from '../projectSession';
import type { ProjectPlan, StepCheck } from '../types';

const PLAN: ProjectPlan = {
  title: 'Desk build',
  steps: [
    {
      title: 'Unbox and sort',
      parts: ['Table top x1', 'Leg x4'],
      instruction: 'Lay every part on the floor.',
    },
    {
      title: 'Attach the legs',
      parts: ['Leg x4', 'Screw A x8'],
      instruction: 'Screw each leg into a corner bracket.',
    },
  ],
};

const COMPLETE: StepCheck = {
  verdict: 'complete',
  detail: 'Step looks done',
  confidence: 0.92,
};
const MISTAKE: StepCheck = {
  verdict: 'mistake',
  detail: 'Leg is reversed',
  confidence: 0.81,
};
const UNCLEAR: StepCheck = {
  verdict: 'unclear',
  detail: 'Photo is blurry',
  confidence: 0.3,
};

describe('createSession', () => {
  it('starts at step 0 with nothing completed', () => {
    const state = createSession(PLAN);
    expect(state.plan).toBe(PLAN);
    expect(state.currentStep).toBe(0);
    expect(state.completed).toEqual([false, false]);
    expect(state.status).toBe('building');
    expect(state.lastCheck).toBeNull();
    expect(currentStepOf(state)).toEqual(PLAN.steps[0]);
    expect(stepProgress(state)).toEqual({ done: 0, total: 2 });
  });

  it('throws on an empty plan', () => {
    expect(() => createSession({ title: 'Empty', steps: [] })).toThrow();
  });
});

describe('applyCheck', () => {
  it('advances on complete and marks the step done', () => {
    const next = applyCheck(createSession(PLAN), COMPLETE);
    expect(next.currentStep).toBe(1);
    expect(next.completed).toEqual([true, false]);
    expect(next.status).toBe('building');
    expect(next.lastCheck).toEqual(COMPLETE);
    expect(currentStepOf(next)).toEqual(PLAN.steps[1]);
    expect(stepProgress(next)).toEqual({ done: 1, total: 2 });
  });

  it('stays on the step on mistake and records lastCheck', () => {
    const next = applyCheck(createSession(PLAN), MISTAKE);
    expect(next.currentStep).toBe(0);
    expect(next.completed).toEqual([false, false]);
    expect(next.status).toBe('building');
    expect(next.lastCheck).toEqual(MISTAKE);
    expect(currentStepOf(next)).toEqual(PLAN.steps[0]);
  });

  it('stays on the step on unclear and records lastCheck', () => {
    const next = applyCheck(createSession(PLAN), UNCLEAR);
    expect(next.currentStep).toBe(0);
    expect(next.completed).toEqual([false, false]);
    expect(next.status).toBe('building');
    expect(next.lastCheck).toEqual(UNCLEAR);
    expect(currentStepOf(next)).toEqual(PLAN.steps[0]);
  });

  it('is done after completing the last step', () => {
    const afterFirst = applyCheck(createSession(PLAN), COMPLETE);
    const done = applyCheck(afterFirst, COMPLETE);
    expect(done.status).toBe('done');
    expect(done.completed).toEqual([true, true]);
    expect(currentStepOf(done)).toBeNull();
    expect(stepProgress(done)).toEqual({ done: 2, total: 2 });
  });

  it('does not mutate the input state', () => {
    const state = createSession(PLAN);
    const completedRef = state.completed;
    const next = applyCheck(state, COMPLETE);
    expect(next).not.toBe(state);
    expect(next.completed).not.toBe(completedRef);
    expect(state.currentStep).toBe(0);
    expect(state.completed).toEqual([false, false]);
    expect(state.status).toBe('building');
    expect(state.lastCheck).toBeNull();
  });

  it('does not mutate the input state on mistake either', () => {
    const state = createSession(PLAN);
    const next = applyCheck(state, MISTAKE);
    expect(next).not.toBe(state);
    expect(state.lastCheck).toBeNull();
    expect(state.currentStep).toBe(0);
  });
});

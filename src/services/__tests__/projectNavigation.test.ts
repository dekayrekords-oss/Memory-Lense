import { describe, expect, it } from '@jest/globals';
import {
  applyCheck,
  createSession,
  currentStepOf,
  MANUAL_STEP_CHECK,
  previousStep,
  stepProgress,
} from '../projectSession';
import type { ProjectPlan } from '../types';

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

describe('MANUAL_STEP_CHECK (Next step manual advance)', () => {
  it('is a synthetic complete check with clamped confidence', () => {
    expect(MANUAL_STEP_CHECK.verdict).toBe('complete');
    expect(MANUAL_STEP_CHECK.confidence).toBeGreaterThanOrEqual(0);
    expect(MANUAL_STEP_CHECK.confidence).toBeLessThanOrEqual(1);
    expect(typeof MANUAL_STEP_CHECK.detail).toBe('string');
  });

  it('advances through applyCheck and marks the step done', () => {
    const next = applyCheck(createSession(PLAN), MANUAL_STEP_CHECK);
    expect(next.currentStep).toBe(1);
    expect(next.completed).toEqual([true, false]);
    expect(next.status).toBe('building');
    expect(next.lastCheck).toEqual(MANUAL_STEP_CHECK);
    expect(currentStepOf(next)).toEqual(PLAN.steps[1]);
    expect(stepProgress(next)).toEqual({ done: 1, total: 2 });
  });

  it('finishes the session on the last step', () => {
    const afterFirst = applyCheck(createSession(PLAN), MANUAL_STEP_CHECK);
    const done = applyCheck(afterFirst, MANUAL_STEP_CHECK);
    expect(done.status).toBe('done');
    expect(done.completed).toEqual([true, true]);
    expect(currentStepOf(done)).toBeNull();
    expect(stepProgress(done)).toEqual({ done: 2, total: 2 });
  });

  it('does not mutate the input state', () => {
    const state = createSession(PLAN);
    const next = applyCheck(state, MANUAL_STEP_CHECK);
    expect(next).not.toBe(state);
    expect(state.currentStep).toBe(0);
    expect(state.completed).toEqual([false, false]);
    expect(state.lastCheck).toBeNull();
  });
});

describe('previousStep (Back navigation)', () => {
  it('moves back one step and keeps completed flags', () => {
    const advanced = applyCheck(createSession(PLAN), MANUAL_STEP_CHECK);
    const back = previousStep(advanced);
    expect(back.currentStep).toBe(0);
    expect(back.completed).toEqual([true, false]);
    expect(back.status).toBe('building');
    expect(currentStepOf(back)).toEqual(PLAN.steps[0]);
  });

  it('reopens a done session on the last step', () => {
    const done = applyCheck(
      applyCheck(createSession(PLAN), MANUAL_STEP_CHECK),
      MANUAL_STEP_CHECK,
    );
    expect(done.status).toBe('done');
    const back = previousStep(done);
    expect(back.status).toBe('building');
    expect(back.currentStep).toBe(PLAN.steps.length - 1);
    expect(currentStepOf(back)).toEqual(PLAN.steps[PLAN.steps.length - 1]);
  });

  it('clamps at the first step', () => {
    const state = createSession(PLAN);
    const back = previousStep(state);
    expect(back.currentStep).toBe(0);
    expect(back.status).toBe('building');
    expect(currentStepOf(back)).toEqual(PLAN.steps[0]);
  });

  it('does not mutate the input state', () => {
    const advanced = applyCheck(createSession(PLAN), MANUAL_STEP_CHECK);
    const back = previousStep(advanced);
    expect(back).not.toBe(advanced);
    expect(back.completed).not.toBe(advanced.completed);
    expect(advanced.currentStep).toBe(1);
    expect(advanced.status).toBe('building');
  });
});

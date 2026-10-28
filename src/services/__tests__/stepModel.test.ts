import { describe, expect, it } from '@jest/globals';
import {
  buildStepModel,
  classifyPart,
  MAX_PART_COPIES,
  partMeshProps,
  type StepModel,
} from '../stepModel';
import type { ProjectPlan } from '../types';

describe('classifyPart', () => {
  it('maps legs and posts to tall cylinders', () => {
    expect(classifyPart('Leg x4').kind).toBe('cylinder');
    expect(classifyPart('table post').kind).toBe('cylinder');
    const { size } = classifyPart('Leg');
    expect(size[1]).toBeGreaterThan(size[0]); // taller than wide
  });

  it('maps tops, panels, and shelves to flat boxes', () => {
    for (const label of ['Table top x1', 'side panel', 'Shelf', 'board']) {
      const part = classifyPart(label);
      expect(part.kind).toBe('box');
      expect(part.size[1]).toBeLessThan(part.size[0]); // flatter than wide
    }
  });

  it('maps fasteners to small cylinders and knobs to spheres', () => {
    expect(classifyPart('Screw A x8').kind).toBe('cylinder');
    expect(classifyPart('bolt').size[0]).toBeLessThan(0.2);
    expect(classifyPart('knob').kind).toBe('sphere');
    expect(classifyPart('handle').kind).toBe('sphere');
  });

  it('falls back to a box for unknown parts and keeps the label', () => {
    const part = classifyPart('Cable tray x1');
    expect(part.kind).toBe('box');
    expect(part.label).toBe('Cable tray');
  });

  it('strips quantity suffixes from labels', () => {
    expect(classifyPart('Leg x4').label).toBe('Leg');
    expect(classifyPart('Screw A ×8').label).toBe('Screw A');
    expect(classifyPart('Table top').label).toBe('Table top');
  });
});

const DESK_PLAN: ProjectPlan = {
  title: 'Desk build',
  steps: [
    { title: 'Unbox', parts: ['Table top x1', 'Leg x4'], instruction: 'Lay out.' },
    { title: 'Attach legs', parts: ['Screw A x8'], instruction: 'Screw in.' },
    { title: 'Level', parts: ['Foot pad x4'], instruction: 'Adjust.' },
  ],
};

describe('buildStepModel', () => {
  it('expands quantities into one primitive per part', () => {
    const model = buildStepModel(DESK_PLAN, 0);
    // 1 top + 4 legs + 8 screws + 4 pads
    expect(model.parts).toHaveLength(17);
    const ids = model.parts.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('caps runaway quantities', () => {
    const plan: ProjectPlan = {
      title: 'Screws',
      steps: [{ title: 'All', parts: ['Screw x100'], instruction: 'Go.' }],
    };
    expect(buildStepModel(plan, 0).parts).toHaveLength(MAX_PART_COPIES);
  });

  it('marks done, current, and todo steps', () => {
    const model: StepModel = buildStepModel(DESK_PLAN, 1);
    const byStep = (i: number) =>
      model.parts.filter((p) => p.id.startsWith(`${i}:`));
    expect(byStep(0).every((p) => p.state === 'done')).toBe(true);
    expect(byStep(1).every((p) => p.state === 'current')).toBe(true);
    expect(byStep(2).every((p) => p.state === 'todo')).toBe(true);
  });

  it('marks everything done when the build finished', () => {
    const model = buildStepModel(DESK_PLAN, DESK_PLAN.steps.length);
    expect(model.parts.every((p) => p.state === 'done')).toBe(true);
  });

  it('lays parts out deterministically with a positive frame radius', () => {
    const a = buildStepModel(DESK_PLAN, 1);
    const b = buildStepModel(DESK_PLAN, 1);
    expect(a).toEqual(b);
    expect(a.radius).toBeGreaterThan(0);
    for (const part of a.parts) {
      expect(part.position.every(Number.isFinite)).toBe(true);
      // Parts rest on or above the ground plane.
      expect(part.position[1]).toBeGreaterThanOrEqual(0);
    }
  });

  it('handles empty plans and clamps the step index', () => {
    const empty: ProjectPlan = { title: 'Empty', steps: [] };
    expect(buildStepModel(empty, 0)).toEqual({ parts: [], radius: 1 });
    const neg = buildStepModel(DESK_PLAN, -5);
    expect(neg.parts.filter((p) => p.state === 'current')).toHaveLength(5);
    const far = buildStepModel(DESK_PLAN, 99);
    expect(far.parts.every((p) => p.state === 'done')).toBe(true);
  });
});

describe('partMeshProps', () => {
  const model = buildStepModel(DESK_PLAN, 1);
  const byId = (id: string) => model.parts.find((p) => p.id === id)!;

  it('sizes geometries from the part (radii are half-widths)', () => {
    // Table top: flat box, full size triplet.
    expect(partMeshProps(byId('0:0:0')).geometryArgs).toEqual([2.4, 0.15, 1.4]);
    // Leg: cylinder radiusTop/radiusBottom/height/segments.
    expect(partMeshProps(byId('0:1:0')).geometryArgs).toEqual([
      0.12, 0.12, 2.2, 20,
    ]);
  });

  it('highlights the current step and ghosts future steps', () => {
    const current = partMeshProps(byId('1:0:0'));
    expect(current.color).toBe('#ff8c1a');
    expect(current.emissiveIntensity).toBeGreaterThan(0);
    expect(current.opacity).toBe(1);
    const todo = partMeshProps(byId('2:0:0'));
    expect(todo.transparent).toBe(true);
    expect(todo.opacity).toBeLessThan(1);
    expect(todo.emissiveIntensity).toBe(0);
    const done = partMeshProps(byId('0:0:0'));
    expect(done.transparent).toBe(false);
    expect(done.opacity).toBe(1);
    expect(done.emissiveIntensity).toBe(0);
  });
});

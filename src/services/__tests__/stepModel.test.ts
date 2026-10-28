import { describe, expect, it } from '@jest/globals';
import {
  buildStepModel,
  classifyPart,
  describePart,
  MAX_PART_COPIES,
  partMeshProps,
  partRenderMode,
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

  it('parses WxDxH centimeter dimensions into a measured size', () => {
    const part = classifyPart('Table top 120x60x3 cm x1');
    expect(part.label).toBe('Table top');
    expect(part.copies).toBe(1);
    expect(part.size[0]).toBeCloseTo(2.4); // 120 cm wide
    expect(part.size[1]).toBeCloseTo(0.06); // 3 cm thick
    expect(part.size[2]).toBeCloseTo(1.2); // 60 cm deep
    expect(part.dimensionsCm?.[0]).toBeCloseTo(120);
    expect(part.dimensionsCm?.[1]).toBeCloseTo(3);
    expect(part.dimensionsCm?.[2]).toBeCloseTo(60);
  });

  it('parses a single length for legs and keeps the quantity', () => {
    const part = classifyPart('Leg 70 cm x4');
    expect(part.label).toBe('Leg');
    expect(part.copies).toBe(4);
    expect(part.kind).toBe('cylinder');
    expect(part.size[1]).toBeCloseTo(1.4); // 70 cm tall
    expect(part.dimensionsCm?.[1]).toBeCloseTo(70);
  });

  it('does not read a bare WxD size as a quantity', () => {
    const part = classifyPart('Panel 120x60');
    expect(part.copies).toBe(1);
    expect(part.label).toBe('Panel');
    expect(part.size[0]).toBeCloseTo(2.4);
    expect(part.size[2]).toBeCloseTo(1.2);
  });

  it('converts inches and millimeters to centimeters', () => {
    expect(classifyPart('Shelf 24in').size[0]).toBeCloseTo((24 * 2.54) / 50);
    expect(classifyPart('Post 300mm').size[1]).toBeCloseTo(30 / 50);
  });

  it('leaves dimensions unset when the part names none', () => {
    expect(classifyPart('Leg x4').dimensionsCm).toBeUndefined();
  });

  it('parses an optional GLTF model reference', () => {
    const part = classifyPart('Leg (model: https://example.com/leg.glb) x4');
    expect(part.label).toBe('Leg');
    expect(part.copies).toBe(4);
    expect(part.modelUri).toBe('https://example.com/leg.glb');
    expect(partRenderMode(part)).toBe('gltf');
    expect(partRenderMode(classifyPart('Leg x4'))).toBe('primitive');
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

  it('carries step index, dimensions, and model refs onto parts', () => {
    const plan: ProjectPlan = {
      title: 'Measured desk',
      steps: [
        {
          title: 'Top',
          parts: ['Table top 120x60x3 cm x1'],
          instruction: 'Lay out.',
        },
        {
          title: 'Legs',
          parts: ['Leg 70 cm (model: https://example.com/leg.glb) x4'],
          instruction: 'Attach.',
        },
      ],
    };
    const model = buildStepModel(plan, 1);
    const top = model.parts.find((p) => p.id === '0:0:0')!;
    expect(top.stepIndex).toBe(0);
    expect(top.dimensionsCm?.[0]).toBeCloseTo(120);
    const leg = model.parts.find((p) => p.id === '1:0:0')!;
    expect(leg.stepIndex).toBe(1);
    expect(leg.modelUri).toBe('https://example.com/leg.glb');
    expect(leg.size[1]).toBeCloseTo(1.4);
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

  it('highlights a selected part and un-ghosts it', () => {
    const selected = partMeshProps(byId('2:0:0'), { selected: true });
    expect(selected.transparent).toBe(false);
    expect(selected.opacity).toBe(1);
    expect(selected.emissive).toBe('#ff8c1a');
    expect(selected.emissiveIntensity).toBeGreaterThan(0.5);
  });
});

describe('describePart', () => {
  it('names the part, copy, step, state, and measured size', () => {
    const plan: ProjectPlan = {
      title: 'Measured desk',
      steps: [
        { title: 'Top', parts: ['Table top x1'], instruction: 'Lay out.' },
        { title: 'Legs', parts: ['Leg 70 cm x4'], instruction: 'Attach.' },
      ],
    };
    const model = buildStepModel(plan, 1);
    const leg = model.parts.find((p) => p.id === '1:0:1')!;
    expect(describePart(leg)).toBe(
      'Leg 2 of 4 — step 2 · current step · 12 × 12 × 70 cm',
    );
    const top = model.parts.find((p) => p.id === '0:0:0')!;
    expect(describePart(top)).toBe('Table top — step 1 · done');
  });
});

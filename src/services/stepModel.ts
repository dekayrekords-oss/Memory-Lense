import type { ProjectPlan } from './types';

// Pure 3D step-model builder: turns a parsed instruction plan into a
// declarative scene of parameterized primitives (no meshes, no downloads).
// The view layer (StepModelView) renders this description with three.js;
// this module stays dependency-free so the mapping is fully unit-tested.
//
// Layout is a readable staging, not a true assembly: finished steps sit
// assembled at the back-center, the current step's parts stage in front,
// and future steps wait behind — ghosted until their turn.

export type PrimitiveKind = 'box' | 'cylinder' | 'sphere';

export type PartState = 'done' | 'current' | 'todo';

export interface ClassifiedPart {
  /** Quantity suffix stripped ("Leg x4" -> "Leg"). */
  label: string;
  kind: PrimitiveKind;
  /** Width, height, depth in scene units. */
  size: [number, number, number];
  copies: number;
}

export interface ModelPart extends ClassifiedPart {
  /** Stable id `${stepIndex}:${partIndex}:${copyIndex}`. */
  id: string;
  copyIndex: number;
  position: [number, number, number];
  state: PartState;
}

export interface StepModel {
  parts: ModelPart[];
  /** Bounding radius for camera framing. Always positive. */
  radius: number;
}

/** Copies per part line at most — bounds runaway "x100" quantities. */
export const MAX_PART_COPIES = 12;

/** State colors for the 3D preview (single source of truth for the view). */
export const STATE_COLOR: Record<PartState, string> = {
  done: '#5b8def',
  current: '#ff8c1a',
  todo: '#9aa3b2',
};

export interface PartMeshProps {
  /** Constructor args for the three.js geometry. */
  geometryArgs: number[];
  color: string;
  roughness: number;
  metalness: number;
  transparent: boolean;
  opacity: number;
  emissive: string;
  emissiveIntensity: number;
}

/**
 * Visual encoding of one model part: geometry args plus the material that
 * carries its state (current step glows orange, future steps ghost).
 */
export function partMeshProps(part: ModelPart): PartMeshProps {
  const [w, h] = part.size;
  const geometryArgs =
    part.kind === 'box'
      ? [...part.size]
      : part.kind === 'cylinder'
        ? [w / 2, w / 2, h, 20]
        : [w / 2, 20, 14];
  const current = part.state === 'current';
  const todo = part.state === 'todo';
  return {
    geometryArgs,
    color: STATE_COLOR[part.state],
    roughness: 0.55,
    metalness: 0.1,
    transparent: todo,
    opacity: todo ? 0.35 : 1,
    emissive: current ? '#7a3c00' : '#000000',
    emissiveIntensity: current ? 0.5 : 0,
  };
}

const QUANTITY = /\s*[x×*]\s*(\d+)\s*$/i;

function match(label: string, words: string[]): boolean {
  return words.some((w) => label.includes(w));
}

function classifyKind(label: string): {
  kind: PrimitiveKind;
  size: [number, number, number];
} {
  if (match(label, ['leg', 'post', 'pole', 'column'])) {
    return { kind: 'cylinder', size: [0.24, 2.2, 0.24] };
  }
  if (match(label, ['screw', 'bolt', 'nut', 'peg', 'dowel', 'pin', 'nail'])) {
    return { kind: 'cylinder', size: [0.09, 0.3, 0.09] };
  }
  if (match(label, ['knob', 'handle'])) {
    return { kind: 'sphere', size: [0.3, 0.3, 0.3] };
  }
  if (match(label, ['wheel', 'caster'])) {
    return { kind: 'sphere', size: [0.36, 0.36, 0.36] };
  }
  if (match(label, ['foot', 'pad'])) {
    return { kind: 'cylinder', size: [0.3, 0.12, 0.3] };
  }
  if (match(label, ['door', 'drawer'])) {
    return { kind: 'box', size: [1.6, 2.0, 0.12] };
  }
  if (match(label, ['tray'])) {
    return { kind: 'box', size: [1.2, 0.15, 0.8] };
  }
  if (
    match(label, [
      'top',
      'panel',
      'shelf',
      'board',
      'plank',
      'table',
      'sheet',
      'desk',
    ])
  ) {
    return { kind: 'box', size: [2.4, 0.15, 1.4] };
  }
  if (match(label, ['cable', 'wire', 'rope', 'cord'])) {
    return { kind: 'box', size: [1.5, 0.08, 0.08] };
  }
  if (match(label, ['bracket', 'corner', 'hinge', 'clip', 'mount'])) {
    return { kind: 'box', size: [0.3, 0.3, 0.15] };
  }
  return { kind: 'box', size: [0.5, 0.5, 0.5] };
}

export function classifyPart(raw: string): ClassifiedPart {
  const trimmed = raw.trim();
  const quantity = trimmed.match(QUANTITY);
  const label = (quantity ? trimmed.slice(0, quantity.index) : trimmed).trim();
  const copies = quantity
    ? Math.min(MAX_PART_COPIES, Math.max(1, parseInt(quantity[1], 10)))
    : 1;
  const { kind, size } = classifyKind(label.toLowerCase());
  return { label: label || trimmed, kind, size, copies };
}

const ROW_GAP = 0.35;
const ZONE_DEPTH = 2.4;

function zoneDepth(state: PartState): number {
  if (state === 'current') return ZONE_DEPTH;
  if (state === 'todo') return -ZONE_DEPTH;
  return 0;
}

export function buildStepModel(
  plan: ProjectPlan,
  currentStep: number,
): StepModel {
  const steps = plan.steps ?? [];
  if (steps.length === 0) return { parts: [], radius: 1 };
  const current = Math.min(
    steps.length,
    Math.max(0, Math.floor(currentStep)),
  );

  // Expand quantities, then lay each state zone out as a centered row.
  const expanded: (ClassifiedPart & {
    stepIndex: number;
    partIndex: number;
    state: PartState;
  })[] = [];
  steps.forEach((step, stepIndex) => {
    const state: PartState =
      stepIndex < current ? 'done' : stepIndex === current ? 'current' : 'todo';
    (step.parts ?? []).forEach((raw, partIndex) => {
      expanded.push({ ...classifyPart(raw), stepIndex, partIndex, state });
    });
  });

  const parts: ModelPart[] = [];
  (['done', 'current', 'todo'] as const).forEach((state) => {
    const zone = expanded.filter((e) => e.state === state);
    const copies = zone.flatMap((e) =>
      Array.from({ length: e.copies }, (_, copyIndex) => ({ ...e, copyIndex })),
    );
    const rowWidth =
      copies.reduce((n, c) => n + c.size[0], 0) +
      ROW_GAP * Math.max(0, copies.length - 1);
    let cursor = -rowWidth / 2;
    for (const copy of copies) {
      const [w, h] = copy.size;
      parts.push({
        label: copy.label,
        kind: copy.kind,
        size: copy.size,
        copies: copy.copies,
        id: `${copy.stepIndex}:${copy.partIndex}:${copy.copyIndex}`,
        copyIndex: copy.copyIndex,
        position: [cursor + w / 2, h / 2, zoneDepth(state)],
        state,
      });
      cursor += w + ROW_GAP;
    }
  });

  let radius = 1;
  for (const part of parts) {
    const [x, , z] = part.position;
    const extent = Math.hypot(x, z) + Math.max(...part.size) / 2;
    if (extent > radius) radius = extent;
  }
  return { parts, radius: radius + 1.2 };
}

import type { ProjectPlan } from './types';

// Pure 3D step-model builder: turns a parsed instruction plan into a
// declarative scene of parameterized primitives (no meshes, no downloads).
// The view layer (StepModelView) renders this description with three.js;
// this module stays dependency-free so the mapping is fully unit-tested.
//
// Part text may carry real dimensions ("Table top 120x60x3 cm", "Leg 70 cm")
// and an optional GLTF model reference ("Leg (model: https://…)"); both are
// parsed here so the view stays a thin renderer.
//
// Layout is a readable staging, not a true assembly: finished steps sit
// assembled at the back-center, the current step's parts stage in front,
// and future steps wait behind — ghosted until their turn.

export type PrimitiveKind = 'box' | 'cylinder' | 'sphere';

export type PartState = 'done' | 'current' | 'todo';

export interface ClassifiedPart {
  /** Quantity, dimension, and model suffixes stripped ("Leg 70cm x4" -> "Leg"). */
  label: string;
  kind: PrimitiveKind;
  /** Width, height, depth in scene units. */
  size: [number, number, number];
  copies: number;
  /**
   * Real-world width × height × depth in cm when the part text named
   * dimensions; undefined when the category default size was used.
   */
  dimensionsCm?: [number, number, number];
  /** Optional GLTF model URI from a "(model: <uri>)" suffix. */
  modelUri?: string;
}

export interface ModelPart extends ClassifiedPart {
  /** Stable id `${stepIndex}:${partIndex}:${copyIndex}`. */
  id: string;
  /** Index of the plan step this part belongs to. */
  stepIndex: number;
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

/** Real-world centimeters represented by one scene unit. */
export const CM_PER_SCENE_UNIT = 50;

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
 * A selected part (tap-to-identify) glows brighter and never ghosts.
 */
export function partMeshProps(
  part: ModelPart,
  options: { selected?: boolean } = {},
): PartMeshProps {
  const [w, h] = part.size;
  const geometryArgs =
    part.kind === 'box'
      ? [...part.size]
      : part.kind === 'cylinder'
        ? [w / 2, w / 2, h, 20]
        : [w / 2, 20, 14];
  const current = part.state === 'current';
  const todo = part.state === 'todo' && !options.selected;
  return {
    geometryArgs,
    color: STATE_COLOR[part.state],
    roughness: 0.55,
    metalness: 0.1,
    transparent: todo,
    opacity: todo ? 0.35 : 1,
    emissive: options.selected
      ? '#ff8c1a'
      : current
        ? '#7a3c00'
        : '#000000',
    emissiveIntensity: options.selected ? 0.9 : current ? 0.5 : 0,
  };
}

/** How the view should render a part: its GLTF model when one is named. */
export function partRenderMode(part: ClassifiedPart): 'gltf' | 'primitive' {
  return part.modelUri ? 'gltf' : 'primitive';
}

const STATE_TEXT: Record<PartState, string> = {
  done: 'done',
  current: 'current step',
  todo: 'upcoming',
};

function formatDimensionsCm([w, h, d]: [number, number, number]): string {
  const round = (n: number) => Math.round(n * 10) / 10;
  return `${round(w)} × ${round(d)} × ${round(h)} cm`;
}

/** One-line identity for tap-to-identify: part, copy, step, state, size. */
export function describePart(part: ModelPart): string {
  const copy =
    part.copies > 1 ? ` ${part.copyIndex + 1} of ${part.copies}` : '';
  const dims = part.dimensionsCm
    ? ` · ${formatDimensionsCm(part.dimensionsCm)}`
    : '';
  return (
    `${part.label}${copy} — step ${part.stepIndex + 1} · ` +
    `${STATE_TEXT[part.state]}${dims}`
  );
}

// Quantity needs whitespace before the marker ("Leg x4") so dimension
// strings ("120x60") are never mistaken for a quantity.
const QUANTITY = /\s+[x×*]\s*(\d+)\s*$/i;

const MODEL_REF = /\(\s*model\s*:\s*([^)\s]+)\s*\)/i;

// "120x60x3 cm", "120 x 60 cm", "70 cm", "28in": 1–3 numbers joined by
// x/× with an optional trailing unit. A lone number counts only with a
// unit; a bare multi-number size is read as centimeters.
const DIMENSION_SEQ =
  /(\d+(?:\.\d+)?)\s*(?:[x×]\s*(\d+(?:\.\d+)?)\s*)?(?:[x×]\s*(\d+(?:\.\d+)?)\s*)?(mm|cm|m|in|inch|")?/i;

const UNIT_TO_CM: Record<string, number> = {
  mm: 0.1,
  cm: 1,
  m: 100,
  in: 2.54,
  inch: 2.54,
  '"': 2.54,
};

interface ParsedDimensions {
  /** Numbers as written, converted to cm, in written order. */
  valuesCm: number[];
  /** The matched text, so the caller can strip it from the label. */
  text: string;
}

function parseDimensions(text: string): ParsedDimensions | null {
  const match = text.match(DIMENSION_SEQ);
  if (!match || match.index === undefined) return null;
  const raw = [match[1], match[2], match[3]].filter(
    (v): v is string => typeof v === 'string',
  );
  const unit = match[4]?.toLowerCase();
  if (raw.length === 1 && !unit) return null;
  const factor = UNIT_TO_CM[unit ?? 'cm'] ?? 1;
  return {
    valuesCm: raw.map((v) => parseFloat(v) * factor),
    text: match[0],
  };
}

function clampSize(value: number): number {
  return Math.min(5, Math.max(0.04, value));
}

/**
 * Maps written dimensions (cm, in written order) onto the classified
 * size: boxes read W×D×H, cylinders diameter×height, spheres a diameter.
 * Unwritten axes keep the category default.
 */
function sizeFromDimensions(
  kind: PrimitiveKind,
  fallback: [number, number, number],
  valuesCm: number[],
): [number, number, number] {
  const cm = (v: number) => clampSize(v / CM_PER_SCENE_UNIT);
  const [a, b, c] = valuesCm;
  if (kind === 'sphere') return [cm(a), cm(a), cm(a)];
  if (kind === 'cylinder') {
    return b === undefined
      ? [fallback[0], cm(a), fallback[2]]
      : [cm(a), cm(b), cm(a)];
  }
  if (valuesCm.length >= 3) return [cm(a), cm(c), cm(b)];
  if (valuesCm.length === 2) return [cm(a), fallback[1], cm(b)];
  return [cm(a), fallback[1], fallback[2]];
}

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
  const copies = quantity
    ? Math.min(MAX_PART_COPIES, Math.max(1, parseInt(quantity[1], 10)))
    : 1;
  let rest = (quantity ? trimmed.slice(0, quantity.index) : trimmed).trim();

  let modelUri: string | undefined;
  const model = rest.match(MODEL_REF);
  if (model) {
    modelUri = model[1];
    rest = rest.replace(MODEL_REF, ' ').replace(/\s+/g, ' ').trim();
  }

  const dims = parseDimensions(rest);
  const label = (
    dims ? rest.replace(dims.text, ' ').replace(/\s+/g, ' ') : rest
  ).trim();
  const { kind, size: fallback } = classifyKind(
    (label || rest).toLowerCase(),
  );
  if (!dims) {
    return { label: label || rest || trimmed, kind, size: fallback, copies, modelUri };
  }
  const size = sizeFromDimensions(kind, fallback, dims.valuesCm);
  const dimensionsCm: [number, number, number] = [
    size[0] * CM_PER_SCENE_UNIT,
    size[1] * CM_PER_SCENE_UNIT,
    size[2] * CM_PER_SCENE_UNIT,
  ];
  return {
    label: label || rest || trimmed,
    kind,
    size,
    copies,
    dimensionsCm,
    modelUri,
  };
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
        dimensionsCm: copy.dimensionsCm,
        modelUri: copy.modelUri,
        id: `${copy.stepIndex}:${copy.partIndex}:${copy.copyIndex}`,
        stepIndex: copy.stepIndex,
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

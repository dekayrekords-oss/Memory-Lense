import { normalizeName } from './triage';
import type {
  ChecklistItemProgress,
  MemoryEvent,
  Scenario,
  ScenarioAlert,
} from './types';

// Watch-for rules from the product spec:
// - "remember-object": passively track where an object was last seen
// - "exit-check": alert when the user leaves without a required object
//   ("don't let me forget my keys before leaving the house")
// - "requirement": generalized exit-check — the requirement may be an
//   object ("keys") or an action ("brushed teeth"); vision tags count
//   as evidence for actions, object sightings for things
// - "checklist": named item lists (gig kit, groceries); items check off
//   when seen, and leaving/checkout without an item alerts

const EXIT_TAGS = new Set(['exit', 'leaving-home', 'front-door', 'car-door']);
const CHECKOUT_TAGS = new Set(['checkout', 'check-out', 'paying', 'paid']);
const HELD_WORDS = ['hand', 'cart', 'basket', 'bag', 'holding', 'carrying'];

function isExitEvent(event: MemoryEvent): boolean {
  return event.tags.some((t) => EXIT_TAGS.has(t.toLowerCase()));
}

function isCheckoutEvent(event: MemoryEvent): boolean {
  return event.tags.some((t) => CHECKOUT_TAGS.has(t.toLowerCase()));
}

function seesObject(event: MemoryEvent, objectName: string): boolean {
  const needle = normalizeName(objectName);
  return event.objects.some((o) => normalizeName(o.name) === needle);
}

/** "brushed teeth" -> "brushed-teeth", for matching vision tags. */
export function tagKey(phrase: string): string {
  return phrase
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Whether an event evidences a requirement: an object sighting for things,
 * a matching scene tag for actions (e.g. tag "brushed-teeth").
 */
export function evidencesRequirement(
  event: MemoryEvent,
  requirement: string,
): boolean {
  if (seesObject(event, requirement)) return true;
  const key = tagKey(requirement);
  return event.tags.some((t) => tagKey(t) === key);
}

function isHeldSighting(event: MemoryEvent, item: string): boolean {
  const needle = normalizeName(item);
  const seen = event.objects.find((o) => normalizeName(o.name) === needle);
  if (!seen) return false;
  const place = (seen.place ?? '').toLowerCase();
  if (HELD_WORDS.some((w) => place.includes(w))) return true;
  return event.tags.some((t) => {
    const tag = t.toLowerCase();
    return HELD_WORDS.some((w) => tag.includes(w));
  });
}

/** Object/action names whose sightings should keep photos in triage. */
export function scenarioTrackedNames(scenarios: Scenario[]): string[] {
  const names: string[] = [];
  for (const s of scenarios) {
    if (s.kind === 'remember-object' || s.kind === 'exit-check') {
      names.push(s.object);
    } else if (s.kind === 'requirement') {
      names.push(s.requirement);
    } else {
      names.push(...s.items);
    }
  }
  return names;
}

/** Short display name for a scenario chip. */
export function scenarioDisplayName(scenario: Scenario): string {
  switch (scenario.kind) {
    case 'remember-object':
    case 'exit-check':
      return scenario.object;
    case 'requirement':
      return scenario.requirement;
    case 'checklist':
      return scenario.title;
  }
}

/** Per-item checklist progress: seen anywhere, and seen in hand/cart. */
export function checklistProgress(
  events: MemoryEvent[],
  scenario: Extract<Scenario, { kind: 'checklist' }>,
): ChecklistItemProgress[] {
  return scenario.items.map((item) => {
    let lastSeenTs: number | null = null;
    let held = false;
    for (const e of events) {
      if (!seesObject(e, item)) continue;
      if (lastSeenTs === null || e.ts > lastSeenTs) lastSeenTs = e.ts;
      if (isHeldSighting(e, item)) held = true;
    }
    return { item, seen: lastSeenTs !== null, held, lastSeenTs };
  });
}

/** Latest event (any order input) that saw the object, or null. */
export function findLastSeen(
  events: MemoryEvent[],
  objectName: string,
): MemoryEvent | null {
  let best: MemoryEvent | null = null;
  for (const e of events) {
    if (seesObject(e, objectName) && (!best || e.ts > best.ts)) best = e;
  }
  return best;
}

/** Natural-language answer for "where are my keys?" style questions. */
export function answerWhere(
  events: MemoryEvent[],
  objectName: string,
  formatTime: (ts: number) => string = (ts) =>
    new Date(ts).toLocaleTimeString(),
): string {
  const seen = findLastSeen(events, objectName);
  if (!seen) return `I haven't seen your ${objectName} yet.`;
  const place = seen.objects.find(
    (o) => normalizeName(o.name) === normalizeName(objectName),
  )?.place;
  const where = place ? ` on the ${place}` : '';
  return `I saw your ${objectName}${where} at ${formatTime(seen.ts)}.`;
}

function exitAlertsFor(
  events: MemoryEvent[],
  idPrefix: string,
  requirement: string,
  label: string,
  windowMinutes: number,
  now: number,
): ScenarioAlert[] {
  const alerts: ScenarioAlert[] = [];
  const windowMs = windowMinutes * 60_000;
  for (const exitEvent of events) {
    if (!isExitEvent(exitEvent)) continue;
    const covered = events.some(
      (e) =>
        evidencesRequirement(e, requirement) &&
        e.ts <= exitEvent.ts &&
        exitEvent.ts - e.ts <= windowMs,
    );
    if (!covered) {
      alerts.push({
        id: `${idPrefix}-${exitEvent.id}`,
        ts: now,
        message: `You left without your ${requirement}. (${label})`,
      });
    }
  }
  return alerts;
}

/**
 * Evaluates exit-check, requirement, and checklist scenarios against the
 * event history. An exit is covered when the requirement was evidenced
 * inside the scenario window before leaving. Each uncovered exit alerts
 * once per requirement/item (stable ids let the engine dedupe).
 */
export function evaluateScenarios(
  events: MemoryEvent[],
  scenarios: Scenario[],
  now: number,
): ScenarioAlert[] {
  const alerts: ScenarioAlert[] = [];
  for (const scenario of scenarios) {
    if (scenario.kind === 'exit-check') {
      alerts.push(
        ...exitAlertsFor(
          events,
          `exit-${scenario.id}`,
          scenario.object,
          scenario.label,
          scenario.windowMinutes,
          now,
        ),
      );
    } else if (scenario.kind === 'requirement') {
      alerts.push(
        ...exitAlertsFor(
          events,
          `req-${scenario.id}`,
          scenario.requirement,
          scenario.label,
          scenario.windowMinutes,
          now,
        ),
      );
    } else if (scenario.kind === 'checklist') {
      const progress = checklistProgress(events, scenario);
      for (const exitEvent of events) {
        if (!isExitEvent(exitEvent)) continue;
        for (const p of progress) {
          if (p.seen) continue;
          alerts.push({
            id: `checklist-${scenario.id}-${tagKey(p.item)}-${exitEvent.id}`,
            ts: now,
            message:
              `You're leaving without your ${p.item}. ` +
              `(${scenario.title})`,
          });
        }
      }
      for (const checkout of events) {
        if (!isCheckoutEvent(checkout)) continue;
        for (const p of progress) {
          if (p.seen) continue;
          alerts.push({
            id: `cart-${scenario.id}-${tagKey(p.item)}-${checkout.id}`,
            ts: now,
            message:
              `${p.item} never made it to the cart. ` +
              `(${scenario.title})`,
          });
        }
      }
    }
  }
  return alerts;
}

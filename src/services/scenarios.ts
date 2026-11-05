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

function wordsOf(name: string): string[] {
  return normalizeName(name)
    .split(' ')
    .map((w) => w.trim())
    .filter(Boolean);
}

/**
 * Forgiving name match for "where is my screw?" style questions: exact
 * normalized match, or every word of the shorter name appears in the
 * longer ("screw" matches "Screw A"; "blue mug" matches "mug, blue").
 */
export function nameMatches(query: string, candidate: string): boolean {
  const q = wordsOf(query);
  const c = wordsOf(candidate);
  if (q.length === 0 || c.length === 0) return false;
  if (q.join(' ') === c.join(' ')) return true;
  const [shorter, longer] = q.length <= c.length ? [q, c] : [c, q];
  if (shorter.join(' ').length < 3) return false;
  const longerSet = new Set(longer);
  return shorter.every((w) => longerSet.has(w));
}

function seesObject(event: MemoryEvent, objectName: string): boolean {
  return event.objects.some((o) => nameMatches(objectName, o.name));
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
export const CHECKLIST_WINDOW_MS = 12 * 60 * 60 * 1000;

export function checklistProgress(
  events: MemoryEvent[],
  scenario: Extract<Scenario, { kind: 'checklist' }>,
  windowStartTs: number = Number.NEGATIVE_INFINITY,
  windowEndTs: number = Number.POSITIVE_INFINITY,
): ChecklistItemProgress[] {
  return scenario.items.map((item) => {
    let lastSeenTs: number | null = null;
    let held = false;
    for (const e of events) {
      if (e.ts < windowStartTs || e.ts > windowEndTs) continue;
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
function smartWhen(ts: number, now: number): string {
  const time = new Date(ts).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
  const startOfDay = (d: Date) => {
    const copy = new Date(d);
    copy.setHours(0, 0, 0, 0);
    return copy.getTime();
  };
  const dayDiff = Math.round(
    (startOfDay(new Date(now)) - startOfDay(new Date(ts))) / 86_400_000,
  );
  if (dayDiff <= 0) return `today at ${time}`;
  if (dayDiff === 1) return `yesterday at ${time}`;
  return `on ${new Date(ts).toLocaleDateString()} at ${time}`;
}

export function answerWhere(
  events: MemoryEvent[],
  objectName: string,
  formatTime?: (ts: number) => string,
  now: number = Date.now(),
): string {
  const seen = findLastSeen(events, objectName);
  if (!seen) return `I haven't seen your ${objectName} yet.`;
  const place = seen.objects.find((o) => nameMatches(objectName, o.name))?.place;
  const where = place ? ` on the ${place}` : '';
  const when = formatTime
    ? `at ${formatTime(seen.ts)}`
    : smartWhen(seen.ts, now);
  return `I saw your ${objectName}${where} ${when}.`;
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
      for (const exitEvent of events) {
        if (!isExitEvent(exitEvent)) continue;
        // Only sightings shortly BEFORE leaving count as packed — an item
        // seen last week (or only after leaving) must still alert.
        const progress = checklistProgress(
          events,
          scenario,
          exitEvent.ts - CHECKLIST_WINDOW_MS,
          exitEvent.ts,
        );
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
        const progress = checklistProgress(
          events,
          scenario,
          checkout.ts - CHECKLIST_WINDOW_MS,
          checkout.ts,
        );
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

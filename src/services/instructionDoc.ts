import type { ProjectPlan, ProjectStep } from './types';

// QR codes on instruction sheets usually encode the official manual URL.
// Fetch it, turn the page into plain text, and build steps locally — no
// vision model needed. Pure helpers are unit-tested; fetch stays thin.

/** First http(s) URL in scanned text, or null. */
export function extractUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"')]+/i);
  if (!match) return null;
  return match[0].replace(/[.,;]+$/, '');
}

/** Crude HTML → text: drop scripts/styles/tags, decode common entities. */
export function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

const STEP_MARKER = /^(?:step\s*)?\d{1,3}\s*[.)\]:-]\s*(.+)$/i;
const BULLET_MARKER = /^[•\-*–]\s+(.+)$/;

function stepTitle(line: string): string {
  const clean = line.replace(/\s+/g, ' ').trim();
  if (clean.length <= 70) return clean;
  const cut = clean.slice(0, 70);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > 30 ? cut.slice(0, lastSpace) : cut}…`;
}

/**
 * Builds a plan from plain instruction text. Numbered/bulleted lines
 * become steps; without markers, non-trivial paragraphs become steps.
 * Returns null when nothing step-like is found.
 */
export function planFromInstructionText(
  text: string,
  fallbackTitle = 'Instructions',
): ProjectPlan | null {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  let title = fallbackTitle;
  const steps: ProjectStep[] = [];
  let titleConsumed = false;

  for (const line of lines) {
    const marked = line.match(STEP_MARKER) ?? line.match(BULLET_MARKER);
    if (marked) {
      const body = marked[1].trim();
      if (body.length < 3) continue;
      steps.push({
        title: stepTitle(body),
        parts: [],
        instruction: body,
      });
      continue;
    }
    if (!titleConsumed && steps.length === 0 && line.length >= 4) {
      title = stepTitle(line);
      titleConsumed = true;
    }
  }

  if (steps.length === 0) {
    // No markers: treat each substantial paragraph as a step.
    const paragraphs = lines.filter((l) => l.length >= 25);
    for (const paragraph of paragraphs.slice(0, 30)) {
      steps.push({
        title: stepTitle(paragraph),
        parts: [],
        instruction: paragraph,
      });
    }
    if (paragraphs.length > 0 && lines[0] !== paragraphs[0]) {
      title = stepTitle(lines[0]);
    }
  }

  if (steps.length === 0) return null;
  return { title, steps: steps.slice(0, 30) };
}

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /\.local$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^::1$/,
  /^0\.0\.0\.0$/,
];

/** True for localhost / LAN / link-local destinations a QR must never reach. */
export function isBlockedDocumentHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return true;
  }
  return PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

export const MAX_DOCUMENT_BYTES = 3_000_000;
export const DOCUMENT_TIMEOUT_MS = 10_000;

export type OfficialDocResult =
  | { kind: 'plan'; plan: ProjectPlan; host: string }
  | { kind: 'pdf'; url: string }
  | { kind: 'unreadable'; url: string };

/** Fetches the document a QR code points at and parses it into steps. */
export async function loadOfficialDocument(
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<OfficialDocResult> {
  if (isBlockedDocumentHost(url)) {
    throw new Error(
      'That link points inside your home network, so I will not fetch it. Official manuals live on the maker\'s public website.',
    );
  }
  const controller =
    typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), DOCUMENT_TIMEOUT_MS)
    : null;
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetchFn(
      url,
      controller ? { signal: controller.signal } : undefined,
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_DOCUMENT_BYTES) {
    return { kind: 'unreadable', url };
  }
  if (!response.ok) {
    throw new Error(`document fetch failed: HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('pdf') || url.toLowerCase().endsWith('.pdf')) {
    return { kind: 'pdf', url };
  }
  const text = stripHtmlToText(await response.text());
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    // Keep the raw URL as the label.
  }
  const plan = planFromInstructionText(text, `Instructions from ${host}`);
  if (!plan) return { kind: 'unreadable', url };
  return { kind: 'plan', plan, host };
}

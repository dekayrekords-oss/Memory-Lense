import type { VisionResult } from './types';

// Hard product rule: capture MUST stop when a restroom or nudity is seen.
// This gate runs before any triage or storage decision, and a blocked frame
// never keeps its photo.

const BLOCK_TAGS = new Set([
  'restroom',
  'bathroom',
  'toilet',
  'nudity',
  'nude',
  'naked',
  'intimate-body',
]);

const BLOCK_WORDS = ['restroom', 'bathroom', 'toilet', 'nude', 'naked', 'nudity'];

export interface PrivacyVerdict {
  blocked: boolean;
  reason: string | null;
}

export function evaluatePrivacy(result: VisionResult): PrivacyVerdict {
  for (const tag of result.tags) {
    if (BLOCK_TAGS.has(tag.toLowerCase())) {
      return { blocked: true, reason: `privacy tag: ${tag}` };
    }
  }
  const caption = result.caption.toLowerCase();
  for (const word of BLOCK_WORDS) {
    if (caption.includes(word)) {
      return { blocked: true, reason: `privacy word in caption: ${word}` };
    }
  }
  return { blocked: false, reason: null };
}

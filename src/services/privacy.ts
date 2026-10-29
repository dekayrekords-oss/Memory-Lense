import type { VisionResult } from './types';

// Hard product rule: capture MUST stop when the scene IS a restroom or
// shows nudity. This gate runs before any triage or storage decision,
// and a blocked frame never keeps its photo.
//
// What counts as the scene being private: the model's scene TAGS
// (the backend prompt requires restroom/nudity tags for such scenes),
// or a nudity word describing the scene in the caption.
//
// What does NOT stop capture: a restroom word merely mentioned in the
// caption ("a roll of toilet paper on the counter", "toiletry bag").
// Those frames marked `mention` are discarded — photo deleted, never
// stored — and capture continues. Substring matching ("toilet" inside
// "toiletry") hard-stopped ordinary rooms and bricked the camera.

const BLOCK_TAGS = new Set([
  'restroom',
  'bathroom',
  'toilet',
  'nudity',
  'nude',
  'naked',
  'intimate-body',
]);

const BLOCK_WORDS = ['nude', 'naked', 'nudity'];
const MENTION_WORDS = ['restroom', 'bathroom', 'toilet'];

export interface PrivacyVerdict {
  blocked: boolean;
  /** Why capture stopped, when blocked. Names the exact trigger. */
  reason: string | null;
  /** A private place merely mentioned in the caption: discard, continue. */
  mention: string | null;
}

function wordPattern(words: string[]): RegExp {
  return new RegExp(`\\b(${words.join('|')})\\b`, 'i');
}

const BLOCK_WORD_RE = wordPattern(BLOCK_WORDS);
const MENTION_WORD_RE = wordPattern(MENTION_WORDS);

export function evaluatePrivacy(result: VisionResult): PrivacyVerdict {
  for (const tag of result.tags) {
    if (BLOCK_TAGS.has(tag.toLowerCase())) {
      return {
        blocked: true,
        reason: `privacy tag: ${tag}`,
        mention: null,
      };
    }
  }
  const caption = result.caption;
  const blockWord = caption.match(BLOCK_WORD_RE);
  if (blockWord) {
    return {
      blocked: true,
      reason: `privacy word in caption: ${blockWord[1].toLowerCase()}`,
      mention: null,
    };
  }
  const mention = caption.match(MENTION_WORD_RE);
  if (mention) {
    return {
      blocked: false,
      reason: null,
      mention: `private place mentioned in caption: ${mention[1].toLowerCase()}`,
    };
  }
  return { blocked: false, reason: null, mention: null };
}

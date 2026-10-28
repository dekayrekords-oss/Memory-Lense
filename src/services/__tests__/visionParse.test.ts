import { describe, expect, it } from '@jest/globals';
import { parseVisionResult } from '../vision/visionParse';

const VALID = {
  caption: 'Keys on the dining table',
  objects: [{ name: 'keys', place: 'dining table', confidence: 0.96 }],
  tags: ['indoor', 'dining-room'],
  importance: 0.95,
};

describe('parseVisionResult', () => {
  it('accepts a clean result object', () => {
    const result = parseVisionResult(VALID);
    expect(result.caption).toBe('Keys on the dining table');
    expect(result.objects[0].name).toBe('keys');
    expect(result.importance).toBeCloseTo(0.95);
  });

  it('extracts JSON from a markdown-fenced string', () => {
    const text = '```json\n' + JSON.stringify(VALID) + '\n```';
    expect(parseVisionResult(text).caption).toBe(VALID.caption);
  });

  it('extracts JSON wrapped in prose', () => {
    const text = `Here is the scene: ${JSON.stringify(VALID)} Done.`;
    expect(parseVisionResult(text).objects).toHaveLength(1);
  });

  it('clamps scores into 0..1 and fills defaults', () => {
    const result = parseVisionResult({
      caption: 'Loud room',
      importance: 7,
      objects: [{ name: 'drums', confidence: -2 }],
    });
    expect(result.importance).toBe(1);
    expect(result.objects[0].confidence).toBe(0);
    expect(result.objects[0].place).toBeNull();
    expect(result.tags).toEqual([]);
  });

  it('fails closed on garbage text', () => {
    expect(() => parseVisionResult('no json here at all')).toThrow();
  });

  it('fails closed on non-object JSON', () => {
    expect(() => parseVisionResult('42')).toThrow();
    expect(() => parseVisionResult(null)).toThrow();
  });
});

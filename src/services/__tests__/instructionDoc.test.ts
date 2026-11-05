import { describe, expect, it, jest } from '@jest/globals';
import {
  extractUrl,
  isBlockedDocumentHost,
  loadOfficialDocument,
  planFromInstructionText,
  stripHtmlToText,
} from '../instructionDoc';

describe('extractUrl', () => {
  it('finds the document link inside QR text', () => {
    expect(extractUrl('https://www.ikea.com/manuals/billy.pdf')).toBe(
      'https://www.ikea.com/manuals/billy.pdf',
    );
    expect(extractUrl('See https://example.com/guide, for help')).toBe(
      'https://example.com/guide',
    );
    expect(extractUrl('WIFI:T:WPA;S:home;;')).toBeNull();
    expect(extractUrl('just some text')).toBeNull();
  });
});

describe('stripHtmlToText', () => {
  it('drops scripts/tags and decodes entities', () => {
    const text = stripHtmlToText(
      '<style>.a{}</style><h1>Build &amp; Go</h1><script>x()</script><p>Step one</p><p>Use &lt;care&gt;</p>',
    );
    expect(text).toContain('Build & Go');
    expect(text).toContain('Step one');
    expect(text).toContain('Use <care>');
    expect(text).not.toContain('x()');
    expect(text).not.toContain('<p>');
  });
});

describe('planFromInstructionText', () => {
  it('parses numbered steps under a title', () => {
    const plan = planFromInstructionText(
      [
        'BILLY bookcase assembly',
        '1. Lay the side panels on a soft surface',
        '2. Insert the wooden dowels into the top panel',
        '3. Tighten all cam locks with a screwdriver',
      ].join('\n'),
    );
    expect(plan?.title).toBe('BILLY bookcase assembly');
    expect(plan?.steps).toHaveLength(3);
    expect(plan?.steps[1].instruction).toContain('dowels');
  });

  it('falls back to paragraphs and returns null for junk', () => {
    const plan = planFromInstructionText(
      'Welcome to the guide\n\nFirst unpack every part and check the contents list carefully.\n\nThen attach the legs one by one using the supplied screws.',
    );
    expect(plan?.steps.length).toBeGreaterThanOrEqual(2);
    expect(planFromInstructionText('hi')).toBeNull();
    expect(planFromInstructionText('')).toBeNull();
  });
});

describe('loadOfficialDocument', () => {
  it('fetches a page and builds a plan from it', async () => {
    const fetchFn = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' },
      text: async () =>
        '<h1>Desk guide</h1><p>1. Unpack all parts from the box</p><p>2. Attach the four legs firmly</p>',
    })) as unknown as typeof fetch;
    const result = await loadOfficialDocument(
      'https://example.com/desk-guide',
      fetchFn,
    );
    expect(result.kind).toBe('plan');
    if (result.kind === 'plan') {
      expect(result.host).toBe('example.com');
      expect(result.plan.steps).toHaveLength(2);
    }
  });

  it('routes PDFs to the browser instead of parsing', async () => {
    const fetchFn = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/pdf' },
      text: async () => '%PDF-1.4',
    })) as unknown as typeof fetch;
    const result = await loadOfficialDocument(
      'https://example.com/manual.pdf',
      fetchFn,
    );
    expect(result.kind).toBe('pdf');
  });

  it('throws on HTTP failure', async () => {
    const fetchFn = jest.fn(async () => ({
      ok: false,
      status: 404,
      headers: { get: () => 'text/html' },
      text: async () => 'nope',
    })) as unknown as typeof fetch;
    await expect(
      loadOfficialDocument('https://example.com/gone', fetchFn),
    ).rejects.toThrow(/404/);
  });
});

describe('QR fetch hardening', () => {
  it('recognizes blocked hosts', () => {
    expect(isBlockedDocumentHost('http://192.168.1.1/admin')).toBe(true);
    expect(isBlockedDocumentHost('http://10.0.0.5/x')).toBe(true);
    expect(isBlockedDocumentHost('http://172.16.0.9/x')).toBe(true);
    expect(isBlockedDocumentHost('http://169.254.169.254/latest')).toBe(true);
    expect(isBlockedDocumentHost('http://localhost:8787/analyze')).toBe(true);
    expect(isBlockedDocumentHost('https://www.ikea.com/manual')).toBe(false);
    expect(isBlockedDocumentHost('not a url')).toBe(true);
  });

  it('refuses to fetch a blocked host at all', async () => {
    const fetchFn = jest.fn(async () => {
      throw new Error('must not be called');
    }) as unknown as typeof fetch;
    await expect(
      loadOfficialDocument('http://192.168.1.1/admin', fetchFn),
    ).rejects.toThrow(/home network/);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

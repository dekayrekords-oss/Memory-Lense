import { describe, expect, it } from '@jest/globals';
import {
  AI_PROVIDERS,
  buildCloudRequest,
  cloudConfigFromSettings,
  extractCloudText,
  freeVisionModels,
  providerById,
} from '../aiProviders';

describe('provider catalog', () => {
  it('includes every provider the user asked for', () => {
    const ids = AI_PROVIDERS.map((p) => p.id);
    for (const id of [
      'muse-custom',
      'openai',
      'anthropic',
      'gemini',
      'opencode',
      'openrouter',
      'groq',
      'mistral',
      'xai',
    ]) {
      expect(ids).toContain(id);
    }
  });

  it('lists free vision models from Gemini, OpenRouter, Groq, Mistral', () => {
    const free = freeVisionModels();
    const names = free.map((f) => f.model);
    expect(names).toContain('gemini-2.5-flash');
    expect(names).toContain('meta-llama/llama-4-scout-17b-16e-instruct');
    expect(names).toContain('pixtral-12b-2409');
    expect(names.some((n) => n.endsWith(':free'))).toBe(true);
    expect(free.length).toBeGreaterThanOrEqual(6);
  });

  it('every real provider links to its API-key page', () => {
    for (const provider of AI_PROVIDERS) {
      expect(provider.keyUrl).toMatch(/^https:\/\//);
      expect(provider.keyHelp.length).toBeGreaterThan(0);
    }
  });

  it('links Muse to the Meta Model API key dashboard', () => {
    const muse = AI_PROVIDERS.find((p) => p.id === 'muse-custom');
    expect(muse?.keyUrl).toBe('https://dev.meta.ai/api-keys');
  });

  it('offers the verified-live OpenRouter free vision roster', () => {
    // Verified against openrouter.ai/api/v1/models on 2026-11-04;
    // the retired slugs below answered HTTP 404 on device.
    const openrouter = AI_PROVIDERS.find((p) => p.id === 'openrouter');
    const ids = (openrouter?.models ?? []).map((m) => m.id);
    expect(ids).toContain('google/gemma-4-31b-it:free');
    expect(ids).not.toContain('google/gemma-3-27b-it:free');
    expect(ids).not.toContain('meta-llama/llama-3.2-11b-vision-instruct:free');
    expect(ids).not.toContain('qwen/qwen2.5-vl-7b-instruct:free');
  });

  it('every free model offered is vision-capable', () => {
    for (const provider of AI_PROVIDERS) {
      for (const model of provider.models) {
        if (model.free) expect(model.vision).toBe(true);
      }
    }
  });
});

describe('buildCloudRequest', () => {
  it('builds an OpenAI-compatible request with a data-URL image', () => {
    const req = buildCloudRequest(
      {
        providerId: 'openrouter',
        kind: 'openai-compatible',
        apiKey: 'sk-test',
        model: 'm1',
        baseUrl: 'https://openrouter.ai/api/v1/',
      },
      'PROMPT',
      'QUJD',
    );
    expect(req.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(req.headers.Authorization).toBe('Bearer sk-test');
    const body = req.body as {
      messages: { content: { type: string; image_url?: { url: string } }[] }[];
    };
    expect(body.messages[0].content[1].image_url?.url).toBe(
      'data:image/jpeg;base64,QUJD',
    );
  });

  it('builds Anthropic and Gemini requests in their native shapes', () => {
    const anthropic = buildCloudRequest(
      {
        providerId: 'anthropic',
        kind: 'anthropic',
        apiKey: 'k',
        model: 'claude-haiku-4-5',
        baseUrl: '',
      },
      'P',
      'QUJD',
    );
    expect(anthropic.url).toBe('https://api.anthropic.com/v1/messages');
    expect(anthropic.headers['x-api-key']).toBe('k');

    const gemini = buildCloudRequest(
      {
        providerId: 'gemini',
        kind: 'gemini',
        apiKey: 'g-key',
        model: 'gemini-2.5-flash',
        baseUrl: '',
      },
      'P',
      null,
    );
    expect(gemini.url).toContain('gemini-2.5-flash:generateContent');
    expect(gemini.url).not.toContain('key=');
    expect(gemini.headers['x-goog-api-key']).toBe('g-key');
    expect(gemini.headers.Authorization).toBeUndefined();
  });
});

describe('extractCloudText', () => {
  it('reads each provider response shape and fails closed', () => {
    expect(
      extractCloudText('openai-compatible', {
        choices: [{ message: { content: 'hi' } }],
      }),
    ).toBe('hi');
    expect(
      extractCloudText('anthropic', {
        content: [{ type: 'text', text: 'yo' }],
      }),
    ).toBe('yo');
    expect(
      extractCloudText('gemini', {
        candidates: [{ content: { parts: [{ text: 'hey' }] } }],
      }),
    ).toBe('hey');
    expect(() => extractCloudText('gemini', {})).toThrow();
    expect(() => extractCloudText('anthropic', { content: [] })).toThrow();
  });
});

describe('cloudConfigFromSettings', () => {
  const base = {
    visionSource: 'cloud',
    cloudProviderId: 'gemini',
    providerConfigs: {
      gemini: { apiKey: ' k ', model: ' gemini-2.5-flash ', baseUrl: '' },
    },
  };

  it('resolves a trimmed config with the provider default base URL', () => {
    const config = cloudConfigFromSettings(base);
    expect(config).toMatchObject({
      providerId: 'gemini',
      kind: 'gemini',
      apiKey: 'k',
      model: 'gemini-2.5-flash',
    });
  });

  it('rejects a public http:// endpoint (key would leak in cleartext)', () => {
    const config = cloudConfigFromSettings({
      visionSource: 'cloud',
      cloudProviderId: 'muse-custom',
      providerConfigs: {
        'muse-custom': {
          apiKey: 'k',
          model: 'm',
          baseUrl: 'http://api.example.com/v1',
        },
      },
    });
    expect(config).toBeNull();
    const lan = cloudConfigFromSettings({
      visionSource: 'cloud',
      cloudProviderId: 'muse-custom',
      providerConfigs: {
        'muse-custom': {
          apiKey: 'k',
          model: 'm',
          baseUrl: 'http://192.168.1.20:1234/v1',
        },
      },
    });
    expect(lan).not.toBeNull();
  });

  it('returns null without cloud source, key, or model', () => {
    expect(
      cloudConfigFromSettings({ ...base, visionSource: 'demo' }),
    ).toBeNull();
    expect(
      cloudConfigFromSettings({
        ...base,
        providerConfigs: { gemini: { apiKey: '', model: 'm', baseUrl: '' } },
      }),
    ).toBeNull();
    expect(
      cloudConfigFromSettings({
        ...base,
        cloudProviderId: 'muse-custom',
        providerConfigs: {
          'muse-custom': { apiKey: 'k', model: 'm', baseUrl: '' },
        },
      }),
    ).toBeNull();
    expect(providerById('nope')).toBeNull();
  });
});

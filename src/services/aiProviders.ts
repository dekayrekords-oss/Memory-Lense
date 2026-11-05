// AI provider catalog: bring-your-own-key cloud vision.
//
// The user picks a provider, pastes an API key, and picks (or types) a
// vision model. Keys are stored only in the on-device settings file and
// sent only to that provider. "Free" below means the provider offered a
// free tier / free model at catalog time — free rosters change, so the
// Settings screen says to confirm in the provider's console.

export type AiProviderKind = 'openai-compatible' | 'anthropic' | 'gemini';

export interface AiModelOption {
  id: string;
  free: boolean;
  vision: boolean;
  note: string;
}

export interface AiProviderDef {
  id: string;
  label: string;
  kind: AiProviderKind;
  /** Editable for openai-compatible; fixed for anthropic/gemini. */
  defaultBaseUrl: string;
  /** Where the user gets a key. */
  keyHelp: string;
  /** Direct link to the provider's API-key page (null for custom). */
  keyUrl: string | null;
  models: AiModelOption[];
  freeNote: string;
}

export const AI_PROVIDERS: AiProviderDef[] = [
  {
    id: 'muse-custom',
    label: 'Muse / Custom endpoint',
    kind: 'openai-compatible',
    defaultBaseUrl: '',
    keyHelp:
      'Key from dev.meta.ai → API keys (Meta Model API), or any OpenAI-compatible endpoint: paste its base URL (ending in /v1), key, and model name.',
    keyUrl: 'https://dev.meta.ai/api-keys',
    models: [],
    freeNote: 'Depends on the endpoint you point it at.',
  },
  {
    id: 'openai',
    label: 'ChatGPT (OpenAI)',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://api.openai.com/v1',
    keyHelp: 'Key from platform.openai.com → API keys.',
    keyUrl: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-4o-mini', free: false, vision: true, note: 'Cheapest vision model' },
      { id: 'gpt-4o', free: false, vision: true, note: 'Higher quality' },
    ],
    freeNote: 'No free API tier; usage is pay-as-you-go.',
  },
  {
    id: 'anthropic',
    label: 'Claude (Anthropic)',
    kind: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    keyHelp: 'Key from console.anthropic.com → API keys.',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    models: [
      { id: 'claude-haiku-4-5', free: false, vision: true, note: 'Fast + cheap' },
      { id: 'claude-sonnet-4-5', free: false, vision: true, note: 'Higher quality' },
    ],
    freeNote: 'No free API tier; usage is pay-as-you-go.',
  },
  {
    id: 'gemini',
    label: 'Gemini (Google AI Studio)',
    kind: 'gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    keyHelp: 'Free key from aistudio.google.com → Get API key.',
    keyUrl: 'https://aistudio.google.com/apikey',
    models: [
      { id: 'gemini-2.5-flash', free: true, vision: true, note: 'Free tier, fast' },
      { id: 'gemini-2.0-flash', free: true, vision: true, note: 'Free tier' },
      { id: 'gemini-2.5-pro', free: false, vision: true, note: 'Best quality' },
    ],
    freeNote: 'AI Studio keys include a free tier with daily limits.',
  },
  {
    id: 'opencode',
    label: 'OpenCode (Zen)',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://opencode.ai/zen/v1',
    keyHelp: 'Key from opencode.ai → Zen console.',
    keyUrl: 'https://opencode.ai/zen',
    models: [],
    freeNote:
      'Zen rotates free models — check the Zen console for the current free vision model name and type it below.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    keyHelp: 'Key from openrouter.ai → Keys. One key, many models.',
    keyUrl: 'https://openrouter.ai/settings/keys',
    // Free roster verified live against openrouter.ai/api/v1/models
    // on 2026-11-04 (the previous gemma-3/llama-3.2/qwen slugs now
    // 404). :free routes rotate — Settings says to confirm live.
    models: [
      {
        id: 'google/gemma-4-31b-it:free',
        free: true,
        vision: true,
        note: 'Free vision (roster rotates)',
      },
      {
        id: 'google/gemma-4-26b-a4b-it:free',
        free: true,
        vision: true,
        note: 'Free vision (roster rotates)',
      },
      {
        id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
        free: true,
        vision: true,
        note: 'Free vision (roster rotates)',
      },
      {
        id: 'openai/gpt-4o-mini',
        free: false,
        vision: true,
        note: 'Paid via OpenRouter',
      },
    ],
    freeNote:
      'Models ending in :free cost nothing (rate-limited). Confirm the live list at openrouter.ai/models.',
  },
  {
    id: 'groq',
    label: 'Groq',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    keyHelp: 'Free key from console.groq.com → API keys.',
    keyUrl: 'https://console.groq.com/keys',
    models: [
      {
        id: 'meta-llama/llama-4-scout-17b-16e-instruct',
        free: true,
        vision: true,
        note: 'Free tier, very fast',
      },
    ],
    freeNote: 'Generous free tier for the Llama vision model.',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    keyHelp: 'Key from console.mistral.ai → API keys.',
    keyUrl: 'https://console.mistral.ai/api-keys/',
    models: [
      {
        id: 'pixtral-12b-2409',
        free: true,
        vision: true,
        note: 'Free-tier vision model',
      },
    ],
    freeNote: 'La Plateforme has a free experimentation tier.',
  },
  {
    id: 'xai',
    label: 'Grok (xAI)',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://api.x.ai/v1',
    keyHelp: 'Key from console.x.ai → API keys.',
    keyUrl: 'https://console.x.ai/',
    models: [
      { id: 'grok-2-vision-1212', free: false, vision: true, note: 'Vision' },
    ],
    freeNote: 'No standing free API tier.',
  },
];

export function providerById(id: string): AiProviderDef | null {
  return AI_PROVIDERS.find((p) => p.id === id) ?? null;
}

/** Every free vision model in the catalog, grouped for the in-app list. */
export function freeVisionModels(): { provider: string; model: string }[] {
  const out: { provider: string; model: string }[] = [];
  for (const provider of AI_PROVIDERS) {
    for (const model of provider.models) {
      if (model.free && model.vision) {
        out.push({ provider: provider.label, model: model.id });
      }
    }
  }
  return out;
}

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[0-1])\.)/i;

export function isPrivateOrLocalHost(url: string): boolean {
  try {
    return PRIVATE_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export interface ProviderConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

export interface CloudConfig extends ProviderConfig {
  providerId: string;
  kind: AiProviderKind;
}

export const VISION_PROMPT = `You are the eyes of a memory-assistant app. Describe one photo as JSON only — no prose, no markdown fences.

Schema:
{
  "caption": "short human-readable description",
  "objects": [{ "name": "keys", "place": "dining table or null", "confidence": 0.0-1.0 }],
  "tags": ["indoor", "kitchen"],
  "importance": 0.0-1.0
}

Rules:
- "objects": everyday items a person might look for later (keys, wallet, phone, glasses, tools, instruments). "place" is where the object rests, or null.
- "tags": scene labels. You MUST include "restroom" or "bathroom" for restrooms, "nudity" if a person is nude or intimate body parts are visible, "exit" plus "front-door" or "car-door" when someone is leaving a building or opening a car door.
- "importance": how worth remembering this moment is (unusual, emotional, or task-relevant = high; blank walls and repeats = low).`;

export const PARSE_INSTRUCTIONS_PROMPT = `You parse a photographed instruction sheet into LEGO/IKEA-style steps. Reply with JSON only — no prose, no markdown fences.

Schema:
{
  "title": "what is being built or fixed",
  "steps": [
    { "title": "short step title", "parts": ["part or tool needed"], "instruction": "one clear action to do in this step" }
  ]
}

Rules:
- Keep the steps in the order shown on the sheet. One step per numbered or pictured stage.
- Read all printed text on the sheet, including small labels. If the sheet is blurry, cut off, too dark, or unreadable, do NOT guess: return {"title": "", "steps": []} so the app can ask for a better photo.`;

export function stepCheckPrompt(stepTitle: string, instruction: string): string {
  return `You check a photographed build step. The step is "${stepTitle}": ${instruction}
Reply with JSON only — no prose, no markdown fences:
{ "verdict": "complete" | "mistake" | "unclear", "detail": "what you see, and if a mistake, exactly what to fix", "confidence": 0.0-1.0 }
Use "unclear" when the photo does not show the step well enough to judge.`;
}

export function askStepPrompt(
  question: string,
  stepTitle: string,
  instruction: string,
): string {
  return `A CHILD is doing a build step "${stepTitle}": ${instruction}
They ask: ${question}
Rules: keep the answer short, simple, and safe. Never give instructions that require sharp tools, electricity, heat, or chemicals — instead say to ask an adult. If you are not sure, say you are not sure and to ask an adult.
Reply with JSON only: { "answer": "short, concrete answer" }`;
}

export interface BuiltRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Builds the provider-native chat request. Pure — unit-tested. */
export function buildCloudRequest(
  config: CloudConfig,
  prompt: string,
  imageBase64: string | null,
): BuiltRequest {
  const base = (config.baseUrl || '').replace(/\/+$/, '');
  if (config.kind === 'anthropic') {
    return {
      url: `${base || 'https://api.anthropic.com'}/v1/messages`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: {
        model: config.model,
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              ...(imageBase64
                ? [
                    {
                      type: 'image',
                      source: {
                        type: 'base64',
                        media_type: 'image/jpeg',
                        data: imageBase64,
                      },
                    },
                  ]
                : []),
              { type: 'text', text: prompt },
            ],
          },
        ],
      },
    };
  }
  if (config.kind === 'gemini') {
    const root = base || 'https://generativelanguage.googleapis.com';
    return {
      url: `${root}/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.apiKey,
      },
      body: {
        contents: [
          {
            parts: [
              ...(imageBase64
                ? [
                    {
                      inline_data: {
                        mime_type: 'image/jpeg',
                        data: imageBase64,
                      },
                    },
                  ]
                : []),
              { text: prompt },
            ],
          },
        ],
      },
    };
  }
  // OpenAI-compatible (OpenAI, OpenRouter, Groq, Mistral, xAI, OpenCode, custom).
  return {
    url: `${base}/chat/completions`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: {
      model: config.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            ...(imageBase64
              ? [
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:image/jpeg;base64,${imageBase64}`,
                    },
                  },
                ]
              : []),
          ],
        },
      ],
    },
  };
}

/** Extracts the assistant text from a provider response. Throws if absent. */
export function extractCloudText(kind: AiProviderKind, raw: unknown): string {
  const record =
    typeof raw === 'object' && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  if (kind === 'anthropic') {
    const content = record.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (
          typeof block === 'object' &&
          block !== null &&
          (block as Record<string, unknown>).type === 'text' &&
          typeof (block as Record<string, unknown>).text === 'string'
        ) {
          return (block as Record<string, unknown>).text as string;
        }
      }
    }
  } else if (kind === 'gemini') {
    const candidates = record.candidates;
    if (Array.isArray(candidates) && candidates.length > 0) {
      const content = (candidates[0] as Record<string, unknown>).content;
      const parts =
        typeof content === 'object' && content !== null
          ? (content as Record<string, unknown>).parts
          : null;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (
            typeof part === 'object' &&
            part !== null &&
            typeof (part as Record<string, unknown>).text === 'string'
          ) {
            return (part as Record<string, unknown>).text as string;
          }
        }
      }
    }
  } else {
    const choices = record.choices;
    if (Array.isArray(choices) && choices.length > 0) {
      const message = (choices[0] as Record<string, unknown>).message;
      if (
        typeof message === 'object' &&
        message !== null &&
        typeof (message as Record<string, unknown>).content === 'string'
      ) {
        return (message as Record<string, unknown>).content as string;
      }
    }
  }
  throw new Error('AI provider response had no text content');
}

/**
 * Resolves the effective cloud config from settings. Returns null when
 * the user has not selected the cloud source or the key/model is missing.
 */
export function cloudConfigFromSettings(settings: {
  visionSource: string;
  cloudProviderId: string;
  providerConfigs: Record<string, ProviderConfig>;
}): CloudConfig | null {
  if (settings.visionSource !== 'cloud') return null;
  const def = providerById(settings.cloudProviderId);
  if (!def) return null;
  const stored = settings.providerConfigs[def.id];
  const apiKey = (stored?.apiKey ?? '').trim();
  const model = (stored?.model ?? '').trim();
  if (!apiKey || !model) return null;
  const baseUrl = (stored?.baseUrl ?? '').trim() || def.defaultBaseUrl;
  if (def.kind === 'openai-compatible' && !baseUrl) return null;
  if (baseUrl.startsWith('http://') && !isPrivateOrLocalHost(baseUrl)) {
    // A public http:// endpoint would send the key and every photo in
    // cleartext. Private/LAN http (a home server) stays allowed.
    return null;
  }
  return { providerId: def.id, kind: def.kind, apiKey, model, baseUrl };
}

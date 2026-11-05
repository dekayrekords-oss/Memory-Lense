import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// In-memory stand-ins for the on-device settings file and the OS keystore,
// so persistence can be exercised end to end without a device. Both maps
// live outside any one settings module instance: a "restart" below is a
// fresh settings module (jest.resetModules) reading the same fakes.
const mockFiles = new Map<string, string>();
const mockKeys = new Map<string, string>();

jest.mock('expo-file-system', () => ({
  Paths: { document: 'docs' },
  File: class FakeFile {
    private readonly name: string;
    constructor(_parent: unknown, name: string) {
      this.name = name;
    }
    get exists(): boolean {
      return mockFiles.has(this.name);
    }
    async text(): Promise<string> {
      return mockFiles.get(this.name) ?? '';
    }
    create(): void {
      if (!this.exists) mockFiles.set(this.name, '');
    }
    async write(content: string): Promise<void> {
      mockFiles.set(this.name, content);
    }
  },
}));

jest.mock('../secureKeys', () => ({
  readProviderKey: async (providerId: string) =>
    mockKeys.get(`memory-lens.apikey.${providerId}`) ?? null,
  writeProviderKey: async (providerId: string, apiKey: string) => {
    const key = `memory-lens.apikey.${providerId}`;
    if (apiKey) mockKeys.set(key, apiKey);
    else mockKeys.delete(key);
  },
}));

const SETTINGS_FILE = 'memory-lens-settings.json';
const NEMOTRON = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free';

function freshSettingsModule(): typeof import('../settings') {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../settings') as typeof import('../settings');
}

beforeEach(() => {
  mockFiles.clear();
  mockKeys.clear();
});

describe('settings persistence', () => {
  it('gives racing first loads the saved settings, not defaults', async () => {
    // On disk: the cloud config exactly as saveSettings writes it (the
    // API key itself lives in the keystore, faked separately).
    mockFiles.set(
      SETTINGS_FILE,
      JSON.stringify({
        visionSource: 'cloud',
        cloudProviderId: 'openrouter',
        providerConfigs: {
          openrouter: {
            apiKey: '',
            model: NEMOTRON,
            baseUrl: 'https://openrouter.ai/api/v1',
          },
        },
      }),
    );
    mockKeys.set('memory-lens.apikey.openrouter', 'sk-or-test');

    const settings = await freshSettingsModule();
    const notified: { visionSource: string }[] = [];
    settings.subscribeSettings((loaded) => notified.push(loaded));

    // On app open the Memory screen's load fires right behind the daily
    // model update check's load. The second caller must not settle for
    // defaults while the first load is still reading the file, and
    // subscribers must learn the loaded settings when the load lands.
    const [first, second] = await Promise.all([
      settings.loadSettings(),
      settings.loadSettings(),
    ]);
    for (const loaded of [first, second]) {
      expect(loaded.visionSource).toBe('cloud');
      expect(loaded.cloudProviderId).toBe('openrouter');
      expect(loaded.providerConfigs.openrouter?.apiKey).toBe('sk-or-test');
      expect(loaded.providerConfigs.openrouter?.model).toBe(NEMOTRON);
    }
    expect(settings.getSettings().visionSource).toBe('cloud');
    expect(notified.length).toBeGreaterThan(0);
    expect(notified[notified.length - 1]?.visionSource).toBe('cloud');
  });

  it('keeps the saved cloud provider across an app restart', async () => {
    const first = await freshSettingsModule();
    await first.saveSettings({
      visionSource: 'cloud',
      cloudProviderId: 'openrouter',
      providerConfigs: {
        openrouter: {
          apiKey: 'sk-or-test',
          model: NEMOTRON,
          baseUrl: 'https://openrouter.ai/api/v1',
        },
      },
    });

    const restarted = await freshSettingsModule();
    const loaded = await restarted.loadSettings();
    expect(loaded.visionSource).toBe('cloud');
    expect(loaded.cloudProviderId).toBe('openrouter');
    expect(loaded.providerConfigs.openrouter).toEqual({
      apiKey: 'sk-or-test',
      model: NEMOTRON,
      baseUrl: 'https://openrouter.ai/api/v1',
    });
  });
});

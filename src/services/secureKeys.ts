// API keys live in the OS keystore (expo-secure-store), never in the
// plain settings JSON. Lazy require: the native module is absent in
// Expo Go / jest, where every call degrades to a no-op instead of a crash.

interface SecureStoreLike {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

let cached: SecureStoreLike | null | undefined;

function store(): SecureStoreLike | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-secure-store') as SecureStoreLike;
  } catch {
    cached = null;
  }
  return cached;
}

const keyFor = (providerId: string) => `memory-lens.apikey.${providerId}`;

export async function readProviderKey(
  providerId: string,
): Promise<string | null> {
  const secure = store();
  if (!secure) return null;
  try {
    return await secure.getItemAsync(keyFor(providerId));
  } catch {
    return null;
  }
}

/** Writes (or, when empty, deletes) a provider key. Best-effort. */
export async function writeProviderKey(
  providerId: string,
  apiKey: string,
): Promise<void> {
  const secure = store();
  if (!secure) return;
  try {
    if (apiKey) await secure.setItemAsync(keyFor(providerId), apiKey);
    else await secure.deleteItemAsync(keyFor(providerId));
  } catch {
    // Keystore unavailable: the in-memory settings still apply this run.
  }
}

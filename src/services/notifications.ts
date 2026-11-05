import {
  AndroidImportance,
  getPermissionsAsync,
  requestPermissionsAsync,
  scheduleNotificationAsync,
  setNotificationChannelAsync,
  setNotificationHandler,
} from 'expo-notifications';
import { Platform } from 'react-native';
import type { ScenarioAlert } from './types';

// Local notifications for scenario alerts (leave-without-X, missing checklist
// items). Foreground capture cannot run in the background on either OS, so
// these fire while the app is open or backgrounded — not as a replacement
// for capture, but so a fired alert is never silently missed. Local-only:
// no push tokens, no server, no APNs entitlement (see app.json plugin
// config). Every entry point fails soft — a notification problem must never
// break capture or crash the app.

export interface NotificationClient {
  /** Install the foreground-presentation handler (idempotent per client). */
  setHandler: () => void;
  /** Create the Android channel (no-op on iOS). */
  ensureChannel: () => Promise<void>;
  getStatus: () => Promise<'granted' | 'denied' | 'undetermined'>;
  requestStatus: () => Promise<'granted' | 'denied' | 'undetermined'>;
  /** Schedule an immediate local notification. Resolves to its id. */
  schedule: (title: string, body: string) => Promise<string>;
}

const installedHandlers = new WeakSet<object>();

const defaultClient: NotificationClient = {
  setHandler: () => {
    setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  },
  ensureChannel: async () => {
    // Android 13+ only shows the permission prompt after a channel exists.
    if (Platform.OS === 'android') {
      await setNotificationChannelAsync('alerts', {
        name: 'Memory alerts',
        importance: AndroidImportance.HIGH,
      });
    }
  },
  getStatus: async () => {
    const { status } = await getPermissionsAsync();
    return status === 'granted' ? 'granted' : status;
  },
  requestStatus: async () => {
    const { status } = await requestPermissionsAsync();
    return status === 'granted' ? 'granted' : status;
  },
  schedule: async (title, body) =>
    scheduleNotificationAsync({
      content: { title, body },
      trigger: null,
    }),
};

export function buildAlertNotification(alert: ScenarioAlert): {
  title: string;
  body: string;
} {
  return { title: 'Memory Lens', body: alert.message };
}

/**
 * Presents a scenario alert as a local notification. Returns true when the
 * notification was scheduled, false when permission is missing or anything
 * failed. Never throws.
 */
export async function notifyAlert(
  alert: ScenarioAlert,
  client: NotificationClient = defaultClient,
): Promise<boolean> {
  try {
    if (!installedHandlers.has(client)) {
      client.setHandler();
      installedHandlers.add(client);
    }
    await client.ensureChannel();
    let status = await client.getStatus();
    if (status !== 'granted') {
      status = await client.requestStatus();
    }
    if (status !== 'granted') return false;
    const { title, body } = buildAlertNotification(alert);
    await client.schedule(title, body);
    return true;
  } catch {
    return false;
  }
}

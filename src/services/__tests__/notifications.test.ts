import { describe, expect, it, jest } from '@jest/globals';
import {
  buildAlertNotification,
  notifyAlert,
  type NotificationClient,
} from '../notifications';
import type { ScenarioAlert } from '../types';

const ALERT: ScenarioAlert = {
  id: 'exit-exit-keys-7',
  ts: 1_700_000_000_000,
  message: 'You left without your keys. (exit-keys)',
};

function mockClient(
  overrides: Partial<NotificationClient> = {},
): NotificationClient & {
  setHandler: ReturnType<typeof jest.fn>;
  schedule: ReturnType<typeof jest.fn>;
} {
  return {
    setHandler: jest.fn(),
    ensureChannel: jest.fn(async () => {}),
    getStatus: jest.fn(async () => 'granted' as const),
    requestStatus: jest.fn(async () => 'granted' as const),
    schedule: jest.fn(async () => 'notif-id'),
    ...overrides,
  } as NotificationClient & {
    setHandler: ReturnType<typeof jest.fn>;
    schedule: ReturnType<typeof jest.fn>;
  };
}

describe('buildAlertNotification', () => {
  it('uses the alert message as the body', () => {
    expect(buildAlertNotification(ALERT)).toEqual({
      title: 'Memory Lens',
      body: 'You left without your keys. (exit-keys)',
    });
  });
});

describe('notifyAlert', () => {
  it('schedules an immediate notification when already granted', async () => {
    const client = mockClient();
    await expect(notifyAlert(ALERT, client)).resolves.toBe(true);
    expect(client.setHandler).toHaveBeenCalledTimes(1);
    expect(client.schedule).toHaveBeenCalledTimes(1);
    expect(client.schedule).toHaveBeenCalledWith(
      'Memory Lens',
      'You left without your keys. (exit-keys)',
    );
  });

  it('installs the handler only once per client', async () => {
    const client = mockClient();
    await notifyAlert(ALERT, client);
    await notifyAlert(ALERT, client);
    expect(client.setHandler).toHaveBeenCalledTimes(1);
    expect(client.schedule).toHaveBeenCalledTimes(2);
  });

  it('requests permission when undetermined, then schedules', async () => {
    const requestStatus = jest.fn(async () => 'granted' as const);
    const client = mockClient({
      getStatus: jest.fn(async () => 'undetermined' as const),
      requestStatus,
    });
    await expect(notifyAlert(ALERT, client)).resolves.toBe(true);
    expect(requestStatus).toHaveBeenCalledTimes(1);
    expect(client.schedule).toHaveBeenCalledTimes(1);
  });

  it('returns false without scheduling when permission is denied', async () => {
    const client = mockClient({
      getStatus: jest.fn(async () => 'denied' as const),
      requestStatus: jest.fn(async () => 'denied' as const),
    });
    await expect(notifyAlert(ALERT, client)).resolves.toBe(false);
    expect(client.schedule).not.toHaveBeenCalled();
  });

  it('returns false instead of throwing when scheduling fails', async () => {
    const client = mockClient({
      schedule: jest.fn(async () => {
        throw new Error('notification service unavailable');
      }),
    });
    await expect(notifyAlert(ALERT, client)).resolves.toBe(false);
  });

  it('returns false instead of throwing when permission check fails', async () => {
    const client = mockClient({
      getStatus: jest.fn(async () => {
        throw new Error('no notification module');
      }),
    });
    await expect(notifyAlert(ALERT, client)).resolves.toBe(false);
  });
});

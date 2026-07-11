import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { ensureSeedData } from '../data/seed';
import { changeCurrentPin, getStoredSession, loginPin } from './auth';

async function resetDb() {
  await db.delete();
  await db.open();
  await ensureSeedData();
}

describe('auth session policy', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('restores personal sessions', async () => {
    const session = await loginPin('Papa', '1234', { deviceMode: 'personal' });
    const stored = await getStoredSession();

    expect(stored?.userId).toBe(session.userId);
    expect(stored?.deviceMode).toBe('personal');
    expect(new Date(stored?.expiresAt ?? 0).getTime()).toBeGreaterThan(Date.now() + 80 * 24 * 60 * 60 * 1000);
  });

  it('does not restore shared sessions', async () => {
    await loginPin('Papa', '1234', { deviceMode: 'shared' });

    await expect(getStoredSession()).resolves.toBeNull();
    await expect(db.appSessions.get('current')).resolves.toBeUndefined();
  });

  it('lets a local user change their PIN with the current PIN', async () => {
    const session = await loginPin('Papa', '1234', { deviceMode: 'personal' });

    await changeCurrentPin(session, '1234', '9876');
    await expect(loginPin('Papa', '1234', { deviceMode: 'personal' })).rejects.toThrow(/no coinciden/i);

    const updatedSession = await loginPin('Papa', '9876', { deviceMode: 'personal' });
    expect(updatedSession.userId).toBe(session.userId);
  });

  it('rejects PIN changes with an incorrect current PIN', async () => {
    const session = await loginPin('Papa', '1234', { deviceMode: 'personal' });

    await expect(changeCurrentPin(session, '0000', '9876')).rejects.toThrow(/actual no coincide/i);
  });
});

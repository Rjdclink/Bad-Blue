import assert from 'node:assert/strict';
import { coordinationPool } from '../server/db';
import {
  acquireSpectraResourcePermit,
  SpectraResourceBusyError,
} from '../server/services/spectra/SpectraResourceGovernor';

const originalConnect = coordinationPool.connect;
const originalEnv = {
  global: process.env.SPECTRA_MAX_CONCURRENT_ACQUISITIONS,
  tenant: process.env.SPECTRA_MAX_CONCURRENT_ACQUISITIONS_PER_TENANT,
  timeout: process.env.SPECTRA_RESOURCE_ACQUIRE_TIMEOUT_MS,
  fallback: process.env.SPECTRA_ALLOW_LOCAL_GOVERNOR_FALLBACK,
};

async function main() {
  process.env.SPECTRA_MAX_CONCURRENT_ACQUISITIONS = '2';
  process.env.SPECTRA_MAX_CONCURRENT_ACQUISITIONS_PER_TENANT = '1';
  process.env.SPECTRA_RESOURCE_ACQUIRE_TIMEOUT_MS = '100';
  process.env.SPECTRA_ALLOW_LOCAL_GOVERNOR_FALLBACK = 'false';

  const locks = new Map<string, number>();
  let nextClient = 0;
  let releasedClients = 0;
  const mockClient = () => {
    const id = ++nextClient;
    return {
      query: async (sql: string, params: number[]) => {
        const key = params.join(':');
        if (sql.includes('pg_try_advisory_lock')) {
          const acquired = !locks.has(key) || locks.get(key) === id;
          if (acquired) locks.set(key, id);
          return { rows: [{ acquired }] };
        }
        if (sql.includes('pg_advisory_unlock')) {
          const unlocked = locks.get(key) === id;
          if (unlocked) locks.delete(key);
          return { rows: [{ unlocked }] };
        }
        throw new Error('Unexpected governor query');
      },
      release: (error?: Error) => {
        releasedClients += 1;
        if (error) {
          for (const [key, owner] of locks) if (owner === id) locks.delete(key);
        }
      },
    };
  };

  try {
    (coordinationPool as any).connect = async () => mockClient();
    const first = await acquireSpectraResourcePermit('tenant-one');
    const second = await acquireSpectraResourcePermit('tenant-two');
    assert.equal(first.backend, 'postgres-advisory-lock');
    assert.equal(second.backend, 'postgres-advisory-lock');
    await assert.rejects(
      () => acquireSpectraResourcePermit('tenant-three'),
      SpectraResourceBusyError,
    );
    await first.release();
    await first.release();
    await second.release();
    assert.equal(locks.size, 0, 'all advisory locks must be released');

    let lateReleased = false;
    (coordinationPool as any).connect = () => new Promise(resolve => {
      setTimeout(() => {
        const late = mockClient();
        resolve({ ...late, release: () => { lateReleased = true; } });
      }, 150);
    });
    await assert.rejects(
      () => acquireSpectraResourcePermit('tenant-four'),
      SpectraResourceBusyError,
    );
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(lateReleased, true, 'late pool connections must be released');
    assert.ok(releasedClients >= 3);
  } finally {
    (coordinationPool as any).connect = originalConnect;
    for (const [key, value] of Object.entries({
      SPECTRA_MAX_CONCURRENT_ACQUISITIONS: originalEnv.global,
      SPECTRA_MAX_CONCURRENT_ACQUISITIONS_PER_TENANT: originalEnv.tenant,
      SPECTRA_RESOURCE_ACQUIRE_TIMEOUT_MS: originalEnv.timeout,
      SPECTRA_ALLOW_LOCAL_GOVERNOR_FALLBACK: originalEnv.fallback,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

main().then(
  () => { console.log('SPECTRA resource governor verification passed.'); process.exit(0); },
  error => { console.error(error); process.exit(1); },
);

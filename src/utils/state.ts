import { pool, ensureMigrated } from './db';

export async function readLastSyncAt(): Promise<string> {
  await ensureMigrated();
  const { rows } = await pool.query('SELECT last_sync_at FROM sync_state WHERE id = 1');
  if (rows.length === 0) {
    return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  }
  const val = rows[0]['last_sync_at'];
  return val instanceof Date ? val.toISOString() : String(val);
}

export async function writeLastSyncAt(isoDate: string): Promise<void> {
  await ensureMigrated();
  await pool.query(
    `INSERT INTO sync_state (id, last_sync_at) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET last_sync_at = $1`,
    [isoDate]
  );
}

export function toDateString(isoDate: string): string {
  return isoDate.split('T')[0];
}

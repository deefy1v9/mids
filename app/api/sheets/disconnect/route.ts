export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { pool, ensureMigrated } from '@/src/utils/db';

export async function POST() {
  try {
    await ensureMigrated();
    await pool.query('DELETE FROM google_tokens WHERE id = 1');
    await pool.query(`DELETE FROM api_cache WHERE key = 'google_sheets_data'`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { syncWonLeads } from '@/src/sync/syncWonLeads';

export async function POST() {
  try {
    const result = await syncWonLeads();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

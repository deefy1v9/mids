export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { syncWonLeads } from '@/src/sync/syncWonLeads';

export async function POST(_req: NextRequest) {
  try {
    const result = await syncWonLeads();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

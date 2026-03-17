export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { syncWonLeads } from '@/src/sync/syncWonLeads';

export async function POST(req: NextRequest) {
  try {
    const pageParam = req.nextUrl.searchParams.get('fromPage');
    const fromPage = pageParam ? parseInt(pageParam) : undefined;
    const result = await syncWonLeads(fromPage);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { syncDailyPage, calcDailyPage } from '@/src/sync/syncDailyPage';

export async function POST(req: NextRequest) {
  try {
    const pageParam = req.nextUrl.searchParams.get('fromPage');
    const page = pageParam ? parseInt(pageParam) : calcDailyPage();
    const result = await syncDailyPage(page);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

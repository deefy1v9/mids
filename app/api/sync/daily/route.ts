export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { syncDailyPage } from '@/src/sync/syncDailyPage';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const pageParam = req.nextUrl.searchParams.get('page');
    const page = pageParam ? parseInt(pageParam) : undefined;
    const result = await syncDailyPage(page);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const pageParam = req.nextUrl.searchParams.get('page');
    const page = pageParam ? parseInt(pageParam) : undefined;
    const result = await syncDailyPage(page);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

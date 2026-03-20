export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { syncDailyPage } from '@/src/sync/syncDailyPage';

// Vercel Cron Jobs chamam GET com o header Authorization: Bearer <CRON_SECRET>
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await syncDailyPage();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST manual (painel ou teste)
export async function POST(_req: NextRequest) {
  try {
    const result = await syncDailyPage();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

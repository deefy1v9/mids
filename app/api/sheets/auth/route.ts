export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getAuthUrl } from '@/src/google/sheets';
import { ensureMigrated } from '@/src/utils/db';

export async function GET() {
  await ensureMigrated();
  return NextResponse.redirect(getAuthUrl());
}

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getOAuth2Client, saveTokens } from '@/src/google/sheets';
import { ensureMigrated } from '@/src/utils/db';

export async function GET(req: NextRequest) {
  try {
    await ensureMigrated();
    const code = req.nextUrl.searchParams.get('code') ?? '';
    if (!code) return NextResponse.json({ error: 'missing code' }, { status: 400 });
    const { tokens } = await getOAuth2Client().getToken(code);
    await saveTokens(tokens);
    return NextResponse.redirect(new URL('/', req.url));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

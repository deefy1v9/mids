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
    // Usar o domínio do GOOGLE_REDIRECT_URI para evitar redirecionar para 0.0.0.0 (interno Docker)
    const base = process.env.GOOGLE_REDIRECT_URI
      ? new URL(process.env.GOOGLE_REDIRECT_URI).origin
      : new URL(req.url).origin;
    return NextResponse.redirect(`${base}/`);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

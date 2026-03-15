import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { password } = await req.json() as { password: string };

  if (password !== process.env.APP_SECRET) {
    return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set('auth', process.env.APP_SECRET!, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 dias
    path: '/',
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete('auth');
  return res;
}

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { deleteMatch } from '@/src/utils/matches';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const deleted = await deleteMatch(params.id);
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { listMatches } from '@/src/utils/matches';

export async function GET() {
  try {
    const matches = await listMatches(200);
    return NextResponse.json(matches);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

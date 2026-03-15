export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { KommoClient } from '@/src/kommo/client';

export async function GET() {
  try {
    const kommo = new KommoClient();
    const pipelines = await kommo.getPipelines();
    return NextResponse.json(pipelines);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[/api/pipelines] Erro:', message);
    return NextResponse.json([]);
  }
}

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { readConfig, writeConfig, SyncConfig } from '@/src/utils/config';

export async function GET() {
  try {
    const config = await readConfig();
    return NextResponse.json(config);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<SyncConfig>;
    const current = await readConfig();
    const updated: SyncConfig = {
      markAsWon: body.markAsWon ?? current.markAsWon,
      pipelineId: body.pipelineId,
      stageId: body.stageId,
    };
    await writeConfig(updated);
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

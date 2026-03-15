import { NextRequest, NextResponse } from 'next/server';
import { KommoClient } from '@/src/kommo/client';
import { readConfig } from '@/src/utils/config';
import { getMatch, updateMatch } from '@/src/utils/matches';

export async function POST(req: NextRequest) {
  const { matchId, phone } = await req.json() as { matchId: string; phone?: string };

  const match = await getMatch(matchId);
  if (!match) {
    return NextResponse.json({ error: 'Match não encontrado' }, { status: 404 });
  }

  const kommo = new KommoClient();
  const config = await readConfig();

  try {
    // Caso 1: já temos o kommoLeadId → reenviar direto
    if (match.kommoLeadId) {
      if (config.markAsWon) {
        await kommo.markLeadAsWon(match.kommoLeadId, match.valor);
      } else if (config.pipelineId && config.stageId) {
        await kommo.moveLeadToStage(match.kommoLeadId, config.pipelineId, config.stageId, match.valor);
      }

      const updated = await updateMatch(matchId, {
        action: config.markAsWon ? 'won' : 'stage_moved',
        errorMessage: undefined,
        pipelineId: config.pipelineId,
        stageId: config.stageId,
      });
      return NextResponse.json({ ok: true, match: updated });
    }

    // Caso 2: sem kommoLeadId → precisa de telefone para buscar contato
    const query = phone ?? match.phone;
    if (!query) {
      return NextResponse.json({ error: 'Informe um telefone para buscar o contato' }, { status: 400 });
    }

    const phoneClean = query.replace(/\D/g, '');
    const contacts = await kommo.findContactByQuery(phoneClean.length >= 8 ? phoneClean : query);

    if (contacts.length === 0) {
      await updateMatch(matchId, { phone: query, action: 'not_found', errorMessage: 'Contato não encontrado no Kommo' });
      return NextResponse.json({ error: 'Contato não encontrado no Kommo' }, { status: 404 });
    }

    await updateMatch(matchId, { phone: query });

    for (const contact of contacts) {
      const openLeads = kommo.getOpenLeads(contact);
      for (const lead of openLeads) {
        if (config.markAsWon) {
          await kommo.markLeadAsWon(lead.id, match.valor);
        } else if (config.pipelineId && config.stageId) {
          await kommo.moveLeadToStage(lead.id, config.pipelineId, config.stageId, match.valor);
        }

        const updated = await updateMatch(matchId, {
          phone: query,
          kommoContactId: contact.id,
          kommoContactName: contact.name,
          kommoLeadId: lead.id,
          kommoLeadName: lead.name,
          action: config.markAsWon ? 'won' : 'stage_moved',
          errorMessage: undefined,
          pipelineId: config.pipelineId,
          stageId: config.stageId,
        });

        return NextResponse.json({ ok: true, match: updated });
      }
    }

    const updated = await updateMatch(matchId, {
      phone: query,
      kommoContactId: contacts[0].id,
      kommoContactName: contacts[0].name,
      action: 'not_found',
      errorMessage: 'Contato encontrado mas sem leads em aberto',
    });
    return NextResponse.json({ ok: false, error: 'Sem leads em aberto', match: updated });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateMatch(matchId, { action: 'error', errorMessage: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

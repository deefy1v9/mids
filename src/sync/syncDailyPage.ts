import 'dotenv/config';
import { TenFrontClient, extractClienteInfo, Cliente } from '../tenfront/client';
import { KommoClient } from '../kommo/client';
import { writeLastSyncAt } from '../utils/state';
import { readConfig } from '../utils/config';
import { saveMatch, matchExistsForLead } from '../utils/matches';
import { logger } from '../utils/logger';
import { SyncResult } from './syncWonLeads';

// Dia 0 (16/03/2026) = página 195. Cada dia +1 página.
const BASE_DATE = new Date('2026-03-16T00:00:00');
const BASE_PAGE = 195;

export function calcDailyPage(): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayOffset = Math.floor((today.getTime() - BASE_DATE.getTime()) / 86400000);
  return BASE_PAGE + Math.max(0, dayOffset);
}

export async function syncDailyPage(page?: number): Promise<SyncResult & { page: number }> {
  const result: SyncResult & { page: number } = {
    total: 0, matched: 0, updated: 0, notFound: 0, errors: 0, page: 0,
  };

  const targetPage = page ?? calcDailyPage();
  result.page = targetPage;

  const tenfront = new TenFrontClient();
  const kommo = new KommoClient();
  const config = await readConfig();
  const syncStartedAt = new Date().toISOString();

  logger.info(`=== Sync diário — página ${targetPage} ===`);
  logger.info(
    config.markAsWon
      ? 'Ação: marcar como GANHO'
      : `Ação: mover para pipeline ${config.pipelineId} / etapa ${config.stageId}`
  );

  let clientes: Cliente[] = [];
  let usedPage = targetPage;
  try {
    clientes = await tenfront.fetchClientePage(targetPage);
    logger.info(`Página ${targetPage}: ${clientes.length} clientes encontrados`);
    // Se a página calculada estiver vazia e não foi especificada manualmente, tenta page-1
    if (clientes.length === 0 && page === undefined && targetPage > 1) {
      const fallbackPage = targetPage - 1;
      logger.info(`Página ${targetPage} vazia — tentando página anterior ${fallbackPage}`);
      clientes = await tenfront.fetchClientePage(fallbackPage);
      usedPage = fallbackPage;
      logger.info(`Página ${fallbackPage}: ${clientes.length} clientes encontrados`);
    }
  } catch (err) {
    logger.error('Falha ao buscar página do TenFront:', err);
    return result;
  }

  result.page = usedPage;
  result.total = clientes.length;

  if (clientes.length === 0) {
    logger.info('Página vazia — nenhum cliente novo hoje.');
    await writeLastSyncAt(syncStartedAt);
    return result;
  }

  for (const cliente of clientes) {
    const info = extractClienteInfo(cliente);
    if (!info?.clienteName) continue;

    const { clienteName, celular, email, registrationDate } = info;

    if (!celular && !email) {
      result.notFound++;
      continue;
    }

    const queries: string[] = [];
    if (celular) {
      const phoneClean = celular.replace(/\D/g, '');
      if (phoneClean.length >= 8) queries.push(phoneClean);
    }
    if (email) queries.push(email);

    let foundContact = false;

    for (const query of [...new Set(queries)]) {
      try {
        const contacts = await kommo.findContactByQuery(query);
        if (contacts.length === 0) continue;

        foundContact = true;
        result.matched++;

        for (const contact of contacts) {
          const openLeads = kommo.getOpenLeads(contact);
          if (openLeads.length === 0) continue;

          for (const lead of openLeads) {
            try {
              if (await matchExistsForLead(lead.id)) {
                logger.info(`Lead #${lead.id} já sincronizado — ignorando.`);
                continue;
              }

              if (config.markAsWon) {
                await kommo.markLeadAsWon(lead.id);
                await saveMatch({
                  contaId: clienteName, clienteName, phone: celular, email,
                  kommoContactId: contact.id, kommoContactName: contact.name,
                  kommoLeadId: lead.id, kommoLeadName: lead.name,
                  action: 'won',
                }, registrationDate);
                logger.success(`Lead #${lead.id} "${lead.name}" → GANHO  (${clienteName})`);
              } else if (config.pipelineId && config.stageId) {
                await kommo.moveLeadToStage(lead.id, config.pipelineId, config.stageId);
                await saveMatch({
                  contaId: clienteName, clienteName, phone: celular, email,
                  kommoContactId: contact.id, kommoContactName: contact.name,
                  kommoLeadId: lead.id, kommoLeadName: lead.name,
                  action: 'stage_moved', pipelineId: config.pipelineId, stageId: config.stageId,
                }, registrationDate);
                logger.success(`Lead #${lead.id} "${lead.name}" → etapa ${config.stageId}  (${clienteName})`);
              } else {
                logger.warn('Configuração incompleta: markAsWon=false mas pipelineId/stageId não definidos.');
                continue;
              }
              result.updated++;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              await saveMatch({
                contaId: clienteName, clienteName, phone: celular, email,
                kommoContactId: contact.id, kommoContactName: contact.name,
                kommoLeadId: lead.id, kommoLeadName: lead.name,
                action: 'error', errorMessage: msg,
              });
              logger.error(`Falha ao atualizar lead #${lead.id}:`, err);
              result.errors++;
            }
          }
        }
        break;
      } catch (err) {
        logger.error(`Erro ao buscar no Kommo (query: "${query}"):`, err);
      }
    }

    if (!foundContact) {
      await saveMatch({ contaId: clienteName, clienteName, phone: celular, email, action: 'not_found' });
      result.notFound++;
    }
  }

  await writeLastSyncAt(syncStartedAt);

  logger.info('=== Sync diário concluído ===');
  logger.info(
    `Página: ${targetPage} | Total: ${result.total} | Encontrados: ${result.matched} | Atualizados: ${result.updated} | Não encontrados: ${result.notFound} | Erros: ${result.errors}`
  );

  return result;
}

if (require.main === module) {
  syncDailyPage().catch((err) => {
    logger.error('Erro fatal:', err);
    process.exit(1);
  });
}

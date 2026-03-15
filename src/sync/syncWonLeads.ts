import 'dotenv/config';
import { TenFrontClient, extractClienteInfo } from '../tenfront/client';
import { KommoClient } from '../kommo/client';
import { writeLastSyncAt } from '../utils/state';
import { readConfig } from '../utils/config';
import { saveMatch } from '../utils/matches';
import { logger } from '../utils/logger';

export interface SyncResult {
  total: number;
  matched: number;
  updated: number;
  notFound: number;
  errors: number;
}

export async function syncWonLeads(): Promise<SyncResult> {
  const result: SyncResult = { total: 0, matched: 0, updated: 0, notFound: 0, errors: 0 };

  const tenfront = new TenFrontClient();
  const kommo = new KommoClient();
  const config = await readConfig();
  const syncStartedAt = new Date().toISOString();

  logger.info('=== Iniciando sincronização (listar-clientes → Kommo por telefone) ===');
  logger.info(
    config.markAsWon
      ? 'Ação: marcar como GANHO'
      : `Ação: mover para pipeline ${config.pipelineId} / etapa ${config.stageId}`
  );

  let clientes: Awaited<ReturnType<typeof tenfront.listClientes>> = [];
  try {
    clientes = await tenfront.listClientes();
  } catch (err) {
    logger.error('Falha ao buscar clientes do TenFront:', err);
    return result;
  }

  result.total = clientes.length;
  logger.info(`${clientes.length} clientes carregados do TenFront.`);

  if (clientes.length === 0) {
    await writeLastSyncAt(syncStartedAt);
    return result;
  }

  for (const cliente of clientes) {
    const info = extractClienteInfo(cliente);
    if (!info?.clienteName) continue;

    const { clienteName, celular, email } = info;

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
              if (config.markAsWon) {
                await kommo.markLeadAsWon(lead.id);
                await saveMatch({
                  contaId: clienteName, clienteName, phone: celular, email,
                  kommoContactId: contact.id, kommoContactName: contact.name,
                  kommoLeadId: lead.id, kommoLeadName: lead.name,
                  action: 'won',
                });
                logger.success(`Lead #${lead.id} "${lead.name}" → GANHO  (${clienteName})`);
              } else if (config.pipelineId && config.stageId) {
                await kommo.moveLeadToStage(lead.id, config.pipelineId, config.stageId);
                await saveMatch({
                  contaId: clienteName, clienteName, phone: celular, email,
                  kommoContactId: contact.id, kommoContactName: contact.name,
                  kommoLeadId: lead.id, kommoLeadName: lead.name,
                  action: 'stage_moved', pipelineId: config.pipelineId, stageId: config.stageId,
                });
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

  logger.info('=== Sincronização concluída ===');
  logger.info(
    `Total: ${result.total} | Encontrados: ${result.matched} | Atualizados: ${result.updated} | Não encontrados: ${result.notFound} | Erros: ${result.errors}`
  );

  return result;
}

if (require.main === module) {
  syncWonLeads().catch((err) => {
    logger.error('Erro fatal:', err);
    process.exit(1);
  });
}

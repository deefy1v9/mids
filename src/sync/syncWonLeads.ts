import 'dotenv/config';
import { TenFrontClient, extractClienteName, normalizeName, ContaAReceber } from '../tenfront/client';
import { KommoClient } from '../kommo/client';
import { writeLastSyncAt } from '../utils/state';
import { readConfig } from '../utils/config';
import { saveMatch, matchExistsForLead } from '../utils/matches';
import { logger } from '../utils/logger';

export interface SyncResult {
  total: number;
  matched: number;
  updated: number;
  notFound: number;
  errors: number;
}

const fmtBR = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

const parseBRDate = (s: string): string | undefined => {
  const m = s?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
};

export async function syncWonLeads(): Promise<SyncResult> {
  const result: SyncResult = { total: 0, matched: 0, updated: 0, notFound: 0, errors: 0 };

  const tenfront = new TenFrontClient();
  const kommo = new KommoClient();
  const config = await readConfig();
  const syncStartedAt = new Date().toISOString();

  logger.info('=== Iniciando sincronização (contas a receber + clientes → Kommo) ===');
  logger.info(
    config.markAsWon
      ? 'Ação: marcar como GANHO'
      : `Ação: mover para pipeline ${config.pipelineId} / etapa ${config.stageId}`
  );

  // 1. Busca contas a receber (últimos 30 dias) e filtra compensadas
  const today = new Date();
  const month30Ago = new Date(today.getTime() - 30 * 86400000);
  let contasAReceber: ContaAReceber[] = [];
  try {
    const all = await tenfront.listContasAReceber(fmtBR(month30Ago), fmtBR(today));
    contasAReceber = all.filter(
      c => !c['Status'] || c['Status'].toLowerCase() === 'compensado'
    );
    logger.info(`${contasAReceber.length} contas compensadas encontradas`);
  } catch (err) {
    logger.error('Falha ao buscar contas a receber:', err);
    return result;
  }

  if (contasAReceber.length === 0) {
    await writeLastSyncAt(syncStartedAt);
    return result;
  }

  // 2. Busca mapa de clientes: nome normalizado → { celular, email }
  let clientesMap: Awaited<ReturnType<typeof tenfront.buildClientesMap>>;
  try {
    clientesMap = await tenfront.buildClientesMap();
    logger.info(`Mapa de clientes: ${clientesMap.size} entradas`);
  } catch (err) {
    logger.error('Falha ao buscar clientes:', err);
    return result;
  }

  result.total = contasAReceber.length;

  // 3. Para cada conta, resolve telefone via clientes e sincroniza no Kommo
  for (const conta of contasAReceber) {
    const clienteName = extractClienteName(conta);
    if (!clienteName) continue;

    const clienteInfo = clientesMap.get(normalizeName(clienteName));
    const celular = clienteInfo?.celular;
    const email = clienteInfo?.email;
    const valor = Number(conta['Valor informado'] ?? conta['Valor'] ?? 0) || undefined;
    const rawDate = conta['Data compensação'] ?? conta['Data recebimento'] ?? '';
    const saleDate = parseBRDate(rawDate);

    if (!celular && !email) {
      await saveMatch({ contaId: clienteName, clienteName, valor, action: 'not_found' });
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
                  contaId: clienteName, clienteName, phone: celular, email, valor,
                  kommoContactId: contact.id, kommoContactName: contact.name,
                  kommoLeadId: lead.id, kommoLeadName: lead.name,
                  action: 'won',
                }, saleDate);
                logger.success(`Lead #${lead.id} "${lead.name}" → GANHO (${clienteName}, R$${valor ?? 0})`);
              } else if (config.pipelineId && config.stageId) {
                await kommo.moveLeadToStage(lead.id, config.pipelineId, config.stageId);
                await saveMatch({
                  contaId: clienteName, clienteName, phone: celular, email, valor,
                  kommoContactId: contact.id, kommoContactName: contact.name,
                  kommoLeadId: lead.id, kommoLeadName: lead.name,
                  action: 'stage_moved', pipelineId: config.pipelineId, stageId: config.stageId,
                }, saleDate);
                logger.success(`Lead #${lead.id} "${lead.name}" → etapa ${config.stageId} (${clienteName})`);
              } else {
                logger.warn('Configuração incompleta: markAsWon=false mas pipelineId/stageId não definidos.');
                continue;
              }
              result.updated++;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              await saveMatch({
                contaId: clienteName, clienteName, phone: celular, email, valor,
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
      await saveMatch({ contaId: clienteName, clienteName, phone: celular, email, valor, action: 'not_found' });
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

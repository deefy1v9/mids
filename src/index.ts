import 'dotenv/config';
import cron from 'node-cron';
import { syncWonLeads } from './sync/syncWonLeads';
import { logger } from './utils/logger';

// Padrão: todo dia às 08:00 — apenas 1 chamada/dia ao TenFront (limite de 40/dia)
const CRON_SCHEDULE = process.env.CRON_SCHEDULE ?? '0 8 * * *';

if (!cron.validate(CRON_SCHEDULE)) {
  logger.error(`CRON_SCHEDULE inválido: "${CRON_SCHEDULE}". Exemplo válido: "*/30 * * * *"`);
  process.exit(1);
}

logger.info(`TenFront → Kommo Sync iniciado.`);
logger.info(`Agendamento: ${CRON_SCHEDULE}`);
logger.info(`Executando sincronização inicial...`);

// Executa imediatamente ao iniciar
syncWonLeads().catch((err) => {
  logger.error('Erro na sincronização inicial:', err);
});

// Agenda execuções recorrentes
cron.schedule(CRON_SCHEDULE, async () => {
  logger.info('Cron disparado. Iniciando sincronização...');
  try {
    await syncWonLeads();
  } catch (err) {
    logger.error('Erro na sincronização agendada:', err);
  }
});

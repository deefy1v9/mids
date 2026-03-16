import 'dotenv/config';
import cron from 'node-cron';
import { syncDailyPage, calcDailyPage } from './sync/syncDailyPage';
import { logger } from './utils/logger';

logger.info('=== Cron iniciado ===');
logger.info(`Fuso: America/Sao_Paulo`);

async function runDailySync() {
  const page = calcDailyPage();
  logger.info(`[CRON] Iniciando sync diário — página ${page}`);
  try {
    const result = await syncDailyPage(page);
    logger.info(`[CRON] Concluído: ${JSON.stringify(result)}`);
  } catch (err) {
    logger.error('[CRON] Erro no sync diário:', err);
  }
}

// 08:00 BRT
cron.schedule('0 8 * * *', runDailySync, { timezone: 'America/Sao_Paulo' });

// 21:30 BRT
cron.schedule('30 21 * * *', runDailySync, { timezone: 'America/Sao_Paulo' });

logger.info('Agendamentos ativos:');
logger.info('  - 08:00 BRT  → sync diário');
logger.info('  - 21:30 BRT  → sync diário');
logger.info(`  - Hoje: página ${calcDailyPage()}`);

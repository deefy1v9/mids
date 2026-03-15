import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

let migrated = false;

export async function ensureMigrated(): Promise<void> {
  if (migrated) return;
  await migrate();
  migrated = true;
}

async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    // Criar tabelas
    await client.query(`
      CREATE TABLE IF NOT EXISTS matches (
        id                 TEXT PRIMARY KEY,
        date               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        conta_id           TEXT NOT NULL,
        cliente_name       TEXT NOT NULL,
        phone              TEXT,
        email              TEXT,
        valor              NUMERIC,
        kommo_contact_id   BIGINT,
        kommo_contact_name TEXT,
        kommo_lead_id      BIGINT,
        kommo_lead_name    TEXT,
        action             TEXT NOT NULL,
        pipeline_id        BIGINT,
        stage_id           BIGINT,
        error_message      TEXT
      );

      CREATE TABLE IF NOT EXISTS sync_state (
        id           INT PRIMARY KEY DEFAULT 1,
        last_sync_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_config (
        id           INT PRIMARY KEY DEFAULT 1,
        mark_as_won  BOOLEAN NOT NULL DEFAULT TRUE,
        pipeline_id  BIGINT,
        stage_id     BIGINT,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Importar matches.json se tabela vazia
    const { rows: matchCount } = await client.query('SELECT COUNT(*) FROM matches');
    if (Number(matchCount[0].count) === 0) {
      const matchesFile = path.resolve(process.cwd(), 'matches.json');
      if (fs.existsSync(matchesFile)) {
        const records = JSON.parse(fs.readFileSync(matchesFile, 'utf-8')) as Array<Record<string, unknown>>;
        for (const r of records) {
          await client.query(
            `INSERT INTO matches (id, date, conta_id, cliente_name, phone, email, valor,
              kommo_contact_id, kommo_contact_name, kommo_lead_id, kommo_lead_name,
              action, pipeline_id, stage_id, error_message)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
             ON CONFLICT (id) DO NOTHING`,
            [
              r['id'], r['date'] ?? new Date().toISOString(), r['contaId'] ?? r['id'],
              r['clienteName'], r['phone'] ?? null, r['email'] ?? null,
              r['valor'] ?? null, r['kommoContactId'] ?? null, r['kommoContactName'] ?? null,
              r['kommoLeadId'] ?? null, r['kommoLeadName'] ?? null,
              r['action'], r['pipelineId'] ?? null, r['stageId'] ?? null,
              r['errorMessage'] ?? null,
            ]
          );
        }
      }
    }

    // Importar state.json se tabela vazia
    const { rows: stateCount } = await client.query('SELECT COUNT(*) FROM sync_state');
    if (Number(stateCount[0].count) === 0) {
      const stateFile = path.resolve(process.cwd(), 'state.json');
      if (fs.existsSync(stateFile)) {
        const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as { lastSyncAt?: string };
        if (state.lastSyncAt) {
          await client.query(
            'INSERT INTO sync_state (id, last_sync_at) VALUES (1, $1) ON CONFLICT DO NOTHING',
            [state.lastSyncAt]
          );
        }
      }
    }

    // Importar sync-config.json se tabela vazia
    const { rows: configCount } = await client.query('SELECT COUNT(*) FROM sync_config');
    if (Number(configCount[0].count) === 0) {
      const configFile = path.resolve(process.cwd(), 'sync-config.json');
      if (fs.existsSync(configFile)) {
        const cfg = JSON.parse(fs.readFileSync(configFile, 'utf-8')) as {
          markAsWon?: boolean; pipelineId?: number; stageId?: number;
        };
        await client.query(
          `INSERT INTO sync_config (id, mark_as_won, pipeline_id, stage_id, updated_at)
           VALUES (1, $1, $2, $3, NOW()) ON CONFLICT DO NOTHING`,
          [cfg.markAsWon ?? true, cfg.pipelineId ?? null, cfg.stageId ?? null]
        );
      }
    }
  } finally {
    client.release();
  }
}

import { pool, ensureMigrated } from './db';

export interface SyncConfig {
  markAsWon: boolean;
  pipelineId?: number;
  stageId?: number;
  updatedAt?: string;
}

const DEFAULT_CONFIG: SyncConfig = { markAsWon: true };

export async function readConfig(): Promise<SyncConfig> {
  await ensureMigrated();
  const { rows } = await pool.query('SELECT * FROM sync_config WHERE id = 1');
  if (rows.length === 0) return { ...DEFAULT_CONFIG };
  const row = rows[0];
  return {
    markAsWon: row['mark_as_won'],
    pipelineId: row['pipeline_id'] ?? undefined,
    stageId: row['stage_id'] ?? undefined,
    updatedAt: row['updated_at'] instanceof Date ? row['updated_at'].toISOString() : row['updated_at'],
  };
}

export async function writeConfig(config: SyncConfig): Promise<void> {
  await ensureMigrated();
  await pool.query(
    `INSERT INTO sync_config (id, mark_as_won, pipeline_id, stage_id, updated_at)
     VALUES (1, $1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET
       mark_as_won = $1, pipeline_id = $2, stage_id = $3, updated_at = NOW()`,
    [config.markAsWon, config.pipelineId ?? null, config.stageId ?? null]
  );
}

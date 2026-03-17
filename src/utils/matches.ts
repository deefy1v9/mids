import { pool, ensureMigrated } from './db';

export type MatchAction = 'won' | 'stage_moved' | 'not_found' | 'error';

export interface MatchRecord {
  id: string;
  date: string;
  contaId: string | number;
  clienteName: string;
  phone?: string;
  email?: string;
  valor?: number;
  kommoContactId?: number;
  kommoContactName?: string;
  kommoLeadId?: number;
  kommoLeadName?: string;
  action: MatchAction;
  pipelineId?: number;
  stageId?: number;
  errorMessage?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToRecord(row: Record<string, any>): MatchRecord {
  return {
    id: row['id'],
    date: row['date'] instanceof Date ? row['date'].toISOString() : row['date'],
    contaId: row['conta_id'],
    clienteName: row['cliente_name'],
    phone: row['phone'] ?? undefined,
    email: row['email'] ?? undefined,
    valor: row['valor'] != null ? Number(row['valor']) : undefined,
    kommoContactId: row['kommo_contact_id'] ?? undefined,
    kommoContactName: row['kommo_contact_name'] ?? undefined,
    kommoLeadId: row['kommo_lead_id'] ?? undefined,
    kommoLeadName: row['kommo_lead_name'] ?? undefined,
    action: row['action'] as MatchAction,
    pipelineId: row['pipeline_id'] ?? undefined,
    stageId: row['stage_id'] ?? undefined,
    errorMessage: row['error_message'] ?? undefined,
  };
}

export async function saveMatch(
  record: Omit<MatchRecord, 'id' | 'date'>,
  saleDate?: string  // ISO date "YYYY-MM-DD" — uses NOW() if omitted
): Promise<MatchRecord> {
  await ensureMigrated();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const dateExpr = saleDate ? `$15::date` : 'NOW()';
  const values: unknown[] = [
    id, String(record.contaId), record.clienteName,
    record.phone ?? null, record.email ?? null, record.valor ?? null,
    record.kommoContactId ?? null, record.kommoContactName ?? null,
    record.kommoLeadId ?? null, record.kommoLeadName ?? null,
    record.action, record.pipelineId ?? null, record.stageId ?? null,
    record.errorMessage ?? null,
  ];
  if (saleDate) values.push(saleDate);

  const { rows } = await pool.query(
    `INSERT INTO matches (id, date, conta_id, cliente_name, phone, email, valor,
       kommo_contact_id, kommo_contact_name, kommo_lead_id, kommo_lead_name,
       action, pipeline_id, stage_id, error_message)
     VALUES ($1, ${dateExpr}, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    values
  );
  return rowToRecord(rows[0]);
}

export async function deleteMatch(id: string): Promise<boolean> {
  await ensureMigrated();
  const { rowCount } = await pool.query('DELETE FROM matches WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

// Returns true if a successful match for this kommoLeadId already exists (prevents duplicates)
export async function matchExistsForLead(kommoLeadId: number): Promise<boolean> {
  await ensureMigrated();
  const { rows } = await pool.query(
    `SELECT 1 FROM matches WHERE kommo_lead_id = $1 AND action IN ('won','stage_moved') LIMIT 1`,
    [kommoLeadId]
  );
  return rows.length > 0;
}

export async function listMatches(limit = 200): Promise<MatchRecord[]> {
  await ensureMigrated();
  const { rows } = await pool.query(
    'SELECT * FROM matches ORDER BY date DESC LIMIT $1',
    [limit]
  );
  return rows.map(rowToRecord);
}

export async function getMatch(id: string): Promise<MatchRecord | null> {
  await ensureMigrated();
  const { rows } = await pool.query('SELECT * FROM matches WHERE id = $1', [id]);
  return rows.length > 0 ? rowToRecord(rows[0]) : null;
}

export async function updateMatch(id: string, patch: Partial<MatchRecord>): Promise<MatchRecord | null> {
  await ensureMigrated();
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  const map: Record<string, string> = {
    phone: 'phone', email: 'email', valor: 'valor', action: 'action',
    kommoContactId: 'kommo_contact_id', kommoContactName: 'kommo_contact_name',
    kommoLeadId: 'kommo_lead_id', kommoLeadName: 'kommo_lead_name',
    pipelineId: 'pipeline_id', stageId: 'stage_id', errorMessage: 'error_message',
  };

  for (const [key, col] of Object.entries(map)) {
    if (key in patch) {
      fields.push(`${col} = $${i++}`);
      values.push((patch as Record<string, unknown>)[key] ?? null);
    }
  }

  if (fields.length === 0) return getMatch(id);

  values.push(id);
  const { rows } = await pool.query(
    `UPDATE matches SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  return rows.length > 0 ? rowToRecord(rows[0]) : null;
}

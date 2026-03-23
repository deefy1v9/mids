import { google } from 'googleapis';
import { pool } from '@/src/utils/db';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];

export function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getAuthUrl(): string {
  return getOAuth2Client().generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
}

export async function getAuthedClient() {
  const { rows } = await pool.query('SELECT * FROM google_tokens WHERE id = 1');
  if (!rows[0]) return null;
  const auth = getOAuth2Client();
  auth.setCredentials({
    access_token:  rows[0].access_token,
    refresh_token: rows[0].refresh_token,
    expiry_date:   rows[0].expiry_date ? Number(rows[0].expiry_date) : undefined,
  });
  auth.on('tokens', async (tokens) => {
    await pool.query(
      `UPDATE google_tokens SET access_token=$1, expiry_date=$2, updated_at=NOW() WHERE id=1`,
      [tokens.access_token, tokens.expiry_date ?? null]
    );
  });
  return auth;
}

export async function saveTokens(tokens: {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
}) {
  await pool.query(
    `INSERT INTO google_tokens (id, access_token, refresh_token, expiry_date, updated_at)
     VALUES (1, $1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE
       SET access_token  = $1,
           refresh_token = COALESCE($2, google_tokens.refresh_token),
           expiry_date   = $3,
           updated_at    = NOW()`,
    [tokens.access_token ?? null, tokens.refresh_token ?? null, tokens.expiry_date ?? null]
  );
}

export async function isConnected(): Promise<boolean> {
  const { rows } = await pool.query('SELECT id FROM google_tokens WHERE id = 1 LIMIT 1');
  return rows.length > 0;
}

export interface SheetRow {
  date: string;
  seller: string;
  value: number;
  product: string;
}

export async function readSheetData(): Promise<SheetRow[]> {
  const auth = await getAuthedClient();
  if (!auth) throw new Error('not_connected');

  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'A:Z' });
  const rows = res.data.values ?? [];
  if (rows.length < 2) return [];

  const headers = (rows[0] as string[]).map(h => String(h).toLowerCase().trim());
  const col = (keys: string[]) =>
    keys.map(k => headers.findIndex(h => h.includes(k))).find(i => i >= 0) ?? -1;

  const dateIdx    = col(['data', 'date']);
  const sellerIdx  = col(['vendedor', 'seller', 'atendente', 'consultor']);
  const valueIdx   = col(['valor', 'value', 'venda', 'faturamento', 'receita']);
  const productIdx = col(['produto', 'product', 'serviço', 'servico', 'plano']);

  return (rows.slice(1) as string[][])
    .map(row => ({
      date:    String(row[dateIdx] ?? '').trim(),
      seller:  String(row[sellerIdx] ?? '').trim(),
      value:   parseFloat(
        String(row[valueIdx] ?? '0')
          .replace(/[R$\s]/g, '')
          .replace(/\./g, '')
          .replace(',', '.')
      ) || 0,
      product: String(row[productIdx] ?? '').trim(),
    }))
    .filter(r => r.date && r.value > 0);
}

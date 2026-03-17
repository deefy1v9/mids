export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';

const ENDPOINTS_TO_TRY = [
  '/listar-caixa',
  '/listar-vendas',
  '/listar-faturamento',
  '/listar-financeiro',
  '/listar-dashboard',
  '/listar-resumo',
  '/listar-relatorio',
  '/listar-lucro',
  '/listar-ordem-servico',
  '/listar-ordens-servico',
  '/listar-servicos',
  '/listar-estoque',
  '/listar-produtos',
  '/listar-despesas',
  '/listar-custos',
  '/listar-resultado',
  '/listar-resultados',
  '/listar-dre',
  '/listar-balanco',
  '/listar-fluxo-caixa',
  '/listar-contas-a-pagar',
  '/listar-contas-pagar',
  '/visao-geral',
  '/dashboard',
  '/relatorio-financeiro',
  '/resumo-financeiro',
];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get('endpoint') ?? '/visao-geral';

  const today = new Date();
  const fmtBR = (d: Date) =>
    `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  // First day of current month
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const dataInicial = searchParams.get('data-inicial') ?? fmtBR(firstOfMonth);
  const dataFinal = searchParams.get('data-final') ?? fmtBR(today);
  const mes = searchParams.get('mes') ?? String(today.getMonth() + 1).padStart(2, '0');
  const ano = searchParams.get('ano') ?? String(today.getFullYear());

  const baseURL = process.env.TENFRONT_BASE_URL ?? 'https://api.tenfront.com.br/v1';
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.TENFRONT_BEARER_TOKEN}`,
    'Consumer-key': process.env.TENFRONT_CONSUMER_KEY,
    'Consumer-secret': process.env.TENFRONT_CONSUMER_SECRET,
  };

  const results: Record<string, unknown> = {};

  if (endpoint === 'all') {
    // Test all known endpoints
    for (const ep of ENDPOINTS_TO_TRY) {
      try {
        const { data, status } = await axios.post(
          `${baseURL}${ep}`,
          { page: 1, 'data-inicial': dataInicial, 'data-final': dataFinal, mes, ano },
          { headers, validateStatus: () => true }
        );
        results[ep] = { status, keys: Object.keys(data ?? {}), data };
      } catch (err) {
        results[ep] = { error: err instanceof Error ? err.message : String(err) };
      }
    }
    return NextResponse.json(results);
  }

  try {
    const { data, status } = await axios.post(
      `${baseURL}${endpoint}`,
      { page: 1, 'data-inicial': dataInicial, 'data-final': dataFinal, mes, ano },
      { headers, validateStatus: () => true }
    );
    return NextResponse.json({ endpoint, status, data, dataInicial, dataFinal });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

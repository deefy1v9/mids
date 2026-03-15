export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { TenFrontClient, extractClienteName, normalizeName } from '@/src/tenfront/client';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dataInicial = searchParams.get('data-inicial') ?? new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const dataFinal = searchParams.get('data-final') ?? new Date().toISOString().split('T')[0];

  try {
    const tenfront = new TenFrontClient();

    const [clientesMap, contas] = await Promise.all([
      tenfront.buildClientesMap(),
      tenfront.listContasAReceber(dataInicial, dataFinal),
    ]);

    const merged = contas.map((conta) => {
      const clienteName = extractClienteName(conta);
      const clienteInfo = clientesMap.get(normalizeName(clienteName));
      return {
        codigo: conta['Origem'] ?? '',
        cliente: clienteName,
        telefone: clienteInfo?.celular ?? null,
        email: clienteInfo?.email ?? null,
        cpf: clienteInfo?.cpf ?? null,
        valor: conta['Valor informado'],
        dataRecebimento: conta['Data recebimento'],
        forma: conta['Forma'],
        atendente: conta['Atendente'],
        clienteEncontrado: !!clienteInfo,
        _clienteBruto: clienteInfo ?? null,
      };
    });

    return NextResponse.json({
      totalContas: contas.length,
      totalClientes: clientesMap.size,
      comTelefone: merged.filter((m) => m.telefone).length,
      semTelefone: merged.filter((m) => !m.telefone).length,
      items: merged,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const detail =
      err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: unknown } }).response?.data
        : undefined;
    return NextResponse.json({ error: message, detail }, { status: 500 });
  }
}

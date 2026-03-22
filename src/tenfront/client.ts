import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';

// Cache em memória do mapa de clientes (válido por 12h por processo)
let _clientesMapCache: { data: Map<string, ClienteInfo>; ts: number } | null = null;
const CLIENTES_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

// Estrutura real retornada pela API TenFront (/listar-contas-a-receber)
export interface ContaAReceber {
  'Forma': string;
  'Forma de pagamento'?: string;
  'Origem': string;
  'Descrição': string;         // "ATE-XXXXXXX | Nome do Cliente"
  'Data recebimento': string;  // "DD/MM/YYYY" — data de registro do recebimento
  'Data compensação'?: string; // "DD/MM/YYYY" — data de compensação bancária (usada para filtros)
  'Conta': string;
  'Valor informado': number;   // valor recebido
  'Atendente': string;
  [key: string]: unknown;
}

// Interface flexível para atendimentos — os campos reais serão confirmados via debug
export interface Atendimento {
  [key: string]: unknown;
}

// Interface flexível para clientes (cadastro)
export interface Cliente {
  [key: string]: unknown;
}

// Dados extraídos do cadastro de cliente
export interface ClienteInfo {
  clienteName: string;
  celular?: string;
  email?: string;
  cpf?: string;
  registrationDate?: string; // ISO date string from "Data do cadastro" (DD/MM/YYYY)
}

// Dados relevantes extraídos de um atendimento para uso no sync
export interface AtendimentoInfo {
  codigo: string;         // ex: "ATE-XXXXXXX"
  clienteName: string;
  telefone?: string;
  email?: string;
}


// Extrai o nome do cliente a partir do campo "Descrição" ("ATE-XXX | Nome Aqui")
export function extractClienteName(conta: ContaAReceber): string {
  const desc = conta['Descrição'] ?? '';
  const parts = desc.split('|');
  return parts.length > 1 ? parts[1].trim() : desc.trim();
}

// Tenta extrair telefone de um atendimento usando vários possíveis nomes de campo
export function extractAtendimentoInfo(ate: Atendimento): AtendimentoInfo | null {
  const get = (key: string): string => String(ate[key] ?? '').trim();

  // Localiza o código do atendimento — tenta campos conhecidos, depois busca valor que comece com "ATE-"
  const codigoFromFields =
    get('Código') || get('Cod') || get('Atendimento') || get('Número') || get('Numero');

  const codigoFromValue = (() => {
    const key = Object.keys(ate).find((k) => String(ate[k] ?? '').trim().startsWith('ATE-'));
    return key ? String(ate[key]).trim() : '';
  })();

  const codigo = codigoFromFields.startsWith('ATE-') ? codigoFromFields : codigoFromValue;

  if (!codigo) return null;

  // Possíveis nomes de campos de telefone (API TenFront usa title-case)
  const telefone =
    get('Telefone') || get('Celular') || get('Fone') || get('WhatsApp') || get('Whatsapp') || undefined;

  // Possíveis nomes de campos de email
  const email = get('Email') || get('E-mail') || undefined;

  // Possíveis nomes do cliente
  const clienteName = get('Cliente') || get('Nome') || '';

  return {
    codigo,
    clienteName,
    telefone: telefone || undefined,
    email: email || undefined,
  };
}

// Normaliza nome para matching: minúsculas, sem acentos, sem espaços duplos
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extrai dados relevantes de um registro de cliente
export function extractClienteInfo(cliente: Cliente): ClienteInfo | null {
  const get = (key: string): string => String(cliente[key] ?? '').trim();

  const clienteName =
    get('Nome do cliente') || get('Nome') || get('Cliente') || get('nome') || '';

  if (!clienteName) return null;

  const celular =
    get('Celular') || get('Telefone') || get('Fone') || get('WhatsApp') || undefined;

  const email = get('E-mail') || get('Email') || undefined;
  const cpf = get('CPF') || get('Cpf') || undefined;

  // Parse "DD/MM/YYYY" → "YYYY-MM-DD"
  const rawDate = get('Data do cadastro');
  const dateMatch = rawDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const registrationDate = dateMatch
    ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`
    : undefined;

  return {
    clienteName,
    celular: celular || undefined,
    email: email || undefined,
    cpf: cpf || undefined,
    registrationDate,
  };
}

// Retorna uma data YYYY-MM-DD N dias antes de uma data base
function subtractDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

export class TenFrontClient {
  private http: AxiosInstance;

  constructor() {
    const baseURL = process.env.TENFRONT_BASE_URL ?? 'https://api.tenfront.com.br/v1';
    const token = process.env.TENFRONT_BEARER_TOKEN;
    const consumerKey = process.env.TENFRONT_CONSUMER_KEY;
    const consumerSecret = process.env.TENFRONT_CONSUMER_SECRET;

    if (!token || !consumerKey || !consumerSecret) {
      throw new Error(
        'Credenciais TenFront ausentes. Verifique TENFRONT_BEARER_TOKEN, TENFRONT_CONSUMER_KEY e TENFRONT_CONSUMER_SECRET no .env'
      );
    }

    this.http = axios.create({
      baseURL,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Consumer-key': consumerKey,
        'Consumer-secret': consumerSecret,
      },
    });
  }

  private async fetchAllPages<T>(
    endpoint: string,
    extraBody: Record<string, unknown> = {},
    maxPages = 200
  ): Promise<T[]> {
    const all: T[] = [];
    let page = 1;

    while (page <= maxPages) {
      const body = { ...extraBody, page };
      const { data } = await this.http.post<Record<string, unknown>>(endpoint, body);
      // TenFront usa 'Response' (maiúsculo) em alguns endpoints e 'response' (minúsculo) em outros
      const raw = data['Response'] ?? data['response'];
      const items = Array.isArray(raw) ? (raw as T[]) : [];

      if (items.length === 0) break;
      all.push(...items);

      // Se a API informar total de páginas, use; caso contrário, pagine até resposta vazia
      const totalPages = data['Total pages'] ?? data['total_pages'];
      if (totalPages !== undefined && page >= Number(totalPages)) break;

      page++;
    }

    return all;
  }

  async listContasAReceber(
    dataInicial?: string,
    dataFinal?: string
  ): Promise<ContaAReceber[]> {
    const body: Record<string, unknown> = {};
    if (dataInicial) body['data-inicial'] = dataInicial;
    if (dataFinal) body['data-final'] = dataFinal;

    logger.info(`TenFront: buscando contas a receber (${dataInicial} → ${dataFinal})`);
    const items = await this.fetchAllPages<ContaAReceber>('/listar-contas-a-receber', body, 20);
    logger.info(`TenFront: ${items.length} contas a receber encontradas`);
    return items;
  }

  async listAtendimentos(
    dataInicial?: string,
    dataFinal?: string
  ): Promise<Atendimento[]> {
    const body: Record<string, unknown> = {};
    if (dataInicial) body['data-inicial'] = dataInicial;
    if (dataFinal) body['data-final'] = dataFinal;

    logger.info(`TenFront: buscando atendimentos (${dataInicial} → ${dataFinal})`);
    const items = await this.fetchAllPages<Atendimento>('/listar-atendimentos', body);
    logger.info(`TenFront: ${items.length} atendimentos encontrados`);
    return items;
  }

  // Constrói mapa: codigo ATE → { telefone, email, clienteName }
  // Usa janela de 180 dias para trás a partir de dataFinal para cobrir atendimentos antigos
  async buildAtendimentosMap(
    dataFinal?: string
  ): Promise<Map<string, AtendimentoInfo>> {
    const end = dataFinal ?? new Date().toISOString().split('T')[0];
    const start = subtractDays(end, 180);

    logger.info(`TenFront: buscando atendimentos com janela extendida (${start} → ${end})`);
    const atendimentos = await this.listAtendimentos(start, end);
    const map = new Map<string, AtendimentoInfo>();

    for (const ate of atendimentos) {
      const info = extractAtendimentoInfo(ate);
      if (info?.codigo) {
        map.set(info.codigo, info);
      }
    }

    logger.info(`TenFront: mapa de atendimentos construído com ${map.size} entradas`);
    return map;
  }

  // Busca uma página específica de /listar-clientes
  async fetchClientePage(page: number): Promise<Cliente[]> {
    const { data } = await this.http.post<Record<string, unknown>>(
      '/listar-clientes', { page }
    );
    const raw = data['Response'] ?? data['response'];
    return Array.isArray(raw) ? (raw as Cliente[]) : [];
  }

  // Pagina /listar-clientes e para assim que uma página inteira for mais antiga que `since`.
  // Minimiza chamadas à API quando a lista é ordenada do mais novo para o mais antigo.
  async listClientesSince(
    since: Date,
    parseDate: (raw: unknown) => Date | null
  ): Promise<Cliente[]> {
    const result: Cliente[] = [];
    let page = 1;

    while (true) {
      const { data } = await this.http.post<Record<string, unknown>>(
        '/listar-clientes', { page }
      );
      const raw = data['Response'] ?? data['response'];
      const items = Array.isArray(raw) ? (raw as Cliente[]) : [];

      if (items.length === 0) break;

      const matching = items.filter(c => {
        const d = parseDate(c['Data do cadastro']);
        return d !== null && d >= since;
      });

      result.push(...matching);

      // Se nenhum item da página passou no filtro, todos são mais antigos — para
      if (matching.length === 0) break;

      const totalPages = data['Total pages'] ?? data['total_pages'];
      if (totalPages !== undefined && page >= Number(totalPages)) break;

      page++;
    }

    logger.info(`TenFront: ${result.length} clientes encontrados (${page} páginas consultadas)`);
    return result;
  }

  async listClientes(dataInicial?: string, dataFinal?: string): Promise<Cliente[]> {
    const body: Record<string, unknown> = {};
    if (dataInicial) body['data-inicial'] = dataInicial;
    if (dataFinal) body['data-final'] = dataFinal;

    logger.info(`TenFront: buscando cadastro de clientes (${dataInicial ?? 'sem filtro'} → ${dataFinal ?? 'sem filtro'})`);
    const items = await this.fetchAllPages<Cliente>('/listar-clientes', body);
    logger.info(`TenFront: ${items.length} clientes encontrados`);
    return items;
  }

  // Constrói mapa: nome normalizado → { celular, email, cpf, clienteName }
  async buildClientesMap(): Promise<Map<string, ClienteInfo>> {
    if (_clientesMapCache && Date.now() - _clientesMapCache.ts < CLIENTES_CACHE_TTL_MS) {
      logger.info(`TenFront: mapa de clientes do cache (${_clientesMapCache.data.size} entradas)`);
      return _clientesMapCache.data;
    }

    const clientes = await this.listClientes();
    const map = new Map<string, ClienteInfo>();

    for (const cliente of clientes) {
      const info = extractClienteInfo(cliente);
      if (info?.clienteName) {
        const key = normalizeName(info.clienteName);
        map.set(key, info);
      }
    }

    _clientesMapCache = { data: map, ts: Date.now() };
    logger.info(`TenFront: mapa de clientes construído com ${map.size} entradas`);
    return map;
  }
}

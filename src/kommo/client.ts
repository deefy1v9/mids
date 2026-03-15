import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../utils/logger';

export interface KommoLead {
  id: number;
  name: string;
  status_id: number;
  pipeline_id: number;
  price?: number;
  closed_at?: number | null;
}

export interface KommoContact {
  id: number;
  name: string;
  _embedded?: {
    leads?: KommoLead[];
  };
}

export interface KommoStage {
  id: number;
  name: string;
  type: number; // 0 = normal, 142 = won, 143 = lost
}

export interface KommoPipeline {
  id: number;
  name: string;
  _embedded: {
    statuses: KommoStage[];
  };
}

interface KommoContactsResponse {
  _total_items: number;
  _embedded: {
    contacts: KommoContact[];
  };
}

interface KommoPipelinesResponse {
  _total_items: number;
  _embedded: {
    pipelines: KommoPipeline[];
  };
}

const KOMMO_WON_STATUS_ID = 142;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class KommoClient {
  private http: AxiosInstance;

  constructor() {
    const subdomain = process.env.KOMMO_SUBDOMAIN;
    const token = process.env.KOMMO_ACCESS_TOKEN;

    if (!subdomain || !token) {
      throw new Error(
        'Credenciais Kommo ausentes. Verifique KOMMO_SUBDOMAIN e KOMMO_ACCESS_TOKEN no .env'
      );
    }

    this.http = axios.create({
      baseURL: `https://${subdomain}.kommo.com/api/v4`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
  }

  private async requestWithRetry<T>(fn: () => Promise<T>, attempt = 1): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const axiosErr = err as AxiosError;
      if (axiosErr.response?.status === 429 && attempt <= MAX_RETRIES) {
        const wait = RETRY_DELAY_MS * attempt;
        logger.warn(`Kommo: rate limit. Aguardando ${wait}ms (tentativa ${attempt}/${MAX_RETRIES})`);
        await sleep(wait);
        return this.requestWithRetry(fn, attempt + 1);
      }
      throw err;
    }
  }

  async findContactByQuery(query: string): Promise<KommoContact[]> {
    return this.requestWithRetry(async () => {
      const { data, status } = await this.http.get<KommoContactsResponse>('/contacts', {
        params: { query, with: 'leads', limit: 10 },
        validateStatus: (s) => s === 200 || s === 204,
      });
      if (status === 204 || !data) return [];
      return data._embedded?.contacts ?? [];
    });
  }

  async getPipelines(): Promise<KommoPipeline[]> {
    return this.requestWithRetry(async () => {
      const { data } = await this.http.get<KommoPipelinesResponse>('/leads/pipelines', {
        params: { with: 'statuses', limit: 50 },
      });
      return data._embedded?.pipelines ?? [];
    });
  }

  async markLeadAsWon(leadId: number, price?: number): Promise<KommoLead> {
    return this.requestWithRetry(async () => {
      const payload: Record<string, unknown> = {
        status_id: KOMMO_WON_STATUS_ID,
        closed_at: Math.floor(Date.now() / 1000),
        loss_reason_id: null,
      };
      if (price !== undefined) payload.price = price;

      const { data } = await this.http.patch<KommoLead>(`/leads/${leadId}`, payload);
      return data;
    });
  }

  async moveLeadToStage(
    leadId: number,
    pipelineId: number,
    stageId: number,
    price?: number
  ): Promise<KommoLead> {
    return this.requestWithRetry(async () => {
      const payload: Record<string, unknown> = {
        pipeline_id: pipelineId,
        status_id: stageId,
      };
      if (price !== undefined) payload.price = price;

      const { data } = await this.http.patch<KommoLead>(`/leads/${leadId}`, payload);
      return data;
    });
  }

  getOpenLeads(contact: KommoContact): KommoLead[] {
    const leads = contact._embedded?.leads ?? [];
    return leads.filter(
      (lead) => lead.status_id !== KOMMO_WON_STATUS_ID && lead.status_id !== 143
    );
  }
}

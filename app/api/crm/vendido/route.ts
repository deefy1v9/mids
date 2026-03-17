export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import axios from 'axios';

const META_UTM_SOURCES = ['facebook', 'meta', 'fb', 'instagram'];

interface KommoLead {
  id: number;
  name: string;
  status_id: number;
  pipeline_id: number;
  custom_fields_values?: Array<{
    field_id: number;
    field_name: string;
    values: Array<{ value: unknown }>;
  }>;
  _embedded?: {
    tags?: Array<{ id: number; name: string }>;
  };
}

function isMetaAdsLead(lead: KommoLead): boolean {
  // Check custom fields for UTM source
  if (lead.custom_fields_values) {
    for (const field of lead.custom_fields_values) {
      const fieldNameLower = (field.field_name ?? '').toLowerCase();
      if (fieldNameLower.includes('utm_source') || fieldNameLower.includes('utm source') || fieldNameLower.includes('origem')) {
        for (const v of field.values) {
          const val = String(v.value ?? '').toLowerCase();
          if (META_UTM_SOURCES.some(s => val.includes(s))) return true;
        }
      }
    }
  }
  // Check tags
  const tags = lead._embedded?.tags ?? [];
  for (const tag of tags) {
    const tagName = (tag.name ?? '').toLowerCase();
    if (META_UTM_SOURCES.some(s => tagName.includes(s)) || tagName.includes('meta ads') || tagName.includes('facebook ads')) {
      return true;
    }
  }
  return false;
}

export async function GET() {
  const subdomain = process.env.KOMMO_SUBDOMAIN;
  const token = process.env.KOMMO_ACCESS_TOKEN;
  const base = `https://${subdomain}.kommo.com/api/v4`;
  const headers = { Authorization: `Bearer ${token}` };

  try {
    // Find "Funil de Distribuição" pipeline
    const { data: pipelinesData } = await axios.get(`${base}/leads/pipelines`, {
      params: { with: 'statuses', limit: 50 },
      headers,
    });
    const pipelines: Array<{
      id: number;
      name: string;
      _embedded: { statuses: Array<{ id: number; name: string; type: number }> };
    }> = pipelinesData?._embedded?.pipelines ?? [];

    const distPipeline = pipelines.find(p =>
      p.name.toLowerCase().includes('distribuição') ||
      p.name.toLowerCase().includes('distribuicao') ||
      p.name.toLowerCase().includes('distribuição')
    );

    if (!distPipeline) {
      return NextResponse.json({ total: 0, metaAds: 0, pipelineFound: false, stageName: null });
    }

    // Find "Vendido" stage
    const vendidoStage = distPipeline._embedded.statuses.find(s =>
      s.name.toLowerCase().includes('vendid') || s.name.toLowerCase() === 'won'
    );

    if (!vendidoStage) {
      return NextResponse.json({
        total: 0, metaAds: 0,
        pipelineFound: true,
        pipelineName: distPipeline.name,
        stageName: null,
        availableStages: distPipeline._embedded.statuses.map(s => s.name),
      });
    }

    // Fetch leads in that pipeline + stage
    let page = 1;
    const allLeads: KommoLead[] = [];

    while (true) {
      const { data: leadsData, status } = await axios.get(`${base}/leads`, {
        params: {
          with: 'tags',
          limit: 250,
          page,
          'filter[pipeline_id][]': distPipeline.id,
          'filter[status_id][]': vendidoStage.id,
        },
        headers,
        validateStatus: s => s === 200 || s === 204,
      });

      if (status === 204 || !leadsData?._embedded?.leads?.length) break;

      const leads: KommoLead[] = leadsData._embedded.leads;
      allLeads.push(...leads);

      const totalItems = leadsData?._total_items ?? 0;
      if (allLeads.length >= totalItems) break;
      page++;
    }

    const metaLeads = allLeads.filter(isMetaAdsLead);

    return NextResponse.json({
      total: allLeads.length,
      metaAds: metaLeads.length,
      pipelineFound: true,
      pipelineName: distPipeline.name,
      stageName: vendidoStage.name,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const detail =
      err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: unknown; status?: number } }).response
        : undefined;
    return NextResponse.json({ error: message, detail }, { status: 500 });
  }
}

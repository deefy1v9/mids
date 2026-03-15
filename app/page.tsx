'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { AreaChart, Area, Grid, XAxis, YAxis, ChartTooltip } from '@/components/ui/area-chart';
import { FunnelChart } from '@/components/ui/funnel-chart';

type MatchAction = 'won' | 'stage_moved' | 'not_found' | 'error';

interface CrmLead {
  id: number;
  name: string;
  price: number;
  pipeline_id: number;
  status_id: number;
  created_at: number;
  _embedded?: { contacts?: { id: number; name: string; is_main: boolean }[] };
}
interface CrmStatus { id: number; name: string; color: string; type: number; }
interface CrmPipeline { id: number; name: string; _embedded: { statuses: CrmStatus[] }; }

interface TalkContact { id: number; name: string; }
interface Talk {
  id: number;
  created_at: number;
  updated_at: number;
  source_uid?: string;
  _embedded?: { contact?: TalkContact };
}

interface MatchRecord {
  id: string;
  date: string;
  clienteName: string;
  phone?: string;
  email?: string;
  valor?: number;
  kommoContactName?: string;
  kommoLeadId?: number;
  kommoLeadName?: string;
  action: MatchAction;
  pipelineId?: number;
  stageId?: number;
  errorMessage?: string;
}

interface KommoStage { id: number; name: string; type: number; }
interface KommoPipeline { id: number; name: string; _embedded: { statuses: KommoStage[] }; }
interface SyncConfig { markAsWon: boolean; pipelineId?: number; stageId?: number; }
interface SyncResult { total: number; matched: number; updated: number; notFound: number; errors: number; }

interface AnalyticsPeriod { sales: number; revenue: number; newChats: number; avgResponseMinutes: number; metaSpend: number; }
interface AnalyticsData {
  today: AnalyticsPeriod; week: AnalyticsPeriod; month: AnalyticsPeriod;
  dailySales: { date: string; sales: number; revenue: number; newChats: number; metaSpend: number }[];
  metaError?: string | null;
}

function formatCurrency(val?: number) {
  if (val === undefined || val === null) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
}
function formatDateShort(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function CircleProgress({ pct, size = 80, stroke = 7, color = '#AEFF6E' }: { pct: number; size?: number; stroke?: number; color?: string }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E5E7EB" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.6s ease' }} />
    </svg>
  );
}

function Sparkline({ data, color = '#AEFF6E', height = 36 }: { data: number[]; color?: string; height?: number }) {
  if (data.length < 2) return <div style={{ height }} />;
  const max = Math.max(...data, 1);
  const w = 140;
  const pts = data.map((v, i) =>
    `${(i / (data.length - 1)) * w},${height - (v / max) * (height - 4) - 2}`
  ).join(' ');
  return (
    <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5"
        strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function Dashboard() {
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [pipelines, setPipelines] = useState<KommoPipeline[]>([]);
  const [config, setConfig] = useState<SyncConfig>({ markAsWon: true });
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [editPhone, setEditPhone] = useState<{ matchId: string; value: string } | null>(null);
  const [debugData, setDebugData] = useState<unknown>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'chat' | 'config'>('overview');
  const [crmData, setCrmData] = useState<{ pipelines: CrmPipeline[]; leads: CrmLead[] } | null>(null);
  const [loadingCrm, setLoadingCrm] = useState(false);
  const [chatData, setChatData] = useState<Talk[]>([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('mids_analytics') : null;
      if (!raw) return null;
      const parsed = JSON.parse(raw) as AnalyticsData;
      // Invalidate cache if dailySales is missing (old format)
      if (!Array.isArray(parsed.dailySales)) {
        try { localStorage.removeItem('mids_analytics'); } catch { /* ignore */ }
        return null;
      }
      return parsed;
    } catch { return null; }
  });
  const [analyticsPeriod, setAnalyticsPeriod] = useState<'today' | 'week' | 'month'>('today');
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);

  const fetchAll = useCallback(async () => {
    const [matchRes, configRes] = await Promise.all([
      fetch('/api/matches').then(r => r.json()),
      fetch('/api/config').then(r => r.json()),
    ]);
    setMatches(matchRes);
    setConfig(configRes);
  }, []);

  useEffect(() => {
    fetchAll();
    fetch('/api/pipelines').then(r => r.json())
      .then(d => setPipelines(Array.isArray(d) ? d : []))
      .catch(() => { });
  }, [fetchAll]);

  useEffect(() => {
    if (activeTab === 'overview' && !crmData && !loadingCrm) {
      setLoadingCrm(true);
      fetch('/api/crm').then(r => r.json())
        .then(d => setCrmData(d))
        .catch(() => { })
        .finally(() => setLoadingCrm(false));
    }
  }, [activeTab, crmData, loadingCrm]);

  useEffect(() => {
    if (activeTab === 'chat' && chatData.length === 0 && !loadingChat) {
      setLoadingChat(true);
      fetch('/api/chat').then(r => r.json())
        .then(d => setChatData(d?.talks ?? []))
        .catch(() => { })
        .finally(() => setLoadingChat(false));
    }
  }, [activeTab, chatData, loadingChat]);

  useEffect(() => {
    if (activeTab === 'overview' && !analyticsData && !loadingAnalytics) {
      setLoadingAnalytics(true);
      fetch('/api/analytics').then(r => r.json())
        .then(d => {
          setAnalyticsData(d);
          try { localStorage.setItem('mids_analytics', JSON.stringify(d)); } catch { /* storage full or private mode */ }
        })
        .catch(() => { })
        .finally(() => setLoadingAnalytics(false));
    }
  }, [activeTab, analyticsData, loadingAnalytics]);

  const saveConfig = async () => {
    setSaving(true); setSavedOk(false);
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
    } finally { setSaving(false); }
  };

  const runSync = async () => {
    setSyncing(true); setSyncResult(null);
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      setSyncResult(await res.json());
      await fetchAll();
    } finally { setSyncing(false); }
  };

  const runDebugClientes = async () => {
    setDebugData(null); setShowDebug(true);
    try { setDebugData(await fetch('/api/debug/clientes').then(r => r.json())); }
    catch (e) { setDebugData({ error: String(e) }); }
  };

  const retryMatch = async (matchId: string, phone?: string) => {
    setRetrying(matchId);
    try {
      await fetch('/api/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId, phone }),
      });
      await fetchAll();
    } finally { setRetrying(null); setEditPhone(null); }
  };

  const stats = useMemo(() => ({
    total: matches.length,
    won: matches.filter(m => m.action === 'won').length,
    moved: matches.filter(m => m.action === 'stage_moved').length,
    notFound: matches.filter(m => m.action === 'not_found').length,
    errors: matches.filter(m => m.action === 'error').length,
  }), [matches]);

  const successPct = stats.total > 0 ? Math.round(((stats.won + stats.moved) / stats.total) * 100) : 0;
  const notFoundPct = stats.total > 0 ? Math.round((stats.notFound / stats.total) * 100) : 0;
  const withPhone = matches.filter(m => m.phone).length;
  const phonePct = stats.total > 0 ? Math.round((withPhone / stats.total) * 100) : 0;

  // Daily activity for last 14 days
  const dailyData = useMemo(() => {
    const days: Record<string, number> = {};
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      days[d.toISOString().split('T')[0]] = 0;
    }
    matches.forEach(m => {
      const day = m.date.split('T')[0];
      if (day in days) days[day]++;
    });
    return Object.entries(days);
  }, [matches]);

  // Mock data for chart/funnel when real data is absent
  const mockDailySales = useMemo(() => {
    const base = [820, 0, 1540, 980, 2100, 1650, 0, 3200, 2750, 1900, 4100, 3600, 2800, 5200];
    const baseMeta = [45, 45, 62, 58, 71, 68, 68, 95, 88, 74, 112, 105, 89, 130];
    const baseSales = [1, 0, 2, 1, 3, 2, 0, 4, 3, 2, 5, 4, 3, 6];
    const baseChats = [8, 6, 12, 9, 15, 11, 7, 18, 16, 13, 22, 19, 17, 25];
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (13 - i));
      return { date: d.toISOString().split('T')[0], revenue: base[i] ?? 0, metaSpend: baseMeta[i] ?? 0, sales: baseSales[i] ?? 0, newChats: baseChats[i] ?? 0 };
    });
  }, []);

  const mockFunnelData = [
    { label: 'Novo Lead', value: 120, displayValue: '120', color: '#2563eb' },
    { label: 'Qualificado', value: 74, displayValue: '74', color: '#2563eb' },
    { label: 'Proposta', value: 38, displayValue: '38', color: '#2563eb' },
    { label: 'Negociação', value: 21, displayValue: '21', color: '#2563eb' },
    { label: 'Vendido', value: 12, displayValue: '12', color: '#2563eb' },
  ];

  const selectedPipeline = pipelines.find(p => p.id === config.pipelineId);
  const availableStages = selectedPipeline
    ? selectedPipeline._embedded.statuses.filter(s => s.type !== 143 && s.type !== 142)
    : [];

  const todayStr = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

  return (
    <div className="min-h-screen" style={{ background: '#F1F3F8', fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* ─── Header ─── */}
      <header className="bg-white border-b border-gray-100 px-4 sm:px-8 py-3 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-4 sm:gap-8">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#AEFF6E' }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 1.5L12.5 4.5V9.5L7 12.5L1.5 9.5V4.5L7 1.5Z" fill="#111" strokeWidth="0" />
              </svg>
            </div>
            <span className="font-semibold text-gray-900 text-sm tracking-tight">Mids</span>
          </div>
          {/* Nav — desktop only */}
          <nav className="hidden sm:flex items-center gap-1">
            {([
              { key: 'overview', label: 'Visão Geral' },
              { key: 'chat', label: 'Chat' },
              { key: 'config', label: 'Configuração' },
            ] as const).map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className="px-4 py-1.5 rounded-full text-sm font-medium transition-all"
                style={activeTab === tab.key
                  ? { background: '#111', color: '#fff' }
                  : { color: '#9CA3AF' }}>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <span className="text-xs text-gray-400 hidden sm:block">{todayStr}</span>
          <button onClick={runDebugClientes}
            className="hidden sm:block text-xs text-gray-500 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors">
            Debug Clientes
          </button>
          <button onClick={runSync} disabled={syncing}
            className="flex items-center gap-1.5 text-sm font-semibold px-3 sm:px-4 py-1.5 rounded-xl transition-all disabled:opacity-60"
            style={{ background: '#AEFF6E', color: '#111' }}>
            {syncing
              ? <><span className="w-3.5 h-3.5 border-2 border-gray-700 border-t-transparent rounded-full animate-spin" /><span className="hidden sm:inline">Sincronizando</span></>
              : <><span>↻</span><span className="hidden sm:inline"> Sincronizar</span></>}
          </button>
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
            style={{ background: '#6366f1' }}>TK</div>
        </div>
      </header>

      {/* ─── Mobile Bottom Nav ─── */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 z-30 flex">
        {([
          { key: 'overview', label: 'Geral', icon: (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect x="2" y="2" width="7" height="7" rx="1.5" fill="currentColor" opacity=".9"/>
              <rect x="11" y="2" width="7" height="7" rx="1.5" fill="currentColor" opacity=".4"/>
              <rect x="2" y="11" width="7" height="7" rx="1.5" fill="currentColor" opacity=".4"/>
              <rect x="11" y="11" width="7" height="7" rx="1.5" fill="currentColor" opacity=".4"/>
            </svg>
          )},
          { key: 'chat', label: 'Chat', icon: (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v9a1 1 0 01-1 1H7l-4 3V4z" fill="currentColor" opacity=".9"/>
            </svg>
          )},
          { key: 'config', label: 'Config', icon: (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="2.5" fill="currentColor"/>
              <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          )},
        ] as const).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className="flex-1 py-2.5 flex flex-col items-center gap-0.5 transition-colors"
            style={activeTab === tab.key ? { color: '#111' } : { color: '#9CA3AF' }}>
            {tab.icon}
            <span className="text-[10px] font-medium">{tab.label}</span>
          </button>
        ))}
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-8 py-6 sm:py-8 pb-24 sm:pb-8">

        {/* Debug panel */}
        {showDebug && (
          <div className="mb-6 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <span className="text-sm font-medium text-gray-700">Debug — listar-clientes</span>
              <button onClick={() => setShowDebug(false)} className="text-xs text-gray-400 hover:text-gray-700">Fechar ✕</button>
            </div>
            <pre className="text-xs text-emerald-400 bg-gray-950 p-4 overflow-auto max-h-56 rounded-b-2xl leading-relaxed">
              {debugData ? JSON.stringify(debugData, null, 2) : 'Carregando...'}
            </pre>
          </div>
        )}

        {/* Sync result banner */}
        {syncResult && (
          <div className="mb-6 rounded-2xl px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-2 sm:gap-6 text-sm border"
            style={{ background: '#F7FFF0', borderColor: '#AEFF6E' }}>
            <span className="font-semibold text-gray-800">Sincronização concluída</span>
            <div className="flex flex-wrap gap-3 sm:contents">
              <span className="text-gray-600"><b className="text-gray-900">{syncResult.total}</b> clientes</span>
              <span style={{ color: '#16a34a' }}><b>{syncResult.updated}</b> atualizados</span>
              <span className="text-amber-600"><b>{syncResult.notFound}</b> não encontrados</span>
              {syncResult.errors > 0 && <span className="text-red-500"><b>{syncResult.errors}</b> erros</span>}
            </div>
          </div>
        )}

        {/* ══ OVERVIEW TAB ══ */}
        {activeTab === 'overview' && (
          <>
            <div className="mb-6">
              <p className="text-xs text-gray-400 uppercase tracking-widest font-medium mb-0.5">
                Dados baseados em todos os clientes
              </p>
              <h1 className="text-2xl sm:text-[2rem] font-bold text-gray-900 leading-tight">Painel Geral</h1>
            </div>

            {/* ── Performance KPIs ── */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-3 gap-3">
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Performance</p>
                <div className="flex items-center gap-2">
                  {loadingAnalytics && (
                    <div className="w-4 h-4 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
                  )}
                  <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1 shadow-sm">
                    {(['today', 'week', 'month'] as const).map(p => (
                      <button key={p} onClick={() => setAnalyticsPeriod(p)}
                        className="px-2.5 sm:px-4 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all"
                        style={analyticsPeriod === p ? { background: '#111', color: '#fff' } : { color: '#9CA3AF' }}>
                        {p === 'today' ? 'Hoje' : p === 'week' ? '7d' : '30d'}
                      </button>
                    ))}
                  </div>
                  {analyticsData && (
                    <button onClick={() => { try { localStorage.removeItem('mids_analytics'); } catch {} setAnalyticsData(null); setLoadingAnalytics(false); }}
                      className="text-xs text-gray-500 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 transition-colors">
                      ↺
                    </button>
                  )}
                </div>
              </div>

              {loadingAnalytics && (
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm animate-pulse">
                      <div className="h-3 bg-gray-100 rounded w-2/3 mb-4" />
                      <div className="h-8 bg-gray-100 rounded w-1/2" />
                    </div>
                  ))}
                  <div className="col-span-2 lg:col-span-1 bg-white rounded-2xl p-5 border border-gray-100 shadow-sm animate-pulse">
                    <div className="h-3 bg-gray-100 rounded w-2/3 mb-4" />
                    <div className="h-8 bg-gray-100 rounded w-1/2" />
                  </div>
                </div>
              )}

              {!loadingAnalytics && analyticsData && (() => {
                const p = analyticsData[analyticsPeriod];
                return (
                  <>
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
                      {/* Vendas */}
                      <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                        <div className="flex items-start justify-between mb-4">
                          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Vendas</p>
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm"
                            style={{ background: '#F0FDF4' }}>🏆</div>
                        </div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-4xl font-bold text-gray-900">{p.sales}</span>
                          <span className="text-sm text-gray-400 ml-1">fechamentos</span>
                        </div>
                      </div>

                      {/* Faturamento */}
                      <div className="rounded-2xl p-5 border shadow-sm relative overflow-hidden"
                        style={{ background: '#111827', borderColor: '#1f2937' }}>
                        <div className="absolute -top-6 -right-6 w-28 h-28 rounded-full opacity-30"
                          style={{ background: '#AEFF6E', filter: 'blur(30px)' }} />
                        <div className="relative">
                          <div className="flex items-start justify-between mb-4">
                            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Faturamento</p>
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                              style={{ background: '#AEFF6E', color: '#111' }}>R$</div>
                          </div>
                          <p className="text-2xl font-bold text-white leading-tight">{formatCurrency(p.revenue)}</p>
                        </div>
                      </div>

                      {/* Meta Ads */}
                      <div className="rounded-2xl p-5 border shadow-sm relative overflow-hidden"
                        style={{ background: '#1a1035', borderColor: '#2d1f5e' }}>
                        <div className="absolute -top-6 -right-6 w-28 h-28 rounded-full opacity-20"
                          style={{ background: '#1877F2', filter: 'blur(30px)' }} />
                        <div className="relative">
                          <div className="flex items-start justify-between mb-4">
                            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Meta Ads</p>
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                              style={{ background: '#1877F2', color: '#fff' }}>f</div>
                          </div>
                          <p className="text-2xl font-bold text-white leading-tight">{formatCurrency(p.metaSpend)}</p>
                          {analyticsData.metaError
                            ? <p className="text-xs text-red-400 mt-1 truncate" title={analyticsData.metaError}>⚠ erro API</p>
                            : <p className="text-xs text-gray-500 mt-1">investido</p>
                          }
                        </div>
                      </div>

                      {/* Chats novos */}
                      <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                        <div className="flex items-start justify-between mb-4">
                          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Chats Novos</p>
                          <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center text-sm">💬</div>
                        </div>
                        <span className="text-4xl font-bold text-gray-900">{p.newChats}</span>
                        <p className="text-sm text-gray-400 mt-0.5">conversas</p>
                      </div>

                      {/* Tempo médio resposta */}
                      <div className="col-span-2 lg:col-span-1 bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                        <div className="flex items-start justify-between mb-4">
                          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Tempo Médio Resposta</p>
                          <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center text-sm">⏱</div>
                        </div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-4xl font-bold text-gray-900">
                            {p.avgResponseMinutes < 60 ? p.avgResponseMinutes : Math.round(p.avgResponseMinutes / 60)}
                          </span>
                          <span className="text-sm text-gray-400 ml-1">
                            {p.avgResponseMinutes < 60 ? 'min' : 'h'}
                          </span>
                        </div>
                        {p.avgResponseMinutes === 0 && (
                          <p className="text-xs text-gray-300 mt-1">sem dados</p>
                        )}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* ── Row 1: 4 Stat Cards ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">

              {/* Card: Clientes Processados */}
              <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Clientes Processados</p>
                    <div className="flex items-baseline gap-1 mt-2">
                      <span className="text-4xl font-bold text-gray-900">{phonePct}</span>
                      <span className="text-xl font-bold text-gray-300">%</span>
                    </div>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm">⚙</div>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500 mb-3">
                  <span><b className="text-gray-700">{withPhone}</b> com tel</span>
                  <span className="text-gray-200">|</span>
                  <span><b className="text-gray-700">{stats.total}</b> total</span>
                </div>
                <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${phonePct}%`, background: '#AEFF6E' }} />
                </div>
              </div>

              {/* Card: Leads Sincronizados */}
              <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0 mr-2">
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Leads Sincronizados</p>
                    <div className="flex items-baseline gap-1 mt-2">
                      <span className="text-4xl font-bold text-gray-900">{stats.won + stats.moved}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{stats.won} ganhos · {stats.moved} movidos</p>
                  </div>
                  <div className="relative flex-shrink-0">
                    <CircleProgress pct={successPct} size={56} stroke={6} color="#AEFF6E" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-xs font-bold text-gray-800">{successPct}%</span>
                    </div>
                  </div>
                </div>
                <div className="h-1 bg-gray-100 rounded-full overflow-hidden mt-3">
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${successPct}%`, background: '#AEFF6E' }} />
                </div>
              </div>

              {/* Card: Anomalias */}
              <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Anomalias</p>
                    <div className="flex items-baseline gap-1 mt-2">
                      <span className="text-4xl font-bold text-gray-900">{notFoundPct}</span>
                      <span className="text-xl font-bold text-gray-300">%</span>
                    </div>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center text-sm">⚠</div>
                </div>
                <div className="flex items-center gap-3 text-xs mb-3">
                  <span className="text-amber-500"><b>{stats.notFound}</b> sem match</span>
                  <span className="text-gray-200">|</span>
                  <span className="text-red-400"><b>{stats.errors}</b> erros</span>
                </div>
                <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${notFoundPct}%`, background: '#fbbf24' }} />
                </div>
              </div>

              {/* Card: Taxa de Sucesso (dark) */}
              <div className="rounded-2xl p-5 border shadow-sm relative overflow-hidden"
                style={{ background: '#111827', borderColor: '#1f2937' }}>
                <div className="absolute -top-6 -right-6 w-28 h-28 rounded-full opacity-30"
                  style={{ background: '#AEFF6E', filter: 'blur(30px)' }} />
                <div className="relative">
                  <div className="flex items-start justify-between mb-4">
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Taxa de Sucesso</p>
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                      style={{ background: '#AEFF6E', color: '#111' }}>↑</div>
                  </div>
                  <div className="flex items-baseline gap-1 mb-1">
                    <span className="text-4xl font-bold text-white">{successPct}</span>
                    <span className="text-xl font-bold text-gray-600">%</span>
                  </div>
                  <p className="text-xs text-gray-500 mb-4">{stats.won + stats.moved} de {stats.total} total</p>
                  <Sparkline data={dailyData.map(([, v]) => v)} color="#AEFF6E" height={36} />
                </div>
              </div>
            </div>

            {/* ── Row 2: Fechamentos ── */}
            <div className="grid grid-cols-1 gap-3 sm:gap-4 mt-3 sm:mt-4">
              <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-3">Fechamentos</p>
                <div className="flex items-center gap-6">
                  <div>
                    <span className="text-4xl font-bold text-gray-900">{stats.won + stats.moved}</span>
                    <p className="text-xs text-gray-400 mt-0.5">leads atualizados</p>
                  </div>
                  <div className="w-px h-10 bg-gray-100" />
                  <div>
                    <span className="text-4xl font-bold" style={{ color: '#16a34a' }}>{stats.won}</span>
                    <p className="text-xs text-gray-400 mt-0.5">ganhos</p>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Funil de Distribuição ── */}
            {(() => {
              if (loadingCrm && !crmData) return (
                <div className="mt-3 sm:mt-4 bg-white rounded-2xl p-5 border border-gray-100 shadow-sm animate-pulse">
                  <div className="h-3 bg-gray-100 rounded w-40 mb-4" />
                  <div className="h-48 bg-gray-100 rounded-xl" />
                </div>
              );

              const distPipeline = crmData?.pipelines.find(p =>
                p.name.toLowerCase().includes('distribuição') || p.name.toLowerCase().includes('distribuicao')
              );

              let normalizedFunnel: { label: string; value: number; displayValue: string; color: string }[];
              let totalLeads = 0;
              let wonCount = 0;
              const isMock = !distPipeline;

              if (distPipeline) {
                const allStatuses = distPipeline._embedded.statuses;
                const activeStages = allStatuses.filter((s: CrmStatus) => s.type !== 142 && s.type !== 143);
                const wonStages = allStatuses.filter((s: CrmStatus) => s.type === 142);
                const pipelineLeads = crmData!.leads.filter((l: CrmLead) => l.pipeline_id === distPipeline.id);
                const wonLeads = pipelineLeads.filter((l: CrmLead) => wonStages.some((s: CrmStatus) => s.id === l.status_id));
                totalLeads = pipelineLeads.length;
                wonCount = wonLeads.length;
                const funnelStages = activeStages.map((stage: CrmStatus) => {
                  const count = pipelineLeads.filter((l: CrmLead) => l.status_id === stage.id).length;
                  return { label: stage.name, value: Math.max(count, 1), displayValue: String(count), color: '#2563eb' };
                });
                if (wonLeads.length > 0) funnelStages.push({ label: 'Vendidos', value: wonLeads.length, displayValue: String(wonLeads.length), color: '#2563eb' });
                const maxVal = Math.max(...funnelStages.map(s => s.value), 1);
                normalizedFunnel = [{ ...funnelStages[0]!, value: maxVal }, ...funnelStages.slice(1)];
              } else {
                // fallback mock
                normalizedFunnel = mockFunnelData;
                totalLeads = mockFunnelData[0]?.value ?? 0;
                wonCount = mockFunnelData[mockFunnelData.length - 1]?.value ?? 0;
              }

              return (
                <div className="mt-3 sm:mt-4 bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Funil de Distribuição</p>
                      <p className="text-sm font-semibold text-gray-800 mt-0.5">
                        {isMock ? <span className="text-gray-300 text-xs font-normal">dados de exemplo</span> : <>{totalLeads} leads{wonCount > 0 && <span className="text-xs font-normal text-green-600 ml-2">· {wonCount} vendidos</span>}</>}
                      </p>
                    </div>
                  </div>
                  <div style={{ height: 280, '--chart-1': '#2563eb', '--color-muted': 'transparent', '--chart-grid': 'rgba(0,0,0,0.06)', '--chart-foreground': '#111827', '--chart-foreground-muted': '#6B7280' } as React.CSSProperties}>
                    <FunnelChart
                      data={normalizedFunnel}
                      orientation="vertical"
                      color="#2563eb"
                      layers={3}
                      gap={6}
                      showPercentage={true}
                      showValues={true}
                      showLabels={true}
                      edges="curved"
                      labelLayout="spread"
                      formatValue={(v) => String(v)}
                      style={{ aspectRatio: 'unset', height: '100%' }}
                    />
                  </div>
                </div>
              );
            })()}

            {/* ── Row 3: Multi-series Chart ── */}
            {!loadingAnalytics && (() => {
              const realData = analyticsData?.dailySales ?? [];
              const hasReal = realData.length > 0 && realData.some(d => d.sales > 0 || d.newChats > 0 || d.metaSpend > 0);
              const chartData = hasReal ? realData : mockDailySales;
              const isMock = !hasReal;
              return (
                <div className="mt-3 sm:mt-4 bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                  <div className="mb-3 flex items-start justify-between flex-wrap gap-2">
                    <div>
                      <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Meta Ads · Leads Ganhos · Leads Novos — últimos 14 dias</p>
                      {isMock ? (
                        <p className="text-xs text-gray-300 mt-1">dados de exemplo</p>
                      ) : (
                        <p className="text-sm font-semibold text-gray-800 mt-1">
                          {formatCurrency(chartData.reduce((s, d) => s + (d.metaSpend ?? 0), 0))}
                          <span className="text-xs font-normal text-gray-400 ml-1">investido</span>
                          <span className="mx-2 text-gray-200">·</span>
                          <span style={{ color: '#AEFF6E' }}>{chartData.reduce((s, d) => s + d.sales, 0)}</span>
                          <span className="text-xs font-normal text-gray-400 ml-1">ganhos</span>
                          <span className="mx-2 text-gray-200">·</span>
                          <span style={{ color: '#6366f1' }}>{chartData.reduce((s, d) => s + (d.newChats ?? 0), 0)}</span>
                          <span className="text-xs font-normal text-gray-400 ml-1">novos</span>
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span className="flex items-center gap-1"><span className="w-3 h-1 rounded-full inline-block" style={{ background: '#1877F2' }} />Meta</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-1 rounded-full inline-block" style={{ background: '#AEFF6E' }} />Ganhos</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-1 rounded-full inline-block" style={{ background: '#6366f1' }} />Novos</span>
                    </div>
                  </div>
                  <div style={{ height: 220 }}>
                    <AreaChart
                      data={chartData as unknown as Record<string, unknown>[]}
                      xAccessor={d => new Date((d.date as string) + 'T12:00:00')}
                      margin={{ top: 10, right: 16, bottom: 36, left: 36 }}
                    >
                      <Grid horizontal />
                      <Area dataKey="metaSpend" fill="#1877F2" stroke="#1877F2" strokeWidth={2} />
                      <Area dataKey="sales" fill="#AEFF6E" stroke="#AEFF6E" strokeWidth={2} />
                      <Area dataKey="newChats" fill="#6366f1" stroke="#6366f1" strokeWidth={2} />
                      <XAxis numTicks={4} />
                      <YAxis numTicks={4} />
                      <ChartTooltip
                        rows={(p) => [
                          { color: '#1877F2', label: 'Meta Ads', value: formatCurrency(p.metaSpend as number) },
                          { color: '#AEFF6E', label: 'Leads ganhos', value: String(p.sales) },
                          { color: '#6366f1', label: 'Leads novos', value: String(p.newChats) },
                        ]}
                      />
                    </AreaChart>
                  </div>
                </div>
              );
            })()}

            {/* ── Row 4: Match Table ── */}
            <div className="mt-3 sm:mt-4 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-4 sm:px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Histórico de Vendas Tenfront</h2>
                  <p className="text-xs text-gray-400 mt-0.5">{matches.length} registros</p>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {[
                    { label: 'Ganhos', count: stats.won, color: '#16a34a', bg: '#f0fdf4' },
                    { label: 'Não enc.', count: stats.notFound, color: '#d97706', bg: '#fffbeb' },
                    { label: 'Erros', count: stats.errors, color: '#ef4444', bg: '#fef2f2' },
                  ].map(s => (
                    <span key={s.label} className="px-2.5 py-1 rounded-full text-xs font-medium"
                      style={{ background: s.bg, color: s.color }}>
                      {s.label} · {s.count}
                    </span>
                  ))}
                </div>
              </div>

              {matches.length === 0 ? (
                <div className="py-20 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-3 text-3xl">⟳</div>
                  <p className="text-gray-400 text-sm font-medium">Nenhum match ainda</p>
                  <p className="text-gray-300 text-xs mt-1">Rode uma sincronização para começar</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {[...matches].sort((a, b) => {
                    const order: Record<MatchAction, number> = { won: 0, stage_moved: 1, not_found: 2, error: 3 };
                    return order[a.action] - order[b.action];
                  }).map(m => {
                    const isRetrying = retrying === m.id;
                    const isEditingPhone = editPhone?.matchId === m.id;
                    const canRetryDirect = m.action === 'error' && !!m.kommoLeadId;
                    const canEditPhone = m.action === 'not_found' || (m.action === 'error' && !m.kommoLeadId);

                    const dot = { won: '#22c55e', stage_moved: '#6366f1', not_found: '#f59e0b', error: '#ef4444' }[m.action];
                    const avatarBg = { won: '#dcfce7', stage_moved: '#ede9fe', not_found: '#fef9c3', error: '#fee2e2' }[m.action];
                    const avatarColor = { won: '#16a34a', stage_moved: '#7c3aed', not_found: '#d97706', error: '#dc2626' }[m.action];
                    const label = { won: 'Ganho', stage_moved: 'Movido', not_found: 'Não encontrado', error: 'Erro' }[m.action];

                    return (
                      <div key={m.id}
                        className="px-4 sm:px-6 py-3 sm:py-3.5 flex items-center gap-3 hover:bg-gray-50/60 transition-colors">
                        {/* Avatar */}
                        <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0"
                          style={{ background: avatarBg, color: avatarColor }}>
                          {m.clienteName.charAt(0).toUpperCase()}
                        </div>

                        {/* Name + valor on mobile */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{m.clienteName}</p>
                              <span className="flex items-center gap-1 text-xs text-gray-400 flex-shrink-0">
                                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: dot }} />
                                <span className="hidden xs:inline">{label}</span>
                              </span>
                            </div>
                            {m.valor !== undefined && (
                              <span className="text-xs font-semibold text-gray-700 flex-shrink-0 sm:hidden">{formatCurrency(m.valor)}</span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 truncate mt-0.5">
                            {[m.phone, m.email].filter(Boolean).join(' · ') || '—'}
                            {m.errorMessage && <span className="text-red-400 ml-2">{m.errorMessage}</span>}
                          </p>
                        </div>

                        {/* Kommo — md+ */}
                        <div className="hidden md:block text-xs text-gray-500 min-w-[140px]">
                          {m.kommoContactName
                            ? <><p className="font-medium text-gray-700 truncate">{m.kommoContactName}</p>
                              {m.kommoLeadName && <p className="text-gray-400 truncate">Lead #{m.kommoLeadId}</p>}</>
                            : <span className="text-gray-300">—</span>}
                        </div>

                        {/* Valor — sm+ */}
                        <div className="hidden sm:block text-sm font-semibold text-gray-700 min-w-[80px] text-right">
                          {formatCurrency(m.valor)}
                        </div>

                        {/* Date — lg+ */}
                        <div className="hidden lg:block text-xs text-gray-400 min-w-[60px] text-right">
                          {formatDateShort(m.date)}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {canRetryDirect && (
                            <button onClick={() => retryMatch(m.id)} disabled={isRetrying}
                              className="text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all disabled:opacity-40"
                              style={{ background: '#EEF2FF', color: '#6366f1' }}>
                              {isRetrying ? '...' : 'Reenviar'}
                            </button>
                          )}
                          {canEditPhone && !isEditingPhone && (
                            <button onClick={() => setEditPhone({ matchId: m.id, value: m.phone ?? '' })}
                              className="text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all border border-gray-200 text-gray-500 hover:bg-gray-50">
                              + Tel
                            </button>
                          )}
                          {isEditingPhone && (
                            <div className="flex gap-1 items-center">
                              <input type="text" value={editPhone.value} autoFocus
                                onChange={e => setEditPhone({ matchId: m.id, value: e.target.value })}
                                placeholder="13991740991"
                                className="w-24 sm:w-28 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
                                onKeyDown={e => {
                                  if (e.key === 'Enter') retryMatch(m.id, editPhone.value);
                                  if (e.key === 'Escape') setEditPhone(null);
                                }} />
                              <button onClick={() => retryMatch(m.id, editPhone.value)}
                                disabled={isRetrying || !editPhone.value}
                                className="text-xs px-2 py-1.5 rounded-lg font-semibold disabled:opacity-40"
                                style={{ background: '#AEFF6E', color: '#111' }}>
                                {isRetrying ? '...' : 'OK'}
                              </button>
                              <button onClick={() => setEditPhone(null)} className="text-gray-300 hover:text-gray-600 text-xs px-1">✕</button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* ══ CHAT TAB ══ */}
        {activeTab === 'chat' && (
          <div className="mt-4 sm:mt-6">
            <div className="mb-4 sm:mb-6 flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-widest font-medium mb-0.5">Kommo</p>
                <h1 className="text-2xl sm:text-[2rem] font-bold text-gray-900 leading-tight">Conversas ao Vivo</h1>
              </div>
              <button onClick={() => { setChatData([]); setLoadingChat(false); }}
                className="text-xs text-gray-500 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors">
                ↺ Atualizar
              </button>
            </div>

            {loadingChat && (
              <div className="flex items-center justify-center py-24">
                <div className="w-8 h-8 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {!loadingChat && chatData.length === 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-20 text-center">
                <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-3 text-3xl">💬</div>
                <p className="text-gray-400 text-sm font-medium">Nenhuma conversa encontrada</p>
                <p className="text-gray-300 text-xs mt-1">Verifique se o módulo de Chat está ativo no Kommo</p>
              </div>
            )}

            {!loadingChat && chatData.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100">
                  <h2 className="text-sm font-semibold text-gray-900">Conversas recentes</h2>
                  <p className="text-xs text-gray-400 mt-0.5">{chatData.length} conversas</p>
                </div>
                <div className="divide-y divide-gray-50">
                  {chatData.map(talk => {
                    const contact = talk._embedded?.contact;
                    const name = contact?.name ?? `Talk #${talk.id}`;
                    const initial = name.charAt(0).toUpperCase();
                    const updatedAt = new Date(talk.updated_at * 1000);
                    const isToday = updatedAt.toDateString() === new Date().toDateString();
                    const timeStr = isToday
                      ? updatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                      : updatedAt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });

                    return (
                      <div key={talk.id}
                        className="px-6 py-4 flex items-center gap-4 hover:bg-gray-50/60 transition-colors cursor-pointer">
                        {/* Avatar */}
                        <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-sm font-bold flex-shrink-0"
                          style={{ background: '#EDE9FE', color: '#7C3AED' }}>
                          {initial}
                        </div>
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-gray-900 truncate">{name}</p>
                            <span className="text-xs text-gray-400 flex-shrink-0">{timeStr}</span>
                          </div>
                          <p className="text-xs text-gray-400 truncate mt-0.5">
                            {talk.source_uid ? `Canal: ${talk.source_uid}` : 'Conversa ativa'}
                          </p>
                        </div>
                        {/* Status dot */}
                        <div className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ background: '#AEFF6E', boxShadow: '0 0 6px #AEFF6E' }} />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ CONFIG TAB ══ */}
        {activeTab === 'config' && (
          <div className="mt-6 w-full sm:max-w-lg">
            <h1 className="text-2xl font-bold text-gray-900 mb-6">Configuração</h1>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-6">

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Marcar como Ganho</p>
                  <p className="text-xs text-gray-400 mt-0.5">Usa status_id 142 — ignora pipeline/etapa abaixo</p>
                </div>
                <button onClick={() => setConfig(c => ({ ...c, markAsWon: !c.markAsWon }))}
                  className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0"
                  style={{ background: config.markAsWon ? '#AEFF6E' : '#E5E7EB' }}>
                  <span className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform"
                    style={{ transform: config.markAsWon ? 'translateX(22px)' : 'translateX(2px)' }} />
                </button>
              </div>

              {!config.markAsWon && (
                <div className="grid grid-cols-2 gap-4 pt-5 border-t border-gray-100">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Pipeline</label>
                    <select value={config.pipelineId ?? ''}
                      onChange={e => setConfig(c => ({ ...c, pipelineId: Number(e.target.value) || undefined, stageId: undefined }))}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-gray-50 text-gray-700">
                      <option value="">Selecione</option>
                      {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Etapa</label>
                    <select value={config.stageId ?? ''} disabled={!config.pipelineId}
                      onChange={e => setConfig(c => ({ ...c, stageId: Number(e.target.value) || undefined }))}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-gray-50 text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed">
                      <option value="">Selecione</option>
                      {availableStages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                {savedOk && (
                  <span className="text-sm text-green-600 font-medium">✓ Configuração salva</span>
                )}
                <button onClick={saveConfig} disabled={saving}
                  className="ml-auto text-sm font-semibold px-6 py-2.5 rounded-xl transition-all disabled:opacity-50"
                  style={{ background: '#AEFF6E', color: '#111' }}>
                  {saving ? 'Salvando...' : 'Salvar configuração'}
                </button>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

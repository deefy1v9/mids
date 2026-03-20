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
  last_message?: { text?: string; created_at?: number; type?: string };
  _embedded?: {
    contact?: TalkContact;
    source?: { type?: string; external_id?: string; name?: string };
  };
}
interface TalkMessage {
  id: string;
  text?: string;
  type?: string;
  created_at?: number;
  author?: { type?: string; id?: string; name?: string };
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

interface SellerEntry { nome: string; vendas: number; faturamento: number; }
interface AnalyticsPeriod { sales: number; revenue: number; lucro?: number; newChats: number; avgResponseMinutes: number; metaSpend: number; metaResults?: number; metaCostPerResult?: number; ranking?: SellerEntry[]; }
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
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('mids_dark') === '1';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) { root.classList.add('dark'); localStorage.setItem('mids_dark', '1'); }
    else { root.classList.remove('dark'); localStorage.setItem('mids_dark', '0'); }
  }, [isDark]);

  const [config, setConfig] = useState<SyncConfig>({ markAsWon: true });
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncPage, setSyncPage] = useState('195');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [editPhone, setEditPhone] = useState<{ matchId: string; value: string } | null>(null);
  const [debugData, setDebugData] = useState<unknown>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'chat' | 'config'>('overview');
  const [crmData, setCrmData] = useState<{ pipelines: CrmPipeline[]; leads: CrmLead[] } | null>(null);
  const [loadingCrm, setLoadingCrm] = useState(false);
  const [vendidoData, setVendidoData] = useState<{ total: number; metaAds: number; pipelineName?: string; stageName?: string | null; error?: string } | null>(null);
  const [loadingVendido, setLoadingVendido] = useState(false);
  const [chatData, setChatData] = useState<Talk[]>([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [openTalk, setOpenTalk] = useState<Talk | null>(null);
  const [talkMessages, setTalkMessages] = useState<TalkMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messagesRaw, setMessagesRaw] = useState<unknown>(null);
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('mids_analytics') : null;
      if (!raw) return null;
      const parsed = JSON.parse(raw) as AnalyticsData;
      // Invalidate cache if format is outdated
      if (!parsed.today || !parsed.week || !parsed.month || !Array.isArray(parsed.dailySales) || parsed.today?.lucro === undefined) {
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
    setMatches(Array.isArray(matchRes) ? matchRes : []);
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
    if (activeTab === 'overview' && !vendidoData && !loadingVendido) {
      setLoadingVendido(true);
      fetch('/api/crm/vendido').then(r => r.json())
        .then(d => setVendidoData(d))
        .catch(() => { })
        .finally(() => setLoadingVendido(false));
    }
  }, [activeTab, vendidoData, loadingVendido]);

  useEffect(() => {
    if (activeTab === 'chat' && chatData.length === 0 && !loadingChat) {
      setLoadingChat(true);
      fetch('/api/chat').then(r => r.json())
        .then(d => { setChatData(d?.talks ?? []); })
        .catch(() => { })
        .finally(() => setLoadingChat(false));
    }
  }, [activeTab, chatData, loadingChat]);

  useEffect(() => {
    if (activeTab === 'overview' && !analyticsData && !loadingAnalytics) {
      setLoadingAnalytics(true);
      fetch('/api/analytics').then(r => r.json())
        .then(d => {
          if (!d?.today || !d?.week || !d?.month) return;
          setAnalyticsData(d);
          try { localStorage.setItem('mids_analytics', JSON.stringify(d)); } catch { /* storage full or private mode */ }
        })
        .catch(() => { })
        .finally(() => setLoadingAnalytics(false));
    }
  }, [activeTab, analyticsData, loadingAnalytics]);

  const openTalkMessages = (talk: Talk) => {
    setOpenTalk(talk);
    setTalkMessages([]);
    setMessagesRaw(null);
    setLoadingMessages(true);
    fetch(`/api/chat/messages?talkId=${talk.id}`).then(r => r.json())
      .then(d => {
        setMessagesRaw(d);
        const msgs: TalkMessage[] = (d?.messages ?? []).map((m: Record<string, unknown>) => ({
          id: String(m.id ?? Math.random()),
          text: (m.text as string | undefined) || (m.content as string | undefined) || '',
          type: m.type as string | undefined,
          created_at: m.created_at as number | undefined,
          author: m.author as TalkMessage['author'],
        }));
        setTalkMessages(msgs);
      })
      .catch(() => { })
      .finally(() => setLoadingMessages(false));
  };

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
      const url = `/api/sync?fromPage=${encodeURIComponent(syncPage || '195')}`;
      const res = await fetch(url, { method: 'POST' });
      setSyncResult(await res.json());
      await fetchAll();
    } finally { setSyncing(false); }
  };

  const deleteMatch = async (id: string) => {
    setDeletingId(id);
    try {
      await fetch(`/api/matches/${id}`, { method: 'DELETE' });
      setMatches(prev => prev.filter(m => m.id !== id));
    } finally { setDeletingId(null); }
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
    <div className="min-h-screen" style={{ background: 'var(--bg-page)', fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* ─── Header ─── */}
      <header className="border-b px-4 sm:px-8 py-3 flex items-center justify-between sticky top-0 z-20" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-4 sm:gap-8">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#AEFF6E' }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 1.5L12.5 4.5V9.5L7 12.5L1.5 9.5V4.5L7 1.5Z" fill="#111" strokeWidth="0" />
              </svg>
            </div>
            <span className="font-semibold text-sm tracking-tight" style={{ color: 'var(--text-primary)' }}>Mids</span>
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
                  ? { background: 'var(--text-primary)', color: 'var(--bg-page)' }
                  : { color: 'var(--text-muted)' }}>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <span className="text-xs text-gray-400 hidden sm:block">{todayStr}</span>
          {/* Dark mode toggle */}
          <button onClick={() => setIsDark(d => !d)}
            className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors border"
            style={{ background: 'var(--surface-2)', borderColor: 'var(--border-strong)', color: 'var(--text-muted)' }}
            title={isDark ? 'Modo claro' : 'Modo escuro'}>
            {isDark
              ? <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4.22 2.22a1 1 0 011.42 1.42l-.7.7a1 1 0 01-1.42-1.42l.7-.7zM18 9a1 1 0 110 2h-1a1 1 0 110-2h1zM5.78 15.78a1 1 0 01-1.42-1.42l.7-.7a1 1 0 011.42 1.42l-.7.7zM10 16a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zm-6-7a1 1 0 110 2H3a1 1 0 110-2h1zm1.22-5.78a1 1 0 011.42 1.42l-.7.7A1 1 0 015.52 5.5l.7-.7zM10 6a4 4 0 100 8 4 4 0 000-8z"/></svg>
              : <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"/></svg>
            }
          </button>
          <button onClick={runDebugClientes}
            className="hidden sm:block text-xs text-gray-500 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800">
            Debug Clientes
          </button>
          <div className="flex items-center gap-1.5">
            <input
              type="number" value={syncPage} onChange={e => setSyncPage(e.target.value)}
              min={1} disabled={syncing}
              className="w-16 text-xs text-center border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-50"
              style={{ background: 'var(--surface-2)', color: 'var(--text-primary)', borderColor: 'var(--border-strong)' }}
              title="Página do TenFront para sincronizar"
            />
            <button onClick={runSync} disabled={syncing}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 sm:px-4 py-1.5 rounded-xl transition-all disabled:opacity-60"
              style={{ background: '#AEFF6E', color: '#111' }}>
              {syncing
                ? <><span className="w-3.5 h-3.5 border-2 border-gray-700 border-t-transparent rounded-full animate-spin" /><span className="hidden sm:inline">Sincronizando</span></>
                : <><span>↻</span><span className="hidden sm:inline"> Sincronizar</span></>}
            </button>
          </div>
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
            style={{ background: '#6366f1' }}>TK</div>
        </div>
      </header>

      {/* ─── Mobile Bottom Nav ─── */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-30 flex border-t" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        {([
          {
            key: 'overview', label: 'Geral', icon: (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <rect x="2" y="2" width="7" height="7" rx="1.5" fill="currentColor" opacity=".9" />
                <rect x="11" y="2" width="7" height="7" rx="1.5" fill="currentColor" opacity=".4" />
                <rect x="2" y="11" width="7" height="7" rx="1.5" fill="currentColor" opacity=".4" />
                <rect x="11" y="11" width="7" height="7" rx="1.5" fill="currentColor" opacity=".4" />
              </svg>
            )
          },
          {
            key: 'chat', label: 'Chat', icon: (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v9a1 1 0 01-1 1H7l-4 3V4z" fill="currentColor" opacity=".9" />
              </svg>
            )
          },
          {
            key: 'config', label: 'Config', icon: (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="2.5" fill="currentColor" />
                <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            )
          },
        ] as const).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className="flex-1 py-2.5 flex flex-col items-center gap-0.5 transition-colors"
            style={activeTab === tab.key ? { color: 'var(--text-primary)' } : { color: 'var(--text-muted)' }}>
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
            style={{ background: isDark ? '#0d2010' : '#F7FFF0', borderColor: '#AEFF6E' }}>
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
                        style={analyticsPeriod === p ? { background: 'var(--text-primary)', color: 'var(--bg-page)' } : { color: 'var(--text-muted)' }}>
                        {p === 'today' ? 'Hoje' : p === 'week' ? '7d' : '30d'}
                      </button>
                    ))}
                  </div>
                  {analyticsData && (
                    <button onClick={() => { try { localStorage.removeItem('mids_analytics'); } catch { } setAnalyticsData(null); setLoadingAnalytics(false); }}
                      className="text-xs text-gray-500 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 transition-colors">
                      ↺
                    </button>
                  )}
                </div>
              </div>

              {loadingAnalytics && (
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm animate-pulse">
                      <div className="h-3 bg-gray-100 rounded w-2/3 mb-4" />
                      <div className="h-8 bg-gray-100 rounded w-1/2" />
                    </div>
                  ))}
                </div>
              )}

              {!loadingAnalytics && analyticsData && (() => {
                const p = analyticsData[analyticsPeriod];
                return (
                  <>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
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

                      {/* Lucro */}
                      <div className="rounded-2xl p-5 border shadow-sm relative overflow-hidden"
                        style={{ background: '#0a1f0f', borderColor: '#1a3a20' }}>
                        <div className="absolute -top-6 -right-6 w-28 h-28 rounded-full opacity-30"
                          style={{ background: '#AEFF6E', filter: 'blur(30px)' }} />
                        <div className="relative">
                          <div className="flex items-start justify-between mb-4">
                            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Lucro</p>
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                              style={{ background: '#AEFF6E', color: '#111' }}>↑</div>
                          </div>
                          <p className="text-2xl font-bold leading-tight"
                            style={{ color: (p.lucro ?? 0) >= 0 ? '#AEFF6E' : '#f87171' }}>
                            {formatCurrency(p.lucro ?? 0)}
                          </p>
                          <p className="text-xs mt-1" style={{ color: '#86efac' }}>faturamento − meta ads</p>
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
                            : <p className="text-xs mt-1" style={{ color: '#a78bfa' }}>investido</p>
                          }
                          {!analyticsData.metaError && (p.metaResults ?? 0) > 0 && (
                            <div className="mt-3 pt-3 border-t" style={{ borderColor: '#3d2a6e' }}>
                              <div className="flex items-center justify-between gap-2">
                                <div>
                                  <p className="text-lg font-bold text-white leading-tight">{p.metaResults}</p>
                                  <p className="text-[11px]" style={{ color: '#a78bfa' }}>resultados</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-sm font-semibold text-white">{formatCurrency(p.metaCostPerResult ?? 0)}</p>
                                  <p className="text-[11px]" style={{ color: '#a78bfa' }}>por resultado</p>
                                </div>
                              </div>
                            </div>
                          )}
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
                      <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
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

                    {/* Ranking de Vendedores */}
                    {(() => {
                      const ranking = analyticsData[analyticsPeriod].ranking ?? [];
                      if (ranking.length === 0) return null;
                      const first = ranking[0]!;
                      const second = ranking[1];
                      const third = ranking[2];
                      const rest = ranking.slice(3);
                      const initials = (nome: string) => nome.trim().split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
                      return (
                        <div className="mt-3 sm:mt-4 rounded-2xl border overflow-hidden"
                          style={{ background: '#0d0d0d', borderColor: '#1f2937' }}>
                          <div className="px-5 pt-5 pb-2">
                            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Ranking de Vendedores</p>
                          </div>

                          {/* Pódio — 1°, 2° e 3° lugar */}
                          <div className="flex items-end gap-2 px-4 pb-4 pt-2">
                            {/* 2° lugar */}
                            {second ? (
                              <div className="flex-1 rounded-2xl p-3 flex flex-col items-center text-center relative overflow-hidden"
                                style={{ background: '#1c1c1e', border: '1px solid #2a2a2e' }}>
                                <div className="w-12 h-12 rounded-full flex items-center justify-center text-base font-bold mb-2 border-2"
                                  style={{ background: '#2a2a2e', color: '#9ca3af', borderColor: '#3a3a3e' }}>
                                  {initials(second.nome)}
                                </div>
                                <p className="text-[9px] text-gray-500 font-medium uppercase tracking-widest mb-0.5">🥈 2° Lugar</p>
                                <p className="text-xs font-bold text-white leading-tight">{second.nome}</p>
                                <p className="text-sm font-bold mt-1" style={{ color: '#d1d5db' }}>{formatCurrency(second.faturamento)}</p>
                                <p className="text-[10px] text-gray-600 mt-1">🏆 {second.vendas} vendas</p>
                              </div>
                            ) : <div className="flex-1" />}

                            {/* 1° lugar — centro, maior */}
                            <div className="flex-1 rounded-2xl p-4 flex flex-col items-center text-center relative overflow-hidden"
                              style={{ background: 'linear-gradient(145deg, #3d2800, #1a1000)', border: '1px solid #D97706', marginBottom: '-8px' }}>
                              <div className="absolute -top-4 -right-4 w-20 h-20 rounded-full opacity-30"
                                style={{ background: '#F59E0B', filter: 'blur(20px)' }} />
                              <div className="relative w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold mb-2 border-2"
                                style={{ background: '#D97706', color: '#000', borderColor: '#F59E0B' }}>
                                {initials(first.nome)}
                              </div>
                              <p className="text-[9px] font-medium uppercase tracking-widest mb-0.5" style={{ color: '#F59E0B' }}>🏆 1° Lugar</p>
                              <p className="text-xs font-bold text-white leading-tight">{first.nome}</p>
                              <p className="text-base font-bold mt-1" style={{ color: '#F59E0B' }}>{formatCurrency(first.faturamento)}</p>
                              <p className="text-[10px] mt-1" style={{ color: '#92400e' }}>🏆 {first.vendas} vendas</p>
                            </div>

                            {/* 3° lugar */}
                            {third ? (
                              <div className="flex-1 rounded-2xl p-3 flex flex-col items-center text-center relative overflow-hidden"
                                style={{ background: '#1c1c1e', border: '1px solid #3a2510' }}>
                                <div className="w-12 h-12 rounded-full flex items-center justify-center text-base font-bold mb-2 border-2"
                                  style={{ background: '#2a1a0a', color: '#cd7f32', borderColor: '#cd7f32' }}>
                                  {initials(third.nome)}
                                </div>
                                <p className="text-[9px] font-medium uppercase tracking-widest mb-0.5" style={{ color: '#cd7f32' }}>🥉 3° Lugar</p>
                                <p className="text-xs font-bold text-white leading-tight">{third.nome}</p>
                                <p className="text-sm font-bold mt-1" style={{ color: '#cd7f32' }}>{formatCurrency(third.faturamento)}</p>
                                <p className="text-[10px] mt-1" style={{ color: '#6b4226' }}>🏆 {third.vendas} vendas</p>
                              </div>
                            ) : <div className="flex-1" />}
                          </div>

                          {/* 4°+ lugar — lista */}
                          {rest.length > 0 && (
                            <div className="border-t px-5 py-3 flex flex-col gap-2.5" style={{ borderColor: '#1f2937' }}>
                              {rest.map((s, i) => (
                                <div key={s.nome} className="flex items-center gap-3">
                                  <span className="text-xs text-gray-600 w-5 text-center font-bold">{i + 4}°</span>
                                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                                    style={{ background: '#1f2937', color: '#6b7280' }}>
                                    {initials(s.nome)}
                                  </div>
                                  <p className="flex-1 text-sm text-gray-300 truncate">{s.nome}</p>
                                  <p className="text-xs text-gray-500">{s.vendas} vend.</p>
                                  <p className="text-sm font-semibold text-gray-200 ml-2">{formatCurrency(s.faturamento)}</p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}
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

            {/* ── Row 2: Fechamentos + Vendido Meta Ads ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 mt-3 sm:mt-4">
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

              {/* Card: Vendido — Meta Ads */}
              <div className="rounded-2xl p-5 border shadow-sm relative overflow-hidden"
                style={{ background: '#0e1726', borderColor: '#1a2a4a' }}>
                <div className="absolute -top-6 -right-6 w-28 h-28 rounded-full opacity-20"
                  style={{ background: '#1877F2', filter: 'blur(30px)' }} />
                <div className="relative">
                  <div className="flex items-start justify-between mb-4">
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Vendido · Meta Ads</p>
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                      style={{ background: '#1877F2', color: '#fff' }}>f</div>
                  </div>
                  {loadingVendido ? (
                    <div className="w-4 h-4 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" />
                  ) : vendidoData?.error ? (
                    <p className="text-xs text-red-400">Erro ao carregar</p>
                  ) : (
                    <>
                      <div className="flex items-baseline gap-4">
                        <div>
                          <span className="text-4xl font-bold text-white">{vendidoData?.metaAds ?? '—'}</span>
                          <p className="text-xs mt-0.5" style={{ color: '#93c5fd' }}>origem Meta Ads</p>
                        </div>
                        {(vendidoData?.total ?? 0) > 0 && (
                          <>
                            <div className="w-px h-10 bg-gray-700" />
                            <div>
                              <span className="text-2xl font-bold text-gray-400">{vendidoData?.total}</span>
                              <p className="text-xs text-gray-500 mt-0.5">total vendido</p>
                            </div>
                          </>
                        )}
                      </div>
                      {vendidoData?.stageName && (
                        <p className="text-xs text-gray-600 mt-3 truncate">
                          {vendidoData.pipelineName} · {vendidoData.stageName}
                        </p>
                      )}
                      {vendidoData && !vendidoData.stageName && (
                        <p className="text-xs text-amber-600 mt-2">Etapa "Vendido" não encontrada</p>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* ── Funil de Conversão (independente do pipeline) ── */}
            {(() => {
              // Chats Novos — do analytics (período selecionado)
              const newChats = analyticsData?.[analyticsPeriod]?.newChats ?? 0;

              // Leads em Tratativa — todos os leads ativos (não won=142, não lost=143) de TODOS os pipelines
              let activeLeads = 0;
              if (crmData) {
                const closedIds = new Set(
                  crmData.pipelines.flatMap(p => p._embedded.statuses)
                    .filter((s: CrmStatus) => s.type === 142 || s.type === 143)
                    .map((s: CrmStatus) => s.id)
                );
                activeLeads = crmData.leads.filter((l: CrmLead) => !closedIds.has(l.status_id)).length;
              }

              // Vendas — matches ganhos no TenFront
              const sales = stats.won;

              const hasData = newChats > 0 || activeLeads > 0 || sales > 0;
              const isMock = !hasData;

              const rawFunnel = hasData
                ? [
                  { label: 'Chats Novos', value: Math.max(newChats, 1), displayValue: String(newChats), color: '#AEFF6E', labelStyle: { color: 'black', textShadow: '0 1px 3px rgba(0,0,0,0.5)' }, valueStyle: { color: 'black' }, percentageStyle: { color: 'black', backgroundColor: 'transparent', boxShadow: 'none' } },
                  { label: 'Em Tratativa', value: Math.max(activeLeads, 1), displayValue: String(activeLeads), color: '#AEFF6E', labelStyle: { color: 'black', textShadow: '0 1px 3px rgba(0,0,0,0.5)' }, valueStyle: { color: 'black' }, percentageStyle: { color: 'black', backgroundColor: 'transparent', boxShadow: 'none' } },
                  { label: 'Vendas', value: Math.max(sales, 1), displayValue: String(sales), color: '#AEFF6E', labelStyle: { color: 'black', textShadow: '0 1px 3px rgba(0,0,0,0.5)' }, valueStyle: { color: 'black' }, percentageStyle: { color: 'black', backgroundColor: 'transparent', boxShadow: 'none' } },
                ]
                : mockFunnelData;

              const maxVal = Math.max(...rawFunnel.map(d => d.value));
              const normalizedFunnel = [{ ...rawFunnel[0]!, value: maxVal }, ...rawFunnel.slice(1)];

              return (
                <div className="mt-3 sm:mt-4 bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Funil de Conversão</p>
                      <p className="text-sm font-semibold text-gray-800 mt-0.5">
                        {isMock
                          ? <span className="text-gray-300 text-xs font-normal">dados de exemplo</span>
                          : <>{newChats} chats{sales > 0 && <span className="text-xs font-normal text-green-600 ml-2">· {sales} vendidos</span>}</>}
                      </p>
                    </div>
                  </div>
                  <div style={{ height: 280, '--chart-1': '#AEFF6E', '--color-muted': 'transparent', '--chart-grid': 'rgba(0,0,0,0.06)', '--chart-foreground': '#111827', '--chart-foreground-muted': '#6B7280' } as React.CSSProperties}>
                    <FunnelChart
                      data={normalizedFunnel}
                      orientation="vertical"
                      color="#AEFF6E"
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
                    const avatarBg = isDark
                      ? { won: '#14532d', stage_moved: '#3b0764', not_found: '#422006', error: '#450a0a' }[m.action]
                      : { won: '#dcfce7', stage_moved: '#ede9fe', not_found: '#fef9c3', error: '#fee2e2' }[m.action];
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
                          <button
                            onClick={() => deleteMatch(m.id)}
                            disabled={deletingId === m.id}
                            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors disabled:opacity-40"
                            title="Excluir registro">
                            {deletingId === m.id
                              ? <span className="w-3 h-3 border border-red-400 border-t-transparent rounded-full animate-spin" />
                              : <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
                            }
                          </button>
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
                <h1 className="text-2xl sm:text-[2rem] font-bold text-gray-900 leading-tight">Inbox</h1>
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
                <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-3 text-2xl">💬</div>
                <p className="text-gray-400 text-sm font-medium">Nenhuma conversa encontrada</p>
                <p className="text-gray-300 text-xs mt-1">Verifique se o módulo de Chat está ativo no Kommo</p>
              </div>
            )}

            {!loadingChat && chatData.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {/* Header */}
                <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-900">Conversas recentes</h2>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                    style={{ background: '#EDE9FE', color: '#7C3AED' }}>{chatData.length}</span>
                </div>
                {/* List */}
                <div>
                  {chatData.map(talk => {
                    const contact = talk._embedded?.contact;
                    const name = contact?.name ?? `Lead #${talk.id}`;
                    const initial = name.charAt(0).toUpperCase();
                    const msgTs = talk.last_message?.created_at ?? talk.updated_at;
                    const msgAt = new Date(msgTs * 1000);
                    const isToday = msgAt.toDateString() === new Date().toDateString();
                    const timeStr = isToday
                      ? msgAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                      : msgAt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
                    // last_message may be an object with 'text' or 'content' depending on Kommo version
                    const lastMsgObj = talk.last_message as Record<string, unknown> | undefined;
                    const preview = (lastMsgObj?.text as string | undefined)?.trim()
                      || (lastMsgObj?.content as string | undefined)?.trim()
                      || 'Conversa ativa';
                    // origem: source_uid direto ou embedded source
                    const origin = talk.source_uid
                      || talk._embedded?.source?.name
                      || talk._embedded?.source?.type
                      || talk._embedded?.source?.external_id;

                    return (
                      <button key={talk.id} onClick={() => openTalkMessages(talk)}
                        className="w-full text-left px-4 py-3.5 flex items-start gap-3 hover:bg-gray-50 active:bg-gray-100 transition-colors border-b border-gray-50 last:border-0">
                        {/* Avatar */}
                        <div className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5"
                          style={{ background: '#EDE9FE', color: '#7C3AED' }}>
                          {initial}
                        </div>
                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-0.5">
                            <p className="text-sm font-semibold text-gray-900 truncate">{name}</p>
                            <span className="text-[11px] text-gray-400 flex-shrink-0">{timeStr}</span>
                          </div>
                          <p className="text-xs text-gray-500 truncate leading-relaxed">{preview}</p>
                          {origin && (
                            <span className="inline-block mt-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                              style={{ background: '#F0FDF4', color: '#16a34a' }}>
                              {origin}
                            </span>
                          )}
                        </div>
                      </button>
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
                  style={{ background: config.markAsWon ? '#AEFF6E' : (isDark ? '#374151' : '#E5E7EB') }}>
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

      {/* ══ MESSAGES MODAL ══ */}
      {openTalk && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
          {/* Click outside */}
          <div className="absolute inset-0" onClick={() => { setOpenTalk(null); setTalkMessages([]); }} />
          <div className="relative w-full sm:max-w-lg flex flex-col overflow-hidden"
            style={{ background: 'var(--surface)', maxHeight: '85vh', borderRadius: '1.25rem 1.25rem 0 0' }}>

            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3.5 border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                style={{ background: '#EDE9FE', color: '#7C3AED' }}>
                {(openTalk._embedded?.contact?.name ?? 'L').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                  {openTalk._embedded?.contact?.name ?? `Lead #${openTalk.id}`}
                </p>
                {openTalk.source_uid && (
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{openTalk.source_uid}</p>
                )}
              </div>
              <button onClick={() => { setOpenTalk(null); setTalkMessages([]); }}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                style={{ color: 'var(--text-muted)', background: 'var(--bg-hover)' }}>
                ✕
              </button>
            </div>

            {/* Messages list */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
              {loadingMessages && (
                <div className="flex items-center justify-center py-12">
                  <div className="w-6 h-6 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {!loadingMessages && talkMessages.length === 0 && (
                <div className="py-6 px-2">
                  <p className="text-center text-sm mb-4" style={{ color: 'var(--text-muted)' }}>Nenhuma mensagem encontrada</p>
                  {messagesRaw != null && (
                    <details className="text-[10px] rounded-xl overflow-hidden">
                      <summary className="cursor-pointer px-3 py-2 font-semibold" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                        Ver resposta bruta da API
                      </summary>
                      <pre className="p-3 overflow-auto max-h-48 leading-relaxed" style={{ background: '#0d1117', color: '#7ee787' }}>
                        {JSON.stringify(messagesRaw as object, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              )}
              {!loadingMessages && talkMessages.map((msg, i) => {
                const isClient = msg.author?.type !== 'user';
                const ts = msg.created_at
                  ? new Date(msg.created_at * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                  : '';
                return (
                  <div key={msg.id ?? i} className={`flex ${isClient ? 'justify-start' : 'justify-end'}`}>
                    <div className="max-w-[78%] px-3.5 py-2"
                      style={{
                        background: isClient ? 'var(--bubble-in)' : '#2563eb',
                        color: isClient ? 'var(--text-primary)' : '#fff',
                        borderRadius: isClient ? '4px 18px 18px 18px' : '18px 4px 18px 18px',
                      }}>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.text || '—'}</p>
                      {ts && <p className="text-[10px] mt-1 opacity-60 text-right">{ts}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

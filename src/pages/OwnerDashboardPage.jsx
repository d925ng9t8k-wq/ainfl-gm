import React, { useState, useEffect, useCallback } from 'react';

// --- Static Data ---
const BUSINESS_UNITS = [
  { id: 'ainflgm', name: 'AiNFL GM', url: 'ainflgm.com', status: 'live', desc: 'NFL offseason simulator', color: '#FB4F14' },
  { id: 'trader9', name: 'Trader9', url: 'trader9.io', status: 'building', desc: 'AI trading signals', color: '#00F0FF' },
  { id: 'freeagent9', name: 'FreeAgent9', url: 'freeagent9.com', status: 'concept', desc: 'AI talent marketplace', color: '#C300FF' },
  { id: 'agent9', name: 'Agent9', url: 'agent9.dev', status: 'building', desc: 'Autonomous agent platform', color: '#39FF14' },
  { id: 'underwriter9', name: 'Underwriter9', url: 'underwriter9.com', status: 'concept', desc: 'AI mortgage underwriting', color: '#FFD700' },
  { id: 'x9', name: 'X9', url: 'x9.ai', status: 'concept', desc: 'Holding company / umbrella', color: '#FF2D55' },
];

const SERVICE_LIST = [
  { id: 'hub', name: 'Comms Hub', port: 3457, desc: 'Message relay + autonomy' },
  { id: 'voice', name: 'Voice Server', port: 3456, desc: 'Twilio voice calls' },
  { id: 'tunnel', name: 'CF Tunnel', port: null, desc: 'Cloudflare tunnel' },
  { id: 'pilot', name: 'Pilot', port: null, desc: 'Claude Code terminal' },
  { id: 'underwriter', name: 'Underwriter', port: null, desc: 'Loan processing AI' },
  { id: 'cloudworker', name: 'Cloud Worker', port: null, desc: 'Cloudflare always-on' },
];

// --- Styles ---
const S = {
  page: {
    maxWidth: 1100,
    margin: '0 auto',
    padding: '24px 16px 80px',
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 28,
    flexWrap: 'wrap',
    gap: 12,
  },
  title: {
    fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
    fontSize: 28,
    fontWeight: 800,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    background: 'linear-gradient(135deg, #00F0FF 0%, #80F8FF 40%, #E2E8F0 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    filter: 'drop-shadow(0 0 12px rgba(0,240,255,0.4))',
    margin: 0,
  },
  subtitle: {
    color: '#94A3B8',
    fontSize: 12,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    fontFamily: "'Oswald', sans-serif",
    marginTop: 2,
  },
  refreshBtn: {
    background: 'rgba(0,240,255,0.08)',
    border: '1px solid rgba(0,240,255,0.2)',
    borderRadius: 8,
    color: '#00F0FF',
    padding: '8px 16px',
    fontSize: 12,
    fontWeight: 600,
    fontFamily: "'Oswald', sans-serif",
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    cursor: 'pointer',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: 20,
    marginBottom: 24,
  },
  card: {
    background: 'rgba(30, 41, 59, 0.7)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: '1px solid rgba(0, 240, 255, 0.18)',
    borderRadius: 12,
    padding: '20px 22px',
    position: 'relative',
    overflow: 'hidden',
  },
  cardTitle: {
    fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: '#00F0FF',
    marginBottom: 14,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: '#E2E8F0',
    marginBottom: 14,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  dot: (color) => ({
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: color,
    boxShadow: `0 0 8px ${color}80`,
    display: 'inline-block',
    flexShrink: 0,
  }),
  badge: (bg, color) => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 700,
    fontFamily: "'Oswald', sans-serif",
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    background: bg,
    color: color,
  }),
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 0',
    borderBottom: '1px solid rgba(0,240,255,0.06)',
    fontSize: 13,
  },
  label: {
    color: '#94A3B8',
    fontSize: 12,
  },
  value: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: 600,
  },
  mono: {
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    fontSize: 11,
    color: '#94A3B8',
  },
  progressBar: () => ({
    width: '100%',
    height: 6,
    background: 'rgba(0,240,255,0.06)',
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 6,
  }),
  progressFill: (pct, color) => ({
    width: `${Math.min(pct, 100)}%`,
    height: '100%',
    background: `linear-gradient(90deg, ${color}, ${color}cc)`,
    borderRadius: 3,
    transition: 'width 0.5s ease',
    boxShadow: `0 0 8px ${color}40`,
  }),
};

const statusBadge = (status) => {
  const map = {
    live: { bg: 'rgba(57,255,20,0.15)', color: '#39FF14' },
    building: { bg: 'rgba(0,240,255,0.15)', color: '#00F0FF' },
    concept: { bg: 'rgba(148,163,184,0.15)', color: '#94A3B8' },
    online: { bg: 'rgba(57,255,20,0.15)', color: '#39FF14' },
    offline: { bg: 'rgba(255,45,85,0.15)', color: '#FF2D55' },
    unknown: { bg: 'rgba(148,163,184,0.15)', color: '#94A3B8' },
  };
  const m = map[status] || map.unknown;
  return S.badge(m.bg, m.color);
};

const statusDot = (status) => {
  const map = { live: '#39FF14', building: '#00F0FF', concept: '#94A3B8', online: '#39FF14', offline: '#FF2D55', unknown: '#94A3B8' };
  return map[status] || map.unknown;
};

function formatTime(ts) {
  if (!ts) return '--';
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function OwnerDashboardPage() {
  const [hubHealth, setHubHealth] = useState(null);
  const [sharedState, setSharedState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      fetch('http://localhost:3457/health').then(r => r.json()),
      fetch('http://localhost:3457/state').then(r => r.json()),
    ]);
    setHubHealth(results[0].status === 'fulfilled' ? results[0].value : null);
    setSharedState(results[1].status === 'fulfilled' ? results[1].value : null);
    setLastRefresh(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const hubOnline = !!hubHealth;
  const messages = sharedState?.recentMessages || sharedState?.messages || [];
  const lastMessages = messages.slice(-20).reverse();
  const context = sharedState?.context || sharedState?.currentContext || '';
  const sprint = sharedState?.sprint || null;

  // Derive service statuses from hub health
  const serviceStatuses = SERVICE_LIST.map(svc => {
    if (svc.id === 'hub') return { ...svc, status: hubOnline ? 'online' : 'offline' };
    if (svc.id === 'voice') {
      const voiceOk = hubHealth?.voice === true || hubHealth?.voiceServer === true || hubHealth?.services?.voice === 'ok';
      return { ...svc, status: hubOnline && voiceOk ? 'online' : hubOnline ? 'unknown' : 'offline' };
    }
    if (svc.id === 'tunnel') {
      const tunnelOk = hubHealth?.tunnel === true || hubHealth?.services?.tunnel === 'ok';
      return { ...svc, status: hubOnline && tunnelOk ? 'online' : hubOnline ? 'unknown' : 'offline' };
    }
    if (svc.id === 'pilot') {
      const terminalActive = hubHealth?.terminal === true || hubHealth?.terminalActive === true || hubHealth?.mode === 'relay';
      return { ...svc, status: hubOnline && terminalActive ? 'online' : hubOnline ? 'offline' : 'offline' };
    }
    if (svc.id === 'cloudworker') {
      const cwOk = hubHealth?.cloudWorker === true || hubHealth?.services?.cloudWorker === 'ok';
      return { ...svc, status: hubOnline && cwOk ? 'online' : 'unknown' };
    }
    return { ...svc, status: 'unknown' };
  });

  const onlineCount = serviceStatuses.filter(s => s.status === 'online').length;

  // Spending (static placeholder - these would come from real API billing)
  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const spendingData = {
    dailyEstimate: hubHealth?.dailyCost || sharedState?.spending?.daily || '--',
    monthTotal: hubHealth?.monthlyCost || sharedState?.spending?.month || '--',
    apiCalls: hubHealth?.apiCalls || sharedState?.spending?.apiCalls || '--',
  };

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div>
          <h1 style={S.title}>Owner Dashboard</h1>
          <div style={S.subtitle}>
            9 Enterprises --- {today} --- {lastRefresh ? formatTime(lastRefresh) : 'loading...'}
          </div>
        </div>
        <button style={S.refreshBtn} onClick={fetchData} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Top Row: Sprint + Spending + Service Health */}
      <div style={S.grid}>

        {/* Sprint Status */}
        <div style={S.card}>
          <div style={S.cardTitle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00F0FF" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            Sprint Status
          </div>
          {sprint ? (
            <>
              <div style={{ ...S.row, borderBottom: 'none' }}>
                <span style={S.label}>Sprint</span>
                <span style={S.value}>{sprint.name || sprint.id || 'Current'}</span>
              </div>
              <div style={S.row}>
                <span style={S.label}>Progress</span>
                <span style={S.value}>{sprint.progress || 0}%</span>
              </div>
              <div style={S.progressBar(sprint.progress || 0, '#00F0FF')}>
                <div style={S.progressFill(sprint.progress || 0, '#00F0FF')} />
              </div>
              <div style={{ ...S.row, marginTop: 8 }}>
                <span style={S.label}>Active Agents</span>
                <span style={S.value}>{sprint.agents || '--'}</span>
              </div>
            </>
          ) : (
            <>
              <div style={{ ...S.row, borderBottom: 'none' }}>
                <span style={S.label}>Current Focus</span>
                <span style={{ ...S.value, fontSize: 12, maxWidth: 200, textAlign: 'right' }}>{context || 'No context set'}</span>
              </div>
              <div style={S.row}>
                <span style={S.label}>Hub Mode</span>
                <span style={S.value}>{hubHealth?.mode || (hubOnline ? 'active' : 'offline')}</span>
              </div>
              <div style={S.row}>
                <span style={S.label}>Terminal</span>
                <span style={{
                  ...S.value,
                  color: hubHealth?.mode === 'relay' || hubHealth?.terminalActive ? '#39FF14' : '#FF2D55',
                }}>
                  {hubHealth?.mode === 'relay' || hubHealth?.terminalActive ? 'Connected' : 'Disconnected'}
                </span>
              </div>
              <div style={{ ...S.row, borderBottom: 'none' }}>
                <span style={S.label}>Uptime</span>
                <span style={S.value}>{hubHealth?.uptime ? `${Math.floor(hubHealth.uptime / 3600)}h ${Math.floor((hubHealth.uptime % 3600) / 60)}m` : '--'}</span>
              </div>
            </>
          )}
        </div>

        {/* Spending Report */}
        <div style={S.card}>
          <div style={S.cardTitle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00F0FF" strokeWidth="2"><rect x="2" y="3" width="20" height="18" rx="3"/><path d="M12 7v10M8 9.5c0-1.1.9-2 2-2h2.5c1.1 0 2 .9 2 2s-.9 2-2 2H10c-1.1 0-2 .9-2 2s.9 2 2 2h2.5c1.1 0 2-.9 2-2"/></svg>
            Spending Report
          </div>
          <div style={S.row}>
            <span style={S.label}>Today Estimate</span>
            <span style={{ ...S.value, color: '#FFD700' }}>{typeof spendingData.dailyEstimate === 'number' ? `$${spendingData.dailyEstimate.toFixed(2)}` : spendingData.dailyEstimate}</span>
          </div>
          <div style={S.row}>
            <span style={S.label}>Month Total</span>
            <span style={{ ...S.value, color: '#FFD700' }}>{typeof spendingData.monthTotal === 'number' ? `$${spendingData.monthTotal.toFixed(2)}` : spendingData.monthTotal}</span>
          </div>
          <div style={S.row}>
            <span style={S.label}>API Calls</span>
            <span style={S.value}>{spendingData.apiCalls}</span>
          </div>
          <div style={{ ...S.row, borderBottom: 'none' }}>
            <span style={S.label}>Billing</span>
            <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener noreferrer" style={{ color: '#00F0FF', fontSize: 12, textDecoration: 'none' }}>
              Anthropic Console
            </a>
          </div>
        </div>

        {/* Service Health */}
        <div style={S.card}>
          <div style={S.cardTitle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00F0FF" strokeWidth="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
            Service Health
            <span style={{ ...S.badge('rgba(0,240,255,0.1)', '#00F0FF'), marginLeft: 'auto' }}>{onlineCount}/{serviceStatuses.length}</span>
          </div>
          {serviceStatuses.map(svc => (
            <div key={svc.id} style={{ ...S.row, gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                <div style={S.dot(statusDot(svc.status))} />
                <span style={{ color: '#E2E8F0', fontSize: 12, fontWeight: 600 }}>{svc.name}</span>
                {svc.port && <span style={S.mono}>:{svc.port}</span>}
              </div>
              <span style={statusBadge(svc.status)}>{svc.status}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Business Units */}
      <div style={{ marginBottom: 24 }}>
        <div style={S.sectionTitle}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00F0FF" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
          Business Units
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
          {BUSINESS_UNITS.map(biz => (
            <div key={biz.id} style={{
              ...S.card,
              padding: '14px 16px',
              borderColor: `${biz.color}30`,
              cursor: 'default',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{
                  fontFamily: "'Oswald', sans-serif",
                  fontSize: 14,
                  fontWeight: 700,
                  color: biz.color,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}>{biz.name}</span>
                <div style={S.dot(statusDot(biz.status))} />
              </div>
              <div style={{ color: '#94A3B8', fontSize: 11, marginBottom: 4 }}>{biz.desc}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={S.mono}>{biz.url}</span>
                <span style={statusBadge(biz.status)}>{biz.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Row: Recent Activity + Communication Log */}
      <div style={{ ...S.grid, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>

        {/* Recent Activity */}
        <div style={S.card}>
          <div style={S.cardTitle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00F0FF" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Recent Activity
          </div>
          {sharedState?.recentActivity && sharedState.recentActivity.length > 0 ? (
            sharedState.recentActivity.slice(0, 10).map((act, i) => (
              <div key={i} style={{ ...S.row, gap: 8 }}>
                <span style={{ color: '#E2E8F0', fontSize: 12, flex: 1 }}>{act.action || act.message || act}</span>
                <span style={S.mono}>{formatTime(act.timestamp || act.ts)}</span>
              </div>
            ))
          ) : (
            <div style={{ color: '#475569', fontSize: 12, padding: '16px 0', textAlign: 'center' }}>
              {hubOnline ? 'No recent activity recorded' : 'Hub offline -- cannot fetch activity'}
            </div>
          )}
        </div>

        {/* Communication Log */}
        <div style={S.card}>
          <div style={S.cardTitle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00F0FF" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Communication Log
            {lastMessages.length > 0 && <span style={{ ...S.badge('rgba(0,240,255,0.1)', '#00F0FF'), marginLeft: 'auto' }}>{lastMessages.length}</span>}
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {lastMessages.length > 0 ? (
              lastMessages.map((msg, i) => {
                const text = typeof msg === 'string' ? msg : (msg.text || msg.message || msg.content || JSON.stringify(msg));
                const channel = msg.channel || msg.source || '';
                const ts = msg.timestamp || msg.ts || msg.date || null;
                const from = msg.from || msg.sender || '';
                return (
                  <div key={i} style={{
                    padding: '8px 0',
                    borderBottom: '1px solid rgba(0,240,255,0.06)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      {channel && <span style={S.badge(
                        channel === 'telegram' ? 'rgba(0,136,204,0.2)' : channel === 'imessage' ? 'rgba(57,255,20,0.15)' : 'rgba(148,163,184,0.15)',
                        channel === 'telegram' ? '#0088CC' : channel === 'imessage' ? '#39FF14' : '#94A3B8',
                      )}>{channel}</span>}
                      {from && <span style={{ color: '#94A3B8', fontSize: 10 }}>{from}</span>}
                      <span style={{ ...S.mono, marginLeft: 'auto' }}>{formatTime(ts)}</span>
                    </div>
                    <div style={{ color: '#CBD5E1', fontSize: 12, lineHeight: 1.5, wordBreak: 'break-word' }}>{text}</div>
                  </div>
                );
              })
            ) : (
              <div style={{ color: '#475569', fontSize: 12, padding: '16px 0', textAlign: 'center' }}>
                {hubOnline ? 'No recent messages' : 'Hub offline -- cannot fetch messages'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ textAlign: 'center', marginTop: 32, color: '#334155', fontSize: 10 }}>
        Owner Dashboard --- Private --- Not indexed
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { useMLBGame, getServiceStatus } from '../../context/MLBGameContext';
import { CBT_THRESHOLDS } from '../../data/mlb/mlbTeams';

const POSITIONS = ['All', 'SP', 'RP', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];

const POS_COLORS = {
  SP: '#FB4F14', RP: '#f59e0b', C: '#10b981', '1B': '#3b82f6', '2B': '#8b5cf6',
  '3B': '#ec4899', SS: '#06b6d4', LF: '#84cc16', CF: '#14b8a6', RF: '#f97316', DH: '#94a3b8',
};

function getPosColor(pos) {
  return POS_COLORS[pos] || '#64748b';
}

function ServiceBadge({ serviceTime }) {
  const status = getServiceStatus(serviceTime);
  let color = '#4ade80';
  if (status === 'Pre-Arb') color = '#60a5fa';
  else if (status.startsWith('Arb')) color = '#facc15';
  return (
    <span style={{
      display: 'inline-block',
      background: color + '22',
      border: `1px solid ${color}44`,
      color,
      padding: '1px 6px',
      borderRadius: 4,
      fontSize: 10,
      fontWeight: 700,
      whiteSpace: 'nowrap',
    }}>{status}</span>
  );
}

function RatingBar({ rating }) {
  const color = rating >= 88 ? '#fbbf24' : rating >= 78 ? '#4ade80' : rating >= 68 ? '#60a5fa' : '#94a3b8';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 48, height: 5, background: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${rating}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ color, fontSize: 12, fontWeight: 700, minWidth: 24 }}>{rating}</span>
    </div>
  );
}

export default function MLBRosterPage() {
  const { roster, payroll, cbt, releasePlayer, currentTeamAbbr, allTeams } = useMLBGame();
  const [filterPos, setFilterPos] = useState('All');
  const [sortKey, setSortKey] = useState('salary');
  const [sortDir, setSortDir] = useState('desc');
  const [search, setSearch] = useState('');
  const [confirmRelease, setConfirmRelease] = useState(null);

  const team = allTeams.find(t => t.abbreviation === currentTeamAbbr);
  const filtered = roster
    .filter(p => filterPos === 'All' || p.position === filterPos)
    .filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()));

  const sorted = [...filtered].sort((a, b) => {
    let av = a[sortKey], bv = b[sortKey];
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  const sortHeaderRenderer = (label, field) => {
    const active = sortKey === field;
    return (
      <th
        key={field}
        onClick={() => handleSort(field)}
        style={{ padding: '8px 12px', textAlign: 'left', cursor: 'pointer', whiteSpace: 'nowrap',
          color: active ? '#E2E8F0' : '#94A3B8', fontWeight: active ? 700 : 500, fontSize: 12,
          userSelect: 'none', background: active ? 'rgba(0,200,83,0.05)' : 'transparent' }}>
        {label} {active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
      </th>
    );
  };

  const spCount = roster.filter(p => p.position === 'SP').length;
  const rpCount = roster.filter(p => p.position === 'RP').length;
  const posCount = roster.filter(p => !['SP','RP'].includes(p.position)).length;

  return (
    <div style={{ color: '#E2E8F0' }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: '0 0 4px', fontFamily: "'Oswald', sans-serif", fontSize: 22, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {team?.city} {team?.name} Roster
        </h2>
        <div style={{ color: '#94A3B8', fontSize: 13 }}>{team?.division} &bull; {roster.length} players</div>
      </div>

      {/* Payroll Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 18 }}>
        <div style={{ background: 'rgba(0,200,83,0.07)', border: '1px solid rgba(0,200,83,0.2)', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ color: '#94A3B8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total Payroll</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#E2E8F0', marginTop: 4 }}>${payroll.toFixed(1)}M</div>
        </div>
        <div style={{ background: cbt.tier > 0 ? 'rgba(255,107,53,0.07)' : 'rgba(0,200,83,0.07)', border: `1px solid ${cbt.color}44`, borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ color: '#94A3B8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>CBT Threshold</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: cbt.color, marginTop: 4 }}>${CBT_THRESHOLDS.first}M</div>
          <div style={{ fontSize: 11, color: cbt.tier > 0 ? cbt.color : '#4ade80', marginTop: 2 }}>{cbt.label}</div>
        </div>
        <div style={{ background: 'rgba(30,41,59,0.5)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ color: '#94A3B8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pitching Staff</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#E2E8F0', marginTop: 4 }}>{spCount} SP / {rpCount} RP</div>
        </div>
        <div style={{ background: 'rgba(30,41,59,0.5)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ color: '#94A3B8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Position Players</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#E2E8F0', marginTop: 4 }}>{posCount} players</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search players..."
          style={{ background: 'rgba(30,41,59,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '6px 12px', color: '#E2E8F0', fontSize: 13, width: 180 }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {POSITIONS.map(pos => (
            <button
              key={pos}
              onClick={() => setFilterPos(pos)}
              style={{
                background: filterPos === pos ? 'rgba(0,200,83,0.2)' : 'rgba(30,41,59,0.6)',
                border: `1px solid ${filterPos === pos ? 'rgba(0,200,83,0.5)' : 'rgba(255,255,255,0.1)'}`,
                color: filterPos === pos ? '#00C853' : '#94A3B8',
                borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontWeight: filterPos === pos ? 700 : 400,
              }}
            >{pos}</button>
          ))}
        </div>
      </div>

      {/* Roster Table */}
      <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'rgba(30,41,59,0.8)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              {sortHeaderRenderer("Player", "name")}
              {sortHeaderRenderer("Pos", "position")}
              {sortHeaderRenderer("Age", "age")}
              {sortHeaderRenderer("Salary (AAV)", "salary")}
              {sortHeaderRenderer("Yrs Left", "contractYears")}
              {sortHeaderRenderer("Status", "serviceTime")}
              {sortHeaderRenderer("Rating", "rating")}
              <th style={{ padding: '8px 12px', fontSize: 12, color: '#94A3B8', fontWeight: 500 }}>Notes</th>
              <th style={{ padding: '8px 12px', fontSize: 12, color: '#94A3B8', fontWeight: 500 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => (
              <tr key={p.id}
                style={{
                  background: i % 2 === 0 ? 'rgba(15,23,42,0.4)' : 'rgba(30,41,59,0.3)',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  transition: 'background 0.15s',
                }}>
                <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 3, height: 28, borderRadius: 2, background: getPosColor(p.position), flexShrink: 0 }} />
                    <div>
                      <div style={{ color: '#E2E8F0' }}>{p.name}</div>
                      {p.isNewSigning && <div style={{ fontSize: 9, color: '#00C853', fontWeight: 700, letterSpacing: '0.06em' }}>NEW SIGNING</div>}
                      {p.status === 'il' && <div style={{ fontSize: 9, color: '#ef4444', fontWeight: 700, letterSpacing: '0.06em' }}>IL</div>}
                    </div>
                  </div>
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{ background: getPosColor(p.position) + '22', color: getPosColor(p.position), padding: '2px 7px', borderRadius: 4, fontSize: 11, fontWeight: 700 }}>
                    {p.position}
                  </span>
                </td>
                <td style={{ padding: '10px 12px', color: '#94A3B8' }}>{p.age}</td>
                <td style={{ padding: '10px 12px', fontWeight: 700, color: p.salary >= 25 ? '#fbbf24' : p.salary >= 10 ? '#E2E8F0' : '#4ade80' }}>
                  ${p.salary.toFixed(1)}M
                </td>
                <td style={{ padding: '10px 12px', color: '#94A3B8' }}>
                  {p.contractYears}yr{p.contractYears !== 1 ? 's' : ''}
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <ServiceBadge serviceTime={p.serviceTime} />
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <RatingBar rating={p.rating} />
                </td>
                <td style={{ padding: '10px 12px', color: '#64748b', fontSize: 11, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.notes || '—'}
                </td>
                <td style={{ padding: '10px 12px' }}>
                  {confirmRelease === p.id ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => { releasePlayer(p.id); setConfirmRelease(null); }}
                        style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 4, padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}>
                        Confirm
                      </button>
                      <button onClick={() => setConfirmRelease(null)}
                        style={{ background: 'rgba(100,116,139,0.2)', border: '1px solid #475569', color: '#94A3B8', borderRadius: 4, padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmRelease(p.id)}
                      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', borderRadius: 4, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}>
                      Release
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', color: '#475569' }}>No players match this filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

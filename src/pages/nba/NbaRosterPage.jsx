import React, { useState } from 'react';
import { useNbaGame } from '../../context/NbaGameContext';

const POSITIONS = ['All', 'PG', 'SG', 'SF', 'PF', 'C'];

const POS_COLORS = {
  PG: '#00F0FF', SG: '#FFA500', SF: '#10b981', PF: '#8b5cf6', C: '#ec4899',
};

function posGroup(pos) {
  if (['PG'].includes(pos)) return 'PG';
  if (['SG', 'G', 'SG/SF'].includes(pos)) return 'SG';
  if (['SF', 'F', 'SF/PF'].includes(pos)) return 'SF';
  if (['PF', 'F/C'].includes(pos)) return 'PF';
  if (['C'].includes(pos)) return 'C';
  return pos;
}

function RatingBadge({ rating }) {
  const color = rating >= 90 ? '#FFD700' : rating >= 80 ? '#10b981' : rating >= 70 ? '#FFA500' : '#94A3B8';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 7px', borderRadius: 5, fontSize: 11, fontWeight: 700,
      background: `${color}22`, border: `1px solid ${color}66`, color,
    }}>{rating}</span>
  );
}

function ContractBadge({ type }) {
  const colors = {
    max: '#FFD700', supermax: '#FF6B00', mid: '#10b981', 'vet-min': '#94A3B8',
    rookie: '#00F0FF', 'two-way': '#8b5cf6',
  };
  const color = colors[type] || '#94A3B8';
  return (
    <span style={{
      display: 'inline-block', padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
      background: `${color}15`, border: `1px solid ${color}44`, color,
      textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>{type}</span>
  );
}

export default function NbaRosterPage() {
  const {
    roster, cutPlayer, extendPlayer, capUsed, totalCap, capAvailable,
    luxuryTax, overLuxuryTax, tradeHistory, cutPlayers, allTeams, currentTeamAbbr,
  } = useNbaGame();

  const [filterPos, setFilterPos] = useState('All');
  const [sortKey, setSortKey] = useState('capHit');
  const [sortDir, setSortDir] = useState('desc');
  const [confirmCut, setConfirmCut] = useState(null);
  const [extendingPlayer, setExtendingPlayer] = useState(null);
  const [extendYears, setExtendYears] = useState(3);
  const [extendAAV, setExtendAAV] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [welcomeDismissed, setWelcomeDismissed] = useState(() => {
    try { return localStorage.getItem('ainbagm_welcome_dismissed') === '1'; } catch { return false; }
  });

  const currentTeamObj = allTeams.find(t => t.abbreviation === currentTeamAbbr);
  const cutCount = (tradeHistory || []).filter(t => t.type === 'cut').length;
  const extensionCount = (tradeHistory || []).filter(t => t.type === 'extension').length;
  const deadCapTotal = (cutPlayers || []).reduce((sum, p) => sum + (p.deadCap || 0), 0);

  const filtered = roster
    .filter(p => !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .filter(p => filterPos === 'All' || posGroup(p.position) === filterPos);

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

  function SortHeader({ label, k }) {
    const active = sortKey === k;
    return (
      <th
        onClick={() => handleSort(k)}
        style={{ cursor: 'pointer', color: active ? '#FFA500' : '#94A3B8', padding: '8px 6px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap', userSelect: 'none' }}
      >
        {label} {active ? (sortDir === 'asc' ? '↑' : '↓') : ''}
      </th>
    );
  }

  const capPct = Math.min((capUsed / totalCap) * 100, 100);
  const taxPct = Math.min((capUsed / luxuryTax) * 100, 100);
  const totalSalary = roster.reduce((s, p) => s + p.capHit, 0);
  const overTax = totalSalary > luxuryTax;

  return (
    <div>
      {/* Welcome card */}
      {!welcomeDismissed && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(255,160,0,0.12), rgba(255,107,0,0.06))',
          border: '1px solid rgba(255,160,0,0.25)', borderRadius: 12, padding: 18, marginBottom: 20,
          position: 'relative',
        }}>
          <button onClick={() => { setWelcomeDismissed(true); try { localStorage.setItem('ainbagm_welcome_dismissed', '1'); } catch {} }} style={{ position: 'absolute', top: 10, right: 12, background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', fontSize: 18 }}>
            &times;
          </button>
          <div style={{ fontWeight: 800, fontSize: 16, color: '#FFA500', fontFamily: "'Oswald', sans-serif", letterSpacing: '0.06em', marginBottom: 6 }}>
            Welcome to AiNBA GM
          </div>
          <div style={{ fontSize: 13, color: '#CBD5E1', lineHeight: 1.6 }}>
            You are the General Manager of the <strong style={{ color: '#FFA500' }}>{currentTeamObj?.city} {currentTeamObj?.name}</strong>. Build your roster, manage the salary cap, sign free agents, make trades, and run the NBA Draft. The salary cap is <strong>${totalCap.toFixed(1)}M</strong> — luxury tax kicks in at <strong>${luxuryTax.toFixed(1)}M</strong>.
          </div>
        </div>
      )}

      {/* Cap summary row */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        {[
          { label: 'Total Salary', value: `$${totalSalary.toFixed(1)}M`, color: overTax ? '#FF6B00' : '#FFA500' },
          { label: 'Cap Space', value: `$${capAvailable.toFixed(1)}M`, color: capAvailable < 0 ? '#FF2D55' : '#39FF14' },
          { label: 'Luxury Tax Overage', value: overTax ? `+$${(totalSalary - luxuryTax).toFixed(1)}M` : 'Under Tax', color: overTax ? '#FF6B00' : '#64748B' },
          { label: 'Roster Size', value: roster.length, color: roster.length < 13 ? '#FF2D55' : '#94A3B8' },
          { label: 'Roster Moves', value: cutCount + extensionCount, color: '#64748B' },
        ].map(item => (
          <div key={item.label} style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: '8px 14px', minWidth: 110 }}>
            <div style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{item.label}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: item.color, fontFamily: "'Oswald', sans-serif" }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* Filter + search */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search player..."
          style={{ background: 'rgba(30,41,59,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '6px 10px', color: '#E2E8F0', fontSize: 13, outline: 'none', width: 160 }}
        />
        {POSITIONS.map(pos => (
          <button
            key={pos}
            onClick={() => setFilterPos(pos)}
            style={{
              padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              background: filterPos === pos ? `${POS_COLORS[pos] || '#FFA500'}22` : 'rgba(30,41,59,0.5)',
              border: filterPos === pos ? `1px solid ${POS_COLORS[pos] || '#FFA500'}66` : '1px solid rgba(255,255,255,0.08)',
              color: filterPos === pos ? (POS_COLORS[pos] || '#FFA500') : '#94A3B8',
            }}
          >
            {pos}
          </button>
        ))}
      </div>

      {/* Roster table */}
      <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: 'rgba(15,23,42,0.8)' }}>
            <tr>
              <SortHeader label="Player" k="name" />
              <SortHeader label="Pos" k="position" />
              <SortHeader label="Age" k="age" />
              <SortHeader label="Rating" k="rating" />
              <SortHeader label="Salary" k="capHit" />
              <SortHeader label="Yrs Left" k="yearsRemaining" />
              <th style={{ color: '#94A3B8', padding: '8px 6px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Contract</th>
              <th style={{ color: '#94A3B8', padding: '8px 6px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((player, idx) => {
              const pcolor = POS_COLORS[posGroup(player.position)] || '#94A3B8';
              return (
                <tr key={player.id} style={{
                  background: idx % 2 === 0 ? 'rgba(15,23,42,0.3)' : 'transparent',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  transition: 'background 0.15s',
                }}>
                  <td style={{ padding: '8px 8px', fontWeight: 600, color: '#E2E8F0', whiteSpace: 'nowrap' }}>
                    {player.name}
                    {player.birdRights && <span style={{ marginLeft: 6, fontSize: 9, color: '#10b981', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 3, padding: '1px 4px' }}>BIRD</span>}
                  </td>
                  <td style={{ padding: '8px 6px' }}>
                    <span style={{ color: pcolor, fontWeight: 700, fontSize: 12 }}>{player.position}</span>
                  </td>
                  <td style={{ padding: '8px 6px', color: '#94A3B8' }}>{player.age}</td>
                  <td style={{ padding: '8px 6px' }}><RatingBadge rating={player.rating || 70} /></td>
                  <td style={{ padding: '8px 6px', color: '#FFA500', fontWeight: 700 }}>${player.capHit.toFixed(1)}M</td>
                  <td style={{ padding: '8px 6px', color: '#94A3B8' }}>
                    {player.yearsRemaining === 0 ? <span style={{ color: '#FF2D55' }}>Expiring</span> : `${player.yearsRemaining}yr`}
                  </td>
                  <td style={{ padding: '8px 6px' }}><ContractBadge type={player.contractType || 'mid'} /></td>
                  <td style={{ padding: '8px 4px' }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        onClick={() => { setExtendingPlayer(player); setExtendAAV(player.capHit.toFixed(1)); setExtendYears(3); }}
                        style={{ padding: '3px 8px', background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 4, color: '#10b981', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                      >
                        Extend
                      </button>
                      <button
                        onClick={() => setConfirmCut(player)}
                        style={{ padding: '3px 8px', background: 'rgba(255,45,85,0.1)', border: '1px solid rgba(255,45,85,0.25)', borderRadius: 4, color: '#ff4466', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                      >
                        Waive
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#475569' }}>No players match filter</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Dead cap from buyouts */}
      {cutPlayers.length > 0 && (
        <div style={{ marginTop: 16, background: 'rgba(255,45,85,0.06)', border: '1px solid rgba(255,45,85,0.15)', borderRadius: 8, padding: '10px 14px' }}>
          <div style={{ fontSize: 12, color: '#ff4466', fontWeight: 700, marginBottom: 6 }}>Buyout Penalties (Dead Cap): ${deadCapTotal.toFixed(1)}M</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {cutPlayers.map(p => (
              <span key={p.id + '-cut'} style={{ fontSize: 11, color: '#94A3B8', background: 'rgba(30,41,59,0.5)', borderRadius: 4, padding: '2px 8px' }}>
                {p.name}: ${(p.deadCap || 0).toFixed(1)}M dead
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Confirm Waive Modal */}
      {confirmCut && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#0F172A', border: '1px solid rgba(255,45,85,0.3)', borderRadius: 12, padding: 24, maxWidth: 360, width: '90%' }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#ff4466', marginBottom: 8, fontFamily: "'Oswald', sans-serif" }}>Waive / Buy Out Player</div>
            <div style={{ fontSize: 13, color: '#CBD5E1', marginBottom: 16, lineHeight: 1.6 }}>
              Waive <strong style={{ color: '#FFA500' }}>{confirmCut.name}</strong> (${confirmCut.capHit.toFixed(1)}M/yr)?<br/>
              Buyout dead cap: ~<strong style={{ color: '#FF6B00' }}>${(confirmCut.capHit * 0.33).toFixed(1)}M</strong><br/>
              Cap savings: <strong style={{ color: '#10b981' }}>${(confirmCut.capHit * 0.67).toFixed(1)}M</strong>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { cutPlayer(confirmCut.id); setConfirmCut(null); }}
                style={{ flex: 1, padding: '8px 16px', background: 'rgba(255,45,85,0.2)', border: '1px solid rgba(255,45,85,0.4)', borderRadius: 6, color: '#ff4466', fontWeight: 700, cursor: 'pointer' }}>
                Confirm Waiver
              </button>
              <button onClick={() => setConfirmCut(null)}
                style={{ flex: 1, padding: '8px 16px', background: 'rgba(30,41,59,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#94A3B8', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Extension Modal */}
      {extendingPlayer && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#0F172A', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 12, padding: 24, maxWidth: 380, width: '90%' }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#10b981', marginBottom: 8, fontFamily: "'Oswald', sans-serif" }}>Extend Contract</div>
            <div style={{ fontSize: 13, color: '#CBD5E1', marginBottom: 16 }}>
              Extend <strong style={{ color: '#FFA500' }}>{extendingPlayer.name}</strong> (currently ${extendingPlayer.capHit.toFixed(1)}M/yr)
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 11, color: '#64748B', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Years</label>
                <select value={extendYears} onChange={e => setExtendYears(Number(e.target.value))}
                  style={{ width: '100%', background: 'rgba(30,41,59,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '6px 8px', color: '#E2E8F0', fontSize: 13, outline: 'none' }}>
                  {[1,2,3,4,5].map(y => <option key={y} value={y}>{y} Year{y > 1 ? 's' : ''}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 11, color: '#64748B', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>AAV ($M)</label>
                <input
                  type="number" value={extendAAV} onChange={e => setExtendAAV(e.target.value)}
                  min={3} max={55} step={0.5}
                  style={{ width: '100%', background: 'rgba(30,41,59,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '6px 8px', color: '#E2E8F0', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            </div>
            <div style={{ fontSize: 12, color: '#64748B', marginBottom: 14 }}>
              Total value: <strong style={{ color: '#FFA500' }}>${(extendYears * parseFloat(extendAAV || 0)).toFixed(1)}M</strong> over {extendYears} years
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { extendPlayer(extendingPlayer.id, extendYears, parseFloat(extendAAV)); setExtendingPlayer(null); }}
                style={{ flex: 1, padding: '8px 16px', background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.4)', borderRadius: 6, color: '#10b981', fontWeight: 700, cursor: 'pointer' }}>
                Sign Extension
              </button>
              <button onClick={() => setExtendingPlayer(null)}
                style={{ flex: 1, padding: '8px 16px', background: 'rgba(30,41,59,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#94A3B8', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

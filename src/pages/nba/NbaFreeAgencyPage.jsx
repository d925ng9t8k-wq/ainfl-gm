import React, { useState, useMemo } from 'react';
import { useNbaGame } from '../../context/NbaGameContext';

const POSITIONS = ['All', 'PG', 'SG', 'SF', 'PF', 'C'];
const POS_COLORS = { PG: '#00F0FF', SG: '#FFA500', SF: '#10b981', PF: '#8b5cf6', C: '#ec4899' };

export default function NbaFreeAgencyPage() {
  const {
    freeAgentPool, signPlayer, roster, capAvailable, totalCap, overLuxuryTax,
    luxuryTax, getMaxSalary, currentTeamAbbr, allTeams,
  } = useNbaGame();

  const [filterPos, setFilterPos] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState('rating');
  const [sortDir, setSortDir] = useState('desc');
  const [signingPlayer, setSigningPlayer] = useState(null);
  const [sigYears, setSigYears] = useState(3);
  const [sigAAV, setSigAAV] = useState('');
  const [feedback, setFeedback] = useState('');
  const [showSigned, setShowSigned] = useState([]);

  const currentTeamObj = allTeams.find(t => t.abbreviation === currentTeamAbbr);

  const filtered = useMemo(() => {
    return freeAgentPool
      .filter(p => filterPos === 'All' || p.position.startsWith(filterPos.replace('All', '')))
      .filter(p => !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => {
        let av = a[sortKey], bv = b[sortKey];
        if (typeof av === 'string') av = av.toLowerCase();
        if (typeof bv === 'string') bv = bv.toLowerCase();
        if (av < bv) return sortDir === 'asc' ? -1 : 1;
        if (av > bv) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
  }, [freeAgentPool, filterPos, searchQuery, sortKey, sortDir]);

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  function openSigning(player) {
    setSigningPlayer(player);
    setSigAAV(player.askingAAV.toFixed(1));
    setSigYears(3);
    setFeedback('');
  }

  function handleSign() {
    const aav = parseFloat(sigAAV);
    const years = sigYears;
    if (!aav || aav <= 0) { setFeedback('Enter a valid salary.'); return; }
    if (roster.length >= 15) { setFeedback('Roster full (15 players max for standard contracts).'); return; }

    // AI GM evaluation
    const asking = signingPlayer.askingAAV;
    const diff = aav - asking;
    let gmReaction = '';
    let accept = false;
    if (diff >= 0) { gmReaction = `${signingPlayer.name} accepts the offer of $${aav.toFixed(1)}M/yr.`; accept = true; }
    else if (diff >= -3) { gmReaction = `${signingPlayer.name} accepts slightly below asking. Team Bird rights help. Deal done at $${aav.toFixed(1)}M/yr.`; accept = true; }
    else if (diff >= -8 && signingPlayer.rating < 80) { gmReaction = `${signingPlayer.name} takes the discount — loves the market/team fit.`; accept = true; }
    else { gmReaction = `${signingPlayer.name} rejects the offer ($${asking.toFixed(1)}M asking price is too far above your offer of $${aav.toFixed(1)}M).`; accept = false; }

    if (accept) {
      signPlayer(signingPlayer, years, aav);
      setShowSigned(s => [...s, signingPlayer.id]);
      setSigningPlayer(null);
      setFeedback('');
    } else {
      setFeedback(gmReaction);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#FFA500', fontFamily: "'Oswald', sans-serif", letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
          Free Agency
        </div>
        <div style={{ fontSize: 13, color: '#64748B' }}>
          {currentTeamObj?.city} {currentTeamObj?.name} &bull; Cap Space: <span style={{ color: capAvailable < 0 ? '#FF2D55' : '#39FF14', fontWeight: 700 }}>${capAvailable.toFixed(1)}M</span> &bull; Roster: {roster.length}/15
        </div>
      </div>

      {/* Cap warning */}
      {overLuxuryTax && (
        <div style={{ background: 'rgba(255,107,0,0.08)', border: '1px solid rgba(255,107,0,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#FF6B00', fontWeight: 600 }}>
            OVER LUXURY TAX — Sign-and-trade and mid-level exception restrictions may apply. Use Bird rights to retain key players.
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search player..."
          style={{ background: 'rgba(30,41,59,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '6px 10px', color: '#E2E8F0', fontSize: 13, outline: 'none', width: 150 }}
        />
        {POSITIONS.map(pos => (
          <button key={pos} onClick={() => setFilterPos(pos)} style={{
            padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            background: filterPos === pos ? `${POS_COLORS[pos] || '#FFA500'}22` : 'rgba(30,41,59,0.5)',
            border: filterPos === pos ? `1px solid ${POS_COLORS[pos] || '#FFA500'}66` : '1px solid rgba(255,255,255,0.08)',
            color: filterPos === pos ? (POS_COLORS[pos] || '#FFA500') : '#94A3B8',
          }}>{pos}</button>
        ))}
      </div>

      {/* Free agent table */}
      <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: 'rgba(15,23,42,0.8)' }}>
            <tr>
              {[
                { label: 'Player', k: 'name' },
                { label: 'Pos', k: 'position' },
                { label: 'Age', k: 'age' },
                { label: 'Rating', k: 'rating' },
                { label: 'Asking $', k: 'askingAAV' },
                { label: 'Type', k: 'freeAgentType' },
              ].map(h => (
                <th key={h.k} onClick={() => handleSort(h.k)} style={{
                  cursor: 'pointer', padding: '8px 8px', color: sortKey === h.k ? '#FFA500' : '#64748B',
                  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'left', whiteSpace: 'nowrap',
                }}>
                  {h.label} {sortKey === h.k ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </th>
              ))}
              <th style={{ padding: '8px 8px', color: '#64748B', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((fa, idx) => {
              const pcolor = POS_COLORS[fa.position] || '#94A3B8';
              const alreadySigned = showSigned.includes(fa.id);
              return (
                <tr key={fa.id} style={{
                  background: idx % 2 === 0 ? 'rgba(15,23,42,0.3)' : 'transparent',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  opacity: alreadySigned ? 0.4 : 1,
                }}>
                  <td style={{ padding: '8px 8px', fontWeight: 600, color: '#E2E8F0' }}>
                    {fa.name}
                    {fa.traits && fa.traits.slice(0, 1).map(t => (
                      <span key={t} style={{ marginLeft: 6, fontSize: 9, color: '#64748B', background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.2)', borderRadius: 3, padding: '1px 4px' }}>{t}</span>
                    ))}
                  </td>
                  <td style={{ padding: '8px 8px', color: pcolor, fontWeight: 700, fontSize: 12 }}>{fa.position}</td>
                  <td style={{ padding: '8px 8px', color: '#64748B' }}>{fa.age}</td>
                  <td style={{ padding: '8px 8px' }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 7px', borderRadius: 5, fontSize: 11, fontWeight: 700,
                      background: fa.rating >= 90 ? '#FFD70022' : fa.rating >= 80 ? '#10b98122' : '#FFA50022',
                      border: fa.rating >= 90 ? '1px solid #FFD70066' : fa.rating >= 80 ? '1px solid #10b98166' : '1px solid #FFA50066',
                      color: fa.rating >= 90 ? '#FFD700' : fa.rating >= 80 ? '#10b981' : '#FFA500',
                    }}>{fa.rating}</span>
                  </td>
                  <td style={{ padding: '8px 8px', color: '#FFA500', fontWeight: 700 }}>${fa.askingAAV.toFixed(1)}M/yr</td>
                  <td style={{ padding: '8px 8px' }}>
                    <span style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 4, fontWeight: 600,
                      color: fa.freeAgentType === 'RFA' ? '#FFA500' : '#94A3B8',
                      background: fa.freeAgentType === 'RFA' ? 'rgba(255,165,0,0.1)' : 'rgba(148,163,184,0.1)',
                      border: fa.freeAgentType === 'RFA' ? '1px solid rgba(255,165,0,0.3)' : '1px solid rgba(148,163,184,0.2)',
                    }}>{fa.freeAgentType}</span>
                  </td>
                  <td style={{ padding: '8px 8px' }}>
                    {alreadySigned ? (
                      <span style={{ color: '#39FF14', fontSize: 11, fontWeight: 600 }}>Signed</span>
                    ) : (
                      <button onClick={() => openSigning(fa)} style={{
                        padding: '4px 12px', background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)',
                        borderRadius: 4, color: '#10b981', fontSize: 11, cursor: 'pointer', fontWeight: 700,
                      }}>Sign</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#475569' }}>No available free agents match filter</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Signing Modal */}
      {signingPlayer && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#0F172A', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 12, padding: 24, maxWidth: 400, width: '90%' }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#10b981', marginBottom: 8, fontFamily: "'Oswald', sans-serif" }}>
              Negotiate Contract — {signingPlayer.name}
            </div>
            <div style={{ fontSize: 13, color: '#94A3B8', marginBottom: 16, lineHeight: 1.6 }}>
              Rating: <strong style={{ color: '#FFA500' }}>{signingPlayer.rating}</strong> &bull;
              Position: <strong style={{ color: '#FFA500' }}>{signingPlayer.position}</strong> &bull;
              Asking: <strong style={{ color: '#FFA500' }}>${signingPlayer.askingAAV.toFixed(1)}M/yr</strong>
              {signingPlayer.freeAgentType === 'RFA' && (
                <span style={{ marginLeft: 8, fontSize: 11, color: '#FFA500', background: 'rgba(255,165,0,0.1)', border: '1px solid rgba(255,165,0,0.3)', borderRadius: 4, padding: '1px 6px' }}>RFA — Previous team can match</span>
              )}
            </div>
            {signingPlayer.traits && signingPlayer.traits.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                {signingPlayer.traits.map(t => (
                  <span key={t} style={{ fontSize: 11, color: '#64748B', background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.2)', borderRadius: 4, padding: '2px 7px' }}>{t}</span>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 11, color: '#64748B', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Years</label>
                <select value={sigYears} onChange={e => setSigYears(Number(e.target.value))}
                  style={{ width: '100%', background: 'rgba(30,41,59,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '6px 8px', color: '#E2E8F0', fontSize: 13, outline: 'none' }}>
                  {[1,2,3,4,5].map(y => <option key={y} value={y}>{y}yr</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 11, color: '#64748B', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>AAV ($M/yr)</label>
                <input type="number" value={sigAAV} onChange={e => setSigAAV(e.target.value)} min={1} max={55} step={0.5}
                  style={{ width: '100%', background: 'rgba(30,41,59,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '6px 8px', color: '#E2E8F0', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            <div style={{ fontSize: 12, color: '#64748B', marginBottom: 12 }}>
              Total value: <strong style={{ color: '#FFA500' }}>${(sigYears * parseFloat(sigAAV || 0)).toFixed(1)}M</strong> &bull;
              Cap impact: <strong style={{ color: capAvailable - parseFloat(sigAAV || 0) < 0 ? '#FF2D55' : '#10b981' }}>${capAvailable.toFixed(1)}M → ${(capAvailable - parseFloat(sigAAV || 0)).toFixed(1)}M</strong>
            </div>

            {feedback && (
              <div style={{ background: 'rgba(255,45,85,0.08)', border: '1px solid rgba(255,45,85,0.2)', borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#ff8899', lineHeight: 1.6 }}>
                {feedback}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={handleSign} style={{
                flex: 1, padding: '8px 16px', background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.4)',
                borderRadius: 6, color: '#10b981', fontWeight: 700, cursor: 'pointer', fontSize: 14,
              }}>Make Offer</button>
              <button onClick={() => setSigningPlayer(null)} style={{
                flex: 1, padding: '8px 16px', background: 'rgba(30,41,59,0.8)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6, color: '#94A3B8', cursor: 'pointer',
              }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

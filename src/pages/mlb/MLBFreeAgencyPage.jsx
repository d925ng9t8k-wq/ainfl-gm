import React, { useState, useMemo } from 'react';
import { useMLBGame } from '../../context/MLBGameContext';
import { CBT_THRESHOLDS } from '../../data/mlb/mlbTeams';

const POSITIONS = ['All', 'SP', 'RP', 'C', '1B', '2B', '3B', 'SS', 'OF', 'DH'];
const POS_COLORS = {
  SP: '#FB4F14', RP: '#f59e0b', C: '#10b981', '1B': '#3b82f6', '2B': '#8b5cf6',
  '3B': '#ec4899', SS: '#06b6d4', LF: '#84cc16', CF: '#14b8a6', RF: '#f97316', DH: '#94a3b8', OF: '#4ade80',
};
const OF_POSITIONS = ['LF', 'CF', 'RF', 'OF'];

function isOfPos(pos) { return OF_POSITIONS.includes(pos); }
function getPosColor(pos) { return POS_COLORS[pos] || POS_COLORS[isOfPos(pos) ? 'OF' : pos] || '#64748b'; }

function TierBadge({ rating }) {
  let tier, color, bg;
  if (rating >= 88) { tier = 'Elite'; color = '#fbbf24'; bg = 'rgba(251,191,36,0.15)'; }
  else if (rating >= 80) { tier = 'Star'; color = '#a78bfa'; bg = 'rgba(167,139,250,0.15)'; }
  else if (rating >= 72) { tier = 'Starter'; color = '#4ade80'; bg = 'rgba(74,222,128,0.15)'; }
  else if (rating >= 64) { tier = 'Role'; color = '#38bdf8'; bg = 'rgba(56,189,248,0.12)'; }
  else { tier = 'Depth'; color = '#94a3b8'; bg = 'rgba(148,163,184,0.12)'; }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', background: bg, border: `1px solid ${color}33`, color, padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>
      {tier}
    </span>
  );
}

export default function MLBFreeAgencyPage() {
  const { freeAgentPool, payroll, signPlayer, signingHistory, allTeams, currentTeamAbbr } = useMLBGame();
  const [filterPos, setFilterPos] = useState('All');
  const [search, setSearch] = useState('');
  const [signing, setSigning] = useState(null); // player being offered contract
  const [offerYears, setOfferYears] = useState(3);
  const [offerAAV, setOfferAAV] = useState(0);
  const [signResult, setSignResult] = useState(null);

  const team = allTeams.find(t => t.abbreviation === currentTeamAbbr);

  const filtered = useMemo(() => {
    return freeAgentPool.filter(p => {
      const posMatch = filterPos === 'All' || p.position === filterPos || (filterPos === 'OF' && isOfPos(p.position));
      const nameMatch = !search || p.name.toLowerCase().includes(search.toLowerCase());
      return posMatch && nameMatch;
    }).sort((a, b) => b.rating - a.rating);
  }, [freeAgentPool, filterPos, search]);

  function openOffer(player) {
    setSigning(player);
    setOfferYears(player.contractYears || 3);
    setOfferAAV(player.salary || 10);
    setSignResult(null);
  }

  function submitOffer() {
    if (!signing) return;
    const marketAAV = signing.salary;
    const ratio = offerAAV / marketAAV;
    const newPayroll = payroll + offerAAV;
    const overCBT = newPayroll > CBT_THRESHOLDS.first;

    // Accept logic: offer must be >= 80% of market value
    let accepted = false;
    let reason = '';
    if (ratio >= 1.1) { accepted = true; reason = 'Player accepted your above-market offer enthusiastically!'; }
    else if (ratio >= 0.95) { accepted = true; reason = 'Player accepted — fair market deal.'; }
    else if (ratio >= 0.82) {
      // Random chance — higher chance with more years
      accepted = Math.random() < 0.5 + (offerYears > signing.contractYears ? 0.2 : 0);
      reason = accepted ? 'Player accepted — close to market value.' : 'Player rejected — looking for more money.';
    } else {
      accepted = false;
      reason = 'Player rejected — offer too far below market value.';
    }

    if (accepted) {
      signPlayer(signing, offerYears, offerAAV);
      setSignResult({ success: true, reason, player: signing.name, overCBT });
    } else {
      setSignResult({ success: false, reason, player: signing.name });
    }
    setSigning(null);
  }

  return (
    <div style={{ color: '#E2E8F0' }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: '0 0 4px', fontFamily: "'Oswald', sans-serif", fontSize: 22, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Free Agency
        </h2>
        <div style={{ color: '#94A3B8', fontSize: 13 }}>
          {team?.city} {team?.name} &bull; Current payroll: ${payroll.toFixed(1)}M &bull; CBT: ${CBT_THRESHOLDS.first}M
        </div>
      </div>

      {/* Sign result banner */}
      {signResult && (
        <div style={{
          background: signResult.success ? 'rgba(74,222,128,0.1)' : 'rgba(239,68,68,0.1)',
          border: `1px solid ${signResult.success ? '#4ade80' : '#ef4444'}`,
          borderRadius: 8, padding: '12px 16px', marginBottom: 16,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div style={{ fontWeight: 700, color: signResult.success ? '#4ade80' : '#ef4444', fontSize: 14 }}>
              {signResult.success ? `Signed ${signResult.player}!` : `${signResult.player} walked`}
            </div>
            <div style={{ color: '#94A3B8', fontSize: 12, marginTop: 2 }}>{signResult.reason}</div>
            {signResult.overCBT && <div style={{ color: '#fb923c', fontSize: 11, marginTop: 2 }}>Warning: This signing pushes you over the CBT threshold.</div>}
          </div>
          <button onClick={() => setSignResult(null)} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
      )}

      {/* Recent signings */}
      {signingHistory.length > 0 && (
        <div style={{ background: 'rgba(74,222,128,0.05)', border: '1px solid rgba(74,222,128,0.15)', borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: '#4ade80', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Recent Signings</div>
          {signingHistory.slice(-3).reverse().map(s => (
            <div key={s.id} style={{ fontSize: 12, color: '#94A3B8', marginBottom: 3 }}>
              {s.player} &bull; {s.years}yr / ${s.aav.toFixed(1)}M AAV
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search free agents..."
          style={{ background: 'rgba(30,41,59,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '6px 12px', color: '#E2E8F0', fontSize: 13, width: 200 }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {POSITIONS.map(pos => (
            <button key={pos} onClick={() => setFilterPos(pos)}
              style={{
                background: filterPos === pos ? 'rgba(0,200,83,0.2)' : 'rgba(30,41,59,0.6)',
                border: `1px solid ${filterPos === pos ? 'rgba(0,200,83,0.5)' : 'rgba(255,255,255,0.1)'}`,
                color: filterPos === pos ? '#00C853' : '#94A3B8',
                borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontWeight: filterPos === pos ? 700 : 400,
              }}>{pos}</button>
          ))}
        </div>
      </div>

      {/* FA Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {filtered.map(player => {
          const projectedPayroll = payroll + player.salary;
          const overCBT = projectedPayroll > CBT_THRESHOLDS.first;
          return (
            <div key={player.id} style={{
              background: 'rgba(30,41,59,0.6)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 10, padding: '14px',
              borderLeft: `3px solid ${getPosColor(player.position)}`,
              transition: 'border-color 0.2s',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: '#E2E8F0' }}>{player.name}</div>
                  <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>{player.position} &bull; Age {player.age}</div>
                </div>
                <TierBadge rating={player.rating} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                <div style={{ background: 'rgba(15,23,42,0.4)', borderRadius: 6, padding: '6px 8px' }}>
                  <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase' }}>Market AAV</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#E2E8F0', marginTop: 1 }}>${player.salary.toFixed(1)}M</div>
                </div>
                <div style={{ background: 'rgba(15,23,42,0.4)', borderRadius: 6, padding: '6px 8px' }}>
                  <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase' }}>Expected Yrs</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#E2E8F0', marginTop: 1 }}>{player.contractYears}yr</div>
                </div>
              </div>

              {player.notes && <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10 }}>{player.notes}</div>}

              {overCBT && (
                <div style={{ fontSize: 10, color: '#fb923c', marginBottom: 8, padding: '4px 8px', background: 'rgba(251,146,60,0.1)', borderRadius: 4 }}>
                  Signing would put payroll at ${projectedPayroll.toFixed(0)}M — over CBT by ${(projectedPayroll - CBT_THRESHOLDS.first).toFixed(1)}M
                </div>
              )}

              <button
                onClick={() => openOffer(player)}
                style={{
                  width: '100%',
                  background: 'rgba(0,200,83,0.15)',
                  border: '1px solid rgba(0,200,83,0.4)',
                  color: '#00C853',
                  borderRadius: 6, padding: '8px', fontSize: 13, cursor: 'pointer', fontWeight: 700,
                  fontFamily: "'Oswald', sans-serif", letterSpacing: '0.04em', textTransform: 'uppercase',
                }}>
                Make Offer
              </button>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 32, color: '#475569' }}>
            No free agents match this filter.
          </div>
        )}
      </div>

      {/* Offer Modal */}
      {signing && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
        }}>
          <div style={{ background: '#0f172a', border: '1px solid rgba(0,200,83,0.3)', borderRadius: 14, padding: 24, maxWidth: 400, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.8)' }}>
            <div style={{ fontSize: 18, fontWeight: 900, fontFamily: "'Oswald', sans-serif", letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
              Contract Offer
            </div>
            <div style={{ fontSize: 14, color: '#94A3B8', marginBottom: 16 }}>
              {signing.name} &bull; {signing.position} &bull; Rating {signing.rating}
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#94A3B8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Contract Length: {offerYears} year{offerYears !== 1 ? 's' : ''}
              </label>
              <input type="range" min={1} max={10} value={offerYears} onChange={e => setOfferYears(+e.target.value)}
                style={{ width: '100%', accentColor: '#00C853' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#475569', marginTop: 2 }}>
                <span>1yr</span><span>10yr</span>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#94A3B8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                AAV: ${offerAAV.toFixed(1)}M/yr (market: ${signing.salary.toFixed(1)}M)
              </label>
              <input type="range" min={1} max={Math.max(signing.salary * 2, 20)} step={0.5} value={offerAAV}
                onChange={e => setOfferAAV(+e.target.value)}
                style={{ width: '100%', accentColor: '#00C853' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#475569', marginTop: 2 }}>
                <span>$1M</span><span>${(Math.max(signing.salary * 2, 20)).toFixed(0)}M</span>
              </div>
            </div>

            <div style={{ background: 'rgba(15,23,42,0.6)', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: '#94A3B8' }}>Total value:</span>
                <span style={{ fontWeight: 700, color: '#E2E8F0' }}>${(offerAAV * offerYears).toFixed(1)}M</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 4 }}>
                <span style={{ color: '#94A3B8' }}>New payroll:</span>
                <span style={{ fontWeight: 700, color: (payroll + offerAAV) > CBT_THRESHOLDS.first ? '#fb923c' : '#4ade80' }}>
                  ${(payroll + offerAAV).toFixed(1)}M
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 4 }}>
                <span style={{ color: '#94A3B8' }}>vs market:</span>
                <span style={{ fontWeight: 700, color: offerAAV >= signing.salary ? '#4ade80' : offerAAV >= signing.salary * 0.82 ? '#facc15' : '#ef4444' }}>
                  {offerAAV >= signing.salary ? 'Above market' : offerAAV >= signing.salary * 0.82 ? 'Slightly below' : 'Below market'}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={submitOffer}
                style={{ flex: 1, background: 'rgba(0,200,83,0.2)', border: '1px solid rgba(0,200,83,0.5)', color: '#00C853', borderRadius: 8, padding: '10px', fontSize: 14, cursor: 'pointer', fontWeight: 700, fontFamily: "'Oswald', sans-serif" }}>
                Submit Offer
              </button>
              <button onClick={() => setSigning(null)}
                style={{ flex: 1, background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.3)', color: '#94A3B8', borderRadius: 8, padding: '10px', fontSize: 14, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

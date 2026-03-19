import React, { useState, useMemo } from 'react';
import { useGame } from '../context/GameContext';
import PredictionMarkets from '../components/PredictionMarkets';

const NEEDS_MAP = {
  QB: (roster) => roster.filter(p => p.position === 'QB').length < 2 ? 'Need' : 'Set',
  RB: (roster) => roster.filter(p => p.position === 'RB').length < 2 ? 'Need' : 'Set',
  WR: (roster) => roster.filter(p => p.position === 'WR').length < 4 ? 'Need' : 'Set',
  TE: (roster) => roster.filter(p => p.position === 'TE').length < 2 ? 'Need' : 'Set',
  OT: (roster) => roster.filter(p => ['LT', 'RT', 'OT'].includes(p.position)).length < 2 ? 'Need' : 'Set',
  OG: (roster) => roster.filter(p => ['LG', 'RG', 'OG'].includes(p.position)).length < 2 ? 'Need' : 'Set',
  C: (roster) => roster.filter(p => p.position === 'C').length < 1 ? 'Need' : 'Set',
  DE: (roster) => roster.filter(p => ['DE', 'EDGE'].includes(p.position)).length < 3 ? 'Need' : 'Set',
  DT: (roster) => roster.filter(p => p.position === 'DT').length < 2 ? 'Need' : 'Set',
  LB: (roster) => roster.filter(p => ['LB', 'MLB', 'OLB'].includes(p.position)).length < 3 ? 'Need' : 'Set',
  CB: (roster) => roster.filter(p => p.position === 'CB').length < 3 ? 'Need' : 'Set',
  S: (roster) => roster.filter(p => ['S', 'FS', 'SS'].includes(p.position)).length < 2 ? 'Need' : 'Set',
};

function RatingBar({ rating }) {
  const color = rating >= 85 ? '#4ade80' : rating >= 75 ? '#facc15' : rating >= 65 ? '#fb923c' : '#94a3b8';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 6, background: 'rgba(0,240,255,0.12)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${rating}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ color, fontSize: 12, fontWeight: 700, minWidth: 24 }}>{rating}</span>
    </div>
  );
}

function SigningModal({ player, onSign, onClose, capAvailable }) {
  const [years, setYears] = useState(Math.min(player.yearsRequested, 3));
  const [aav, setAav] = useState(player.askingPrice);
  const [signingBonus, setSigningBonus] = useState(Math.round(player.askingPrice * years * 0.3 * 10) / 10);
  const [guaranteedPct, setGuaranteedPct] = useState(50);
  const [forceSigning, setForceSigning] = useState(false);

  // Realistic NFL contract math
  const totalValue = parseFloat((aav * years).toFixed(1));
  const guaranteed = parseFloat((totalValue * guaranteedPct / 100).toFixed(1));
  const maxSigningBonus = Math.min(totalValue * 0.6, totalValue);
  const actualSigningBonus = Math.min(signingBonus, maxSigningBonus);

  // Year 1 cap hit: base salary + prorated signing bonus
  // Base salary Year 1 is typically lower (signing bonus replaces some base)
  const proratedBonus = years > 0 ? parseFloat((actualSigningBonus / years).toFixed(2)) : 0;
  const baseSalaryY1 = Math.max(1.1, aav - proratedBonus); // can't go below league min
  const year1CapHit = parseFloat((baseSalaryY1 + proratedBonus).toFixed(1));

  // Dead money if cut after Year 1: remaining prorated bonus
  const deadMoneyY2 = parseFloat((actualSigningBonus - proratedBonus).toFixed(1));

  const canAfford = year1CapHit <= capAvailable;

  // Player acceptance logic
  // Player wants: close to asking price, enough years, enough guaranteed
  const aavRatio = aav / player.askingPrice;
  const yearsOk = years >= Math.min(player.yearsRequested, 2);
  const guaranteedOk = guaranteedPct >= 30;
  const willAccept = aavRatio >= 0.70 && yearsOk && guaranteedOk;
  const isGreatDeal = aavRatio >= 1.05 && guaranteedPct >= 55;
  const isUnderpay = aavRatio < 0.70;

  let acceptLabel = '';
  let acceptColor = '#4ade80';
  if (isGreatDeal) { acceptLabel = 'Player loves this deal!'; acceptColor = '#4ade80'; }
  else if (willAccept) { acceptLabel = 'Player willing to sign'; acceptColor = '#facc15'; }
  else if (isUnderpay) { acceptLabel = `Below market — needs at least $${(player.askingPrice * 0.70).toFixed(1)}M AAV`; acceptColor = '#ff4444'; }
  else if (!yearsOk) { acceptLabel = `Wants at least ${Math.min(player.yearsRequested, 2)} years`; acceptColor = '#ff4444'; }
  else { acceptLabel = 'Needs more guaranteed money (30%+ of total)'; acceptColor = '#ff4444'; }

  // Update signing bonus when years/aav change
  const handleYearsChange = (v) => { setYears(v); setSigningBonus(Math.round(aav * v * 0.3 * 10) / 10); };
  const handleAavChange = (v) => { setAav(v); setSigningBonus(Math.round(v * years * 0.3 * 10) / 10); };

  const row = (label, value, color = '#CBD5E1') => (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
      <span style={{ color: '#94A3B8' }}>{label}</span>
      <span style={{ color, fontWeight: 700 }}>{value}</span>
    </div>
  );

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,8,20,0.90)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: 'linear-gradient(135deg, #0a1225, #0f172a)', border: '1px solid rgba(0,240,255,0.12)', borderRadius: 14, padding: 24, maxWidth: 'min(460px, 95vw)', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: '0 0 2px', color: '#fff', fontSize: 18 }}>{player.name}</h3>
            <p style={{ margin: 0, color: '#94A3B8', fontSize: 13 }}>{player.position} · Age {player.age} · {player.previousTeam}</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#facc15', fontSize: 12, fontWeight: 700 }}>Market: ${player.askingPrice}M/yr</div>
            <div style={{ color: '#64748b', fontSize: 11 }}>{player.yearsRequested}yr preferred</div>
          </div>
        </div>

        {/* Contract Length */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'flex', justifyContent: 'space-between', color: '#94A3B8', fontSize: 12, marginBottom: 6 }}>
            <span>Contract Length</span>
            <strong style={{ color: '#fff' }}>{years} year{years > 1 ? 's' : ''}</strong>
          </label>
          <input type="range" min={1} max={6} value={years} onChange={e => handleYearsChange(Number(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--bengals-orange)' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(0,240,255,0.18)' }}>
            <span>1yr</span><span>2yr</span><span>3yr</span><span>4yr</span><span>5yr</span><span>6yr</span>
          </div>
        </div>

        {/* AAV */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'flex', justifyContent: 'space-between', color: '#94A3B8', fontSize: 12, marginBottom: 6 }}>
            <span>Average Annual Value (AAV)</span>
            <strong style={{ color: '#fff' }}>${aav.toFixed(1)}M</strong>
          </label>
          <input type="range" min={Math.max(0.5, player.askingPrice * 0.25)} max={player.askingPrice * 2.0} step={0.1}
            value={aav} onChange={e => handleAavChange(Number(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--bengals-orange)' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(0,240,255,0.18)' }}>
            <span>${(player.askingPrice * 0.25).toFixed(0)}M</span><span>${(player.askingPrice * 2.0).toFixed(0)}M</span>
          </div>
        </div>

        {/* Signing Bonus */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'flex', justifyContent: 'space-between', color: '#94A3B8', fontSize: 12, marginBottom: 6 }}>
            <span>Signing Bonus</span>
            <strong style={{ color: '#fff' }}>${actualSigningBonus.toFixed(1)}M</strong>
          </label>
          <input type="range" min={0} max={maxSigningBonus} step={0.5} value={signingBonus}
            onChange={e => setSigningBonus(Number(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--bengals-orange)' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(0,240,255,0.18)' }}>
            <span>$0</span><span>${maxSigningBonus.toFixed(0)}M</span>
          </div>
        </div>

        {/* Guaranteed % */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'flex', justifyContent: 'space-between', color: '#94A3B8', fontSize: 12, marginBottom: 6 }}>
            <span>Guaranteed Money</span>
            <strong style={{ color: '#fff' }}>${guaranteed.toFixed(1)}M ({guaranteedPct}%)</strong>
          </label>
          <input type="range" min={0} max={100} step={5} value={guaranteedPct}
            onChange={e => setGuaranteedPct(Number(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--bengals-orange)' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(0,240,255,0.18)' }}>
            <span>0%</span><span>50%</span><span>100%</span>
          </div>
        </div>

        {/* Contract Breakdown */}
        <div style={{ background: '#0a0f1e', borderRadius: 10, padding: 14, marginBottom: 12 }}>
          <div style={{ color: '#CBD5E1', fontSize: 11, fontWeight: 700, marginBottom: 8, letterSpacing: '0.04em' }}>CONTRACT BREAKDOWN</div>
          {row('Total value', `$${totalValue.toFixed(1)}M / ${years}yr`)}
          {row('Average per year', `$${aav.toFixed(1)}M`)}
          {row('Signing bonus', `$${actualSigningBonus.toFixed(1)}M (prorated $${proratedBonus.toFixed(1)}M/yr)`)}
          {row('Guaranteed', `$${guaranteed.toFixed(1)}M (${guaranteedPct}%)`)}
          <div style={{ borderTop: '1px solid rgba(0,240,255,0.12)', margin: '8px 0', paddingTop: 8 }} />
          <div style={{ color: '#CBD5E1', fontSize: 11, fontWeight: 700, marginBottom: 8, letterSpacing: '0.04em' }}>CAP IMPACT</div>
          {row('Year 1 base salary', `$${baseSalaryY1.toFixed(1)}M`)}
          {row('Year 1 prorated bonus', `$${proratedBonus.toFixed(1)}M`)}
          {row('Year 1 cap hit', `$${year1CapHit.toFixed(1)}M`, canAfford ? '#4ade80' : '#ff4444')}
          {row('Cap space after signing', `$${(capAvailable - year1CapHit).toFixed(1)}M`, (capAvailable - year1CapHit) >= 0 ? '#4ade80' : '#ff4444')}
          {years > 1 && row('Dead money if cut after Y1', `$${deadMoneyY2.toFixed(1)}M`, deadMoneyY2 > year1CapHit ? '#ff4444' : '#94A3B8')}
        </div>

        {/* Player Acceptance Indicator */}
        <div style={{
          background: willAccept ? 'rgba(74,222,128,0.1)' : 'rgba(255,68,68,0.1)',
          border: `1px solid ${acceptColor}`,
          borderRadius: 8, padding: 10, marginBottom: 12, textAlign: 'center',
        }}>
          <div style={{ color: acceptColor, fontSize: 13, fontWeight: 700 }}>{acceptLabel}</div>
          {!willAccept && (
            <div style={{ color: '#94A3B8', fontSize: 11, marginTop: 4 }}>
              Adjust terms to meet player expectations
            </div>
          )}
        </div>

        {!canAfford && (
          <div style={{ background: 'rgba(255,68,68,0.15)', border: '1px solid #ff4444', borderRadius: 6, padding: 8, marginBottom: 12, color: '#ff4444', fontSize: 12 }}>
            This signing would push you over the cap!
          </div>
        )}

        {/* Force Signing Toggle */}
        {!canAfford && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
            padding: '8px 12px', background: '#0a0f1e', borderRadius: 8,
          }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={forceSigning}
                onChange={e => setForceSigning(e.target.checked)}
                style={{ accentColor: 'var(--bengals-orange)' }}
              />
              <span style={{ color: '#CBD5E1', fontSize: 12 }}>Force Signing (override cap)</span>
            </label>
            {forceSigning && (
              <span style={{ color: '#fbbf24', fontSize: 11 }}>Warning: signing over cap</span>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => onSign(years, aav, { signingBonus: actualSigningBonus, guaranteed, year1CapHit, baseSalaryY1, proratedBonus, deadMoneyY2 })}
            disabled={!willAccept || (!canAfford && !forceSigning)}
            style={{
              background: (willAccept && (canAfford || forceSigning)) ? 'var(--bengals-orange)' : 'rgba(0,240,255,0.12)',
              color: (willAccept && (canAfford || forceSigning)) ? '#000' : '#475569',
              border: 'none', borderRadius: 8, padding: '12px 0',
              cursor: (willAccept && (canAfford || forceSigning)) ? 'pointer' : 'not-allowed',
              fontWeight: 800, flex: 1, fontSize: 14,
              opacity: (willAccept && (canAfford || forceSigning)) ? 1 : 0.5,
            }}
          >
            {!willAccept ? 'Player Declines' : (!canAfford && !forceSigning) ? 'Over Cap — Force to Sign' : 'Sign Player'}
          </button>
          <button onClick={onClose}
            style={{ background: 'rgba(0,240,255,0.12)', color: '#fff', border: 'none', borderRadius: 8, padding: '12px 0', cursor: 'pointer', flex: 0.6, fontSize: 13 }}
          >Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function FreeAgencyPage() {
  const { freeAgentPool, roster, signPlayer, capAvailable } = useGame();
  const [filterPos, setFilterPos] = useState('All');
  const [sortBy, setSortBy] = useState('priceDesc');
  const [signingPlayer, setSigningPlayer] = useState(null);
  const [signedFeedback, setSignedFeedback] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Build available positions from actual data for reliable filtering
  const availablePositions = useMemo(() => {
    const posSet = new Set(freeAgentPool.map(p => p.position));
    return ['All', ...Array.from(posSet).sort()];
  }, [freeAgentPool]);

  const filtered = useMemo(() => {
    let list = freeAgentPool;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q));
    }
    if (filterPos !== 'All') {
      // Match exact position or position group
      list = list.filter(p => {
        if (p.position === filterPos) return true;
        // Group matching for OL positions
        if (filterPos === 'OT' && ['LT', 'RT', 'OT'].includes(p.position)) return true;
        if (filterPos === 'OG' && ['LG', 'RG', 'OG', 'G'].includes(p.position)) return true;
        if (filterPos === 'DE' && ['DE', 'EDGE', 'ED'].includes(p.position)) return true;
        if (filterPos === 'S' && ['S', 'FS', 'SS'].includes(p.position)) return true;
        return false;
      });
    }
    list = [...list].sort((a, b) => {
      if (sortBy === 'rating') return b.rating - a.rating;
      if (sortBy === 'age') return a.age - b.age;
      if (sortBy === 'price') return a.askingPrice - b.askingPrice;
      if (sortBy === 'priceDesc') return b.askingPrice - a.askingPrice;
      return 0;
    });
    return list;
  }, [freeAgentPool, filterPos, sortBy, searchQuery]);

  function handleSign(years, aav, details) {
    signPlayer(signingPlayer, years, aav, details);
    const gtd = details?.guaranteed ? ` ($${details.guaranteed.toFixed(1)}M guaranteed)` : '';
    setSignedFeedback(`Signed ${signingPlayer.name}! ${years}yr/$${(aav * years).toFixed(1)}M ($${aav.toFixed(1)}M/yr)${gtd}`);
    setSigningPlayer(null);
    setTimeout(() => setSignedFeedback(''), 5000);
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 22, color: 'var(--bengals-orange)' }}>Free Agency</h1>
        <p style={{ margin: 0, color: '#94A3B8', fontSize: 14 }}>{freeAgentPool.length} players available · ${capAvailable.toFixed(1)}M cap space</p>
      </div>

      {signedFeedback && (
        <div style={{ background: 'rgba(74,222,128,0.15)', border: '1px solid #4ade80', borderRadius: 8, padding: 10, marginBottom: 12, color: '#4ade80', fontSize: 13 }}>
          ✓ {signedFeedback}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1 }}>
          {availablePositions.map(pos => (
            <button
              key={pos}
              onClick={() => setFilterPos(pos)}
              style={{
                padding: '8px 14px',
                borderRadius: 20,
                border: 'none',
                cursor: 'pointer',
                background: filterPos === pos ? 'var(--bengals-orange)' : '#1e293b',
                color: filterPos === pos ? '#000' : '#CBD5E1',
                fontSize: 12,
                fontWeight: filterPos === pos ? 700 : 400,
                minHeight: 36,
              }}
            >{pos}</button>
          ))}
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search free agents..."
          style={{
            width: '100%',
            maxWidth: 300,
            background: 'rgba(30,41,59,0.6)',
            color: '#E2E8F0',
            border: '1px solid rgba(0,240,255,0.15)',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 13,
            fontFamily: "'Inter', system-ui, sans-serif",
            outline: 'none',
          }}
        />
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          style={{ background: '#1e293b', color: '#CBD5E1', border: '1px solid rgba(0,240,255,0.18)', borderRadius: 6, padding: '6px 10px', fontSize: 12, minHeight: 36 }}
        >
          <option value="price">Sort: Contract ↑</option>
          <option value="priceDesc">Sort: Contract ↓</option>
          <option value="rating">Sort: Rating</option>
          <option value="age">Sort: Age</option>
        </select>
      </div>

      {/* Player Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {filtered.map(player => {
          const need = NEEDS_MAP[player.position] ? NEEDS_MAP[player.position](roster) : null;
          return (
            <div
              key={player.id}
              style={{
                background: '#0f172a',
                border: '1px solid rgba(0,240,255,0.12)',
                borderRadius: 10,
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{player.name}</div>
                  <div style={{ color: '#94A3B8', fontSize: 12 }}>{player.previousTeam}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <span style={{
                    background: '#2a2a2a',
                    color: 'var(--bengals-orange)',
                    padding: '2px 6px',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 700,
                  }}>{player.position}</span>
                  {need && (
                    <span style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: need === 'Need' ? '#4ade80' : '#64748b',
                    }}>{need === 'Need' ? '★ NEED' : 'Depth'}</span>
                  )}
                </div>
              </div>

              <RatingBar rating={player.rating} />

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#94A3B8' }}>
                <span>Age: <strong style={{ color: '#CBD5E1' }}>{player.age}</strong></span>
                <span>Ask: <strong style={{ color: '#facc15' }}>${player.askingPrice}M/{player.yearsRequested}yr</strong></span>
              </div>

              <button
                onClick={() => setSigningPlayer(player)}
                style={{
                  background: 'var(--bengals-orange)',
                  color: '#000',
                  border: 'none',
                  borderRadius: 6,
                  padding: '7px 0',
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontSize: 13,
                  marginTop: 4,
                }}
              >
                Negotiate Contract
              </button>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>No free agents available at this position</div>
      )}

      {signingPlayer && (
        <SigningModal
          player={signingPlayer}
          onSign={handleSign}
          onClose={() => setSigningPlayer(null)}
          capAvailable={capAvailable}
        />
      )}

      <PredictionMarkets maxMarkets={4} />
    </div>
  );
}

import React, { useMemo } from 'react';
import { useGame } from '../context/GameContext';
import { deadCapCharges } from '../data/bengalsRoster';

const POS_GROUPS = {
  QB: ['QB'],
  RB: ['RB', 'FB'],
  WR: ['WR'],
  TE: ['TE'],
  OL: ['LT', 'RT', 'LG', 'RG', 'C', 'OT', 'OG', 'IOL'],
  DL: ['DE', 'DT', 'NT', 'DL', 'EDGE'],
  LB: ['LB', 'MLB', 'OLB'],
  DB: ['CB', 'S', 'FS', 'SS'],
  ST: ['K', 'P', 'LS'],
};

const GROUP_COLORS = {
  QB: '#FB4F14',
  RB: '#f59e0b',
  WR: '#10b981',
  TE: '#3b82f6',
  OL: '#8b5cf6',
  DL: '#ec4899',
  LB: '#06b6d4',
  DB: '#84cc16',
  ST: '#94a3b8',
};

function getGroup(pos) {
  for (const [g, arr] of Object.entries(POS_GROUPS)) {
    if (arr.includes(pos)) return g;
  }
  return 'Other';
}

export default function CapTrackerPage() {
  const { roster, cutPlayers, capUsed, capAvailable, totalCap } = useGame();
  const isOverCap = capUsed > totalCap;
  const capPct = Math.min((capUsed / totalCap) * 100, 100);

  const byGroup = useMemo(() => {
    const groups = {};
    for (const p of roster) {
      const g = getGroup(p.position);
      if (!groups[g]) groups[g] = { total: 0, players: [] };
      groups[g].total += p.capHit;
      groups[g].players.push(p);
    }
    return groups;
  }, [roster]);

  const top10 = useMemo(() =>
    [...roster].sort((a, b) => b.capHit - a.capHit).slice(0, 10),
    [roster]
  );

  const suggestions = useMemo(() => {
    return [...roster]
      .filter(p => !p.isFranchise && p.capHit > 3)
      .sort((a, b) => b.capHit - a.capHit)
      .slice(0, 5)
      .map(p => ({
        player: p.name,
        position: p.position,
        savings: (p.capHit * 0.7).toFixed(1),
        capHit: p.capHit,
      }));
  }, [roster]);

  const preExistingDeadCap = deadCapCharges.reduce((s, d) => s + d.amount, 0);
  const userDeadCap = cutPlayers.reduce((s, p) => s + (p.deadCap || 0), 0);
  const deadCapTotal = preExistingDeadCap + userDeadCap;

  return (
    <div>
      <h1 style={{ margin: '0 0 16px', fontSize: 22, color: 'var(--bengals-orange)' }}>Cap Tracker</h1>

      {/* Main cap bar */}
      <div style={{ background: '#0d2a16', borderRadius: 12, padding: 20, marginBottom: 16, border: isOverCap ? '1px solid #ff4444' : '1px solid rgba(40,200,40,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ color: '#6a9a78', fontSize: 13 }}>2026 Salary Cap</span>
          <span style={{ color: isOverCap ? '#ff4444' : '#4ade80', fontWeight: 700 }}>
            {isOverCap ? `OVER by $${(capUsed - totalCap).toFixed(1)}M` : `$${capAvailable.toFixed(1)}M remaining`}
          </span>
        </div>
        <div style={{ height: 24, background: 'rgba(40,200,40,0.25)', borderRadius: 12, overflow: 'hidden', marginBottom: 8 }}>
          <div style={{
            height: '100%',
            width: `${capPct}%`,
            background: isOverCap ? '#ff4444' : capPct > 90 ? '#facc15' : 'var(--bengals-orange)',
            borderRadius: 12,
            transition: 'width 0.5s',
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span style={{ color: '#c4d8cc' }}>Used: <strong style={{ color: '#fff' }}>${capUsed.toFixed(1)}M</strong></span>
          <span style={{ color: '#6a9a78' }}>Total: ${totalCap}M</span>
        </div>

        {isOverCap && (
          <div style={{
            marginTop: 12,
            background: 'rgba(255,68,68,0.15)',
            border: '1px solid #ff4444',
            borderRadius: 8,
            padding: '8px 12px',
            color: '#ff4444',
            fontSize: 13,
          }}>
            ⚠️ You are over the salary cap! Cut or restructure contracts to become compliant.
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {/* Position Breakdown */}
        <div style={{ background: '#0d2a16', borderRadius: 12, padding: 20, border: '1px solid rgba(40,200,40,0.25)' }}>
          <h3 style={{ margin: '0 0 16px', color: '#fff', fontSize: 16 }}>By Position Group</h3>
          {Object.entries(byGroup)
            .sort(([, a], [, b]) => b.total - a.total)
            .map(([group, data]) => {
              const pct = (data.total / capUsed) * 100;
              const color = GROUP_COLORS[group] || '#6a9a78';
              return (
                <div key={group} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, fontSize: 13 }}>
                    <span style={{ color }}>{group}</span>
                    <span style={{ color: '#c4d8cc' }}>${data.total.toFixed(1)}M ({pct.toFixed(0)}%)</span>
                  </div>
                  <div style={{ height: 8, background: 'rgba(40,200,40,0.25)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${pct}%`,
                      background: color,
                      borderRadius: 4,
                      transition: 'width 0.4s',
                    }} />
                  </div>
                </div>
              );
            })}
        </div>

        {/* Top 10 Cap Hits */}
        <div style={{ background: '#0d2a16', borderRadius: 12, padding: 20, border: '1px solid rgba(40,200,40,0.25)' }}>
          <h3 style={{ margin: '0 0 16px', color: '#fff', fontSize: 16 }}>Top 10 Cap Hits</h3>
          {top10.map((p, i) => (
            <div key={p.id} style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '6px 0',
              borderBottom: '1px solid #1a2420',
              fontSize: 13,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#4a7a58', width: 20 }}>#{i + 1}</span>
                <div>
                  <div style={{ color: '#fff' }}>{p.name}</div>
                  <div style={{ color: '#6a9a78', fontSize: 11 }}>{p.position}</div>
                </div>
              </div>
              <span style={{ color: 'var(--bengals-orange)', fontWeight: 700 }}>${p.capHit.toFixed(1)}M</span>
            </div>
          ))}
        </div>

        {/* Dead Cap */}
        <div style={{ background: '#0d2a16', borderRadius: 12, padding: 20, border: '1px solid rgba(40,200,40,0.25)' }}>
          <h3 style={{ margin: '0 0 16px', color: '#fff', fontSize: 16 }}>
            Dead Cap
            <span style={{ marginLeft: 8, color: '#ff4444', fontSize: 14 }}>${deadCapTotal.toFixed(1)}M</span>
          </h3>
          {/* Pre-existing dead cap charges */}
          {deadCapCharges.map(d => (
            <div key={d.name + '_preexist'} style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '6px 0',
              borderBottom: '1px solid #1a2420',
              fontSize: 13,
            }}>
              <div>
                <div style={{ color: '#c4d8cc' }}>{d.name}</div>
                <div style={{ color: '#6a9a78', fontSize: 11 }}>{d.reason}</div>
              </div>
              <span style={{ color: '#ff4444' }}>${d.amount.toFixed(1)}M</span>
            </div>
          ))}
          {cutPlayers.length === 0 && deadCapCharges.length === 0 ? (
            <p style={{ color: '#4a7a58', fontSize: 13 }}>No dead cap — no players have been cut.</p>
          ) : (
            cutPlayers.map(p => (
              <div key={p.id + '_dead'} style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '6px 0',
                borderBottom: '1px solid #1a2420',
                fontSize: 13,
              }}>
                <div>
                  <div style={{ color: '#c4d8cc' }}>{p.name}</div>
                  <div style={{ color: '#6a9a78', fontSize: 11 }}>{p.position}</div>
                </div>
                <span style={{ color: '#ff4444' }}>${(p.deadCap || 0).toFixed(1)}M</span>
              </div>
            ))
          )}
        </div>

        {/* Suggestions */}
        <div style={{ background: '#0d2a16', borderRadius: 12, padding: 20, border: '1px solid rgba(40,200,40,0.25)' }}>
          <h3 style={{ margin: '0 0 16px', color: '#fff', fontSize: 16 }}>💡 Cap Suggestions</h3>
          {suggestions.map(s => (
            <div key={s.player} style={{
              padding: '8px 0',
              borderBottom: '1px solid #1a2420',
              fontSize: 13,
            }}>
              <div style={{ color: '#c4d8cc' }}>
                Cut <strong style={{ color: '#fff' }}>{s.player}</strong> ({s.position})
              </div>
              <div style={{ color: '#4ade80', marginTop: 2 }}>
                → Save ~${s.savings}M
              </div>
            </div>
          ))}
          {suggestions.length === 0 && (
            <p style={{ color: '#4a7a58', fontSize: 13 }}>Your roster looks efficient!</p>
          )}
        </div>
      </div>
    </div>
  );
}

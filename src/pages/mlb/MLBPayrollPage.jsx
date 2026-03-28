import React, { useMemo } from 'react';
import { useMLBGame, computeCBT } from '../../context/MLBGameContext';
import { CBT_THRESHOLDS } from '../../data/mlb/mlbTeams';

const POS_GROUPS = {
  'Starting Pitching': ['SP'],
  'Bullpen': ['RP'],
  'Catcher': ['C'],
  'Corner Infield': ['1B', '3B'],
  'Middle Infield': ['2B', 'SS'],
  'Outfield': ['LF', 'CF', 'RF'],
  'DH': ['DH'],
};

const GROUP_COLORS = {
  'Starting Pitching': '#FB4F14',
  'Bullpen': '#f59e0b',
  'Catcher': '#10b981',
  'Corner Infield': '#3b82f6',
  'Middle Infield': '#8b5cf6',
  'Outfield': '#14b8a6',
  'DH': '#94a3b8',
};

function getGroup(pos) {
  for (const [g, positions] of Object.entries(POS_GROUPS)) {
    if (positions.includes(pos)) return g;
  }
  return 'Other';
}

/* ── Semicircular Gauge ── */
function PayrollGauge({ payroll, threshold }) {
  const pct = Math.min((payroll / threshold) * 100, 130);
  const clampedPct = Math.min(pct, 100);
  const cx = 160, cy = 140, r = 110;
  const semiCirc = Math.PI * r;
  const valueSweep = (clampedPct / 100) * Math.PI;
  const polarToXY = (angle) => ({ x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) });
  const trackStart = polarToXY(Math.PI);
  const trackEnd = polarToXY(0);
  const valueEndAngle = Math.PI - valueSweep;
  const valueEnd = polarToXY(valueEndAngle);
  const trackPath = `M ${trackStart.x} ${trackStart.y} A ${r} ${r} 0 0 1 ${trackEnd.x} ${trackEnd.y}`;
  const valuePath = `M ${trackStart.x} ${trackStart.y} A ${r} ${r} 0 ${valueSweep > Math.PI ? 1 : 0} 1 ${valueEnd.x} ${valueEnd.y}`;
  const isOver = payroll > threshold;
  const gaugeColor = isOver ? '#ff6b35' : pct > 85 ? '#facc15' : '#00C853';

  return (
    <svg width="320" height="160" viewBox="0 0 320 160" style={{ overflow: 'visible' }}>
      <path d={trackPath} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="14" strokeLinecap="round" />
      <path d={valuePath} fill="none" stroke={gaugeColor} strokeWidth="14" strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 6px ${gaugeColor}88)` }} />
      <text x="160" y="105" textAnchor="middle" fill={gaugeColor} fontSize="28" fontWeight="900" fontFamily="'Oswald', sans-serif">
        ${payroll.toFixed(0)}M
      </text>
      <text x="160" y="128" textAnchor="middle" fill="#94A3B8" fontSize="11" fontFamily="'Oswald', sans-serif" letterSpacing="2">
        TOTAL PAYROLL
      </text>
      <text x="52" y="155" textAnchor="middle" fill="#475569" fontSize="9">$0</text>
      <text x="268" y="155" textAnchor="middle" fill="#475569" fontSize="9">${threshold}M</text>
    </svg>
  );
}

export default function MLBPayrollPage() {
  const { roster, payroll, cbt, cutPlayers, currentTeamAbbr, allTeams } = useMLBGame();

  const team = allTeams.find(t => t.abbreviation === currentTeamAbbr);

  const groupBreakdown = useMemo(() => {
    const groups = {};
    for (const g of Object.keys(POS_GROUPS)) {
      groups[g] = { players: [], total: 0 };
    }
    for (const p of roster) {
      const g = getGroup(p.position);
      if (!groups[g]) groups[g] = { players: [], total: 0 };
      groups[g].players.push(p);
      groups[g].total += p.salary;
    }
    return groups;
  }, [roster]);

  const releasedPayroll = cutPlayers.reduce((s, p) => s + (p.buyout || 0), 0);

  const secondCBT = computeCBT(payroll + 20); // show what happens if they add $20M

  const sortedByPayroll = [...roster].sort((a, b) => b.salary - a.salary);

  return (
    <div style={{ color: '#E2E8F0' }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: '0 0 4px', fontFamily: "'Oswald', sans-serif", fontSize: 22, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Payroll & Luxury Tax
        </h2>
        <div style={{ color: '#94A3B8', fontSize: 13 }}>{team?.city} {team?.name} &bull; 2025 Season</div>
      </div>

      {/* Two-column layout: gauge + CBT tiers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        {/* Gauge */}
        <div style={{ background: 'rgba(30,41,59,0.5)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <PayrollGauge payroll={payroll} threshold={CBT_THRESHOLDS.first} />
          <div style={{ marginTop: 8, textAlign: 'center' }}>
            <div style={{ color: cbt.tier > 0 ? cbt.color : '#4ade80', fontSize: 14, fontWeight: 700 }}>
              {cbt.tier > 0 ? `CBT Tax: $${cbt.penaltyAmt.toFixed(1)}M` : `$${(CBT_THRESHOLDS.first - payroll).toFixed(1)}M under CBT`}
            </div>
            <div style={{ color: '#94A3B8', fontSize: 11, marginTop: 2 }}>{cbt.label}</div>
          </div>
        </div>

        {/* CBT Tier breakdown */}
        <div style={{ background: 'rgba(30,41,59,0.5)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '16px' }}>
          <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12, color: '#94A3B8' }}>
            CBT Thresholds
          </div>
          {[
            { label: '1st Threshold', value: CBT_THRESHOLDS.first, rate: '20%/30%', color: '#facc15' },
            { label: '2nd Threshold', value: CBT_THRESHOLDS.second, rate: '32%/42%', color: '#fb923c' },
            { label: '3rd Threshold', value: CBT_THRESHOLDS.third, rate: '62.5%/95%', color: '#ef4444' },
            { label: '4th Threshold', value: CBT_THRESHOLDS.fourth, rate: '+80% surtax', color: '#dc2626' },
          ].map(tier => {
            const isPast = payroll >= tier.value;
            const isNext = !isPast && payroll < tier.value;
            return (
              <div key={tier.label} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 10px', borderRadius: 6, marginBottom: 6,
                background: isPast ? tier.color + '18' : 'rgba(15,23,42,0.4)',
                border: `1px solid ${isPast ? tier.color + '44' : isNext ? tier.color + '22' : 'rgba(255,255,255,0.05)'}`,
              }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: isPast ? tier.color : '#94A3B8' }}>{tier.label}</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>{tier.rate} (new/repeat offender)</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 14, fontWeight: 900, color: isPast ? tier.color : '#475569' }}>${tier.value}M</div>
                  {isNext && <div style={{ fontSize: 10, color: tier.color }}>+${(tier.value - payroll).toFixed(1)}M away</div>}
                  {isPast && <div style={{ fontSize: 10, color: tier.color }}>EXCEEDED</div>}
                </div>
              </div>
            );
          })}
          <div style={{ fontSize: 10, color: '#475569', marginTop: 8, lineHeight: 1.5 }}>
            Rates shown: first-time offender / repeat offender. Teams lose draft pick compensation rights when over threshold.
          </div>
        </div>
      </div>

      {/* Position group breakdown */}
      <div style={{ background: 'rgba(30,41,59,0.5)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '16px', marginBottom: 16 }}>
        <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12, color: '#94A3B8' }}>
          Payroll by Position Group
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Object.entries(groupBreakdown)
            .filter(([, g]) => g.total > 0)
            .sort(([, a], [, b]) => b.total - a.total)
            .map(([groupName, g]) => {
              const pct = payroll > 0 ? (g.total / payroll) * 100 : 0;
              const color = GROUP_COLORS[groupName] || '#64748b';
              return (
                <div key={groupName}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 13, color: '#CBD5E1', fontWeight: 600 }}>{groupName}</span>
                    <span style={{ fontSize: 13, color: '#E2E8F0', fontWeight: 700 }}>${g.total.toFixed(1)}M <span style={{ color: '#64748b', fontWeight: 400 }}>({pct.toFixed(0)}%)</span></span>
                  </div>
                  <div style={{ height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.3s', boxShadow: `0 0 6px ${color}66` }} />
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* Top contracts */}
      <div style={{ background: 'rgba(30,41,59,0.5)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '16px', marginBottom: 16 }}>
        <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12, color: '#94A3B8' }}>
          Top Contracts
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sortedByPayroll.slice(0, 10).map((p, i) => (
            <div key={p.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 12px', borderRadius: 6,
              background: i === 0 ? 'rgba(251,191,36,0.08)' : 'rgba(15,23,42,0.4)',
              border: `1px solid ${i === 0 ? 'rgba(251,191,36,0.2)' : 'rgba(255,255,255,0.05)'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ color: '#475569', fontSize: 12, minWidth: 20, textAlign: 'right' }}>{i + 1}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#E2E8F0' }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{p.position} &bull; {p.contractYears}yr left</div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 15, fontWeight: 900, color: p.salary >= 30 ? '#fbbf24' : '#E2E8F0' }}>${p.salary.toFixed(1)}M/yr</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>${(p.salary * p.contractYears).toFixed(0)}M total</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Released players (dead money equivalent) */}
      {cutPlayers.length > 0 && (
        <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12, padding: '16px' }}>
          <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12, color: '#ef4444' }}>
            Released / Buyouts
          </div>
          {cutPlayers.map(p => (
            <div key={p.id + '-cut'} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(239,68,68,0.1)', fontSize: 13 }}>
              <span style={{ color: '#94A3B8' }}>{p.name} ({p.position})</span>
              <span style={{ color: '#ef4444' }}>-${(p.buyout || 0).toFixed(1)}M/yr buyout</span>
            </div>
          ))}
          <div style={{ marginTop: 10, fontSize: 14, fontWeight: 700, color: '#ef4444' }}>
            Total buyouts: ${releasedPayroll.toFixed(1)}M
          </div>
        </div>
      )}
    </div>
  );
}

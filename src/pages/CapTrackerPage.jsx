import React, { useMemo } from 'react';
import { useGame } from '../context/GameContext';
import PredictionMarkets from '../components/PredictionMarkets';
import { deadCapCharges as bengalsDeadCap } from '../data/bengalsRoster';
import { teamDeadCaps } from '../data/teamDeadCaps';

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

/* ---- Semicircular Gauge Component ---- */
function CapGauge({ capUsed, totalCap, capAvailable, isOverCap }) {
  const pct = Math.min((capUsed / totalCap) * 100, 120); // allow up to 120% visual
  const clampedPct = Math.min(pct, 100);

  // SVG arc math  (semicircle from left to right)
  const cx = 160, cy = 140, r = 110;
  const startAngle = Math.PI;        // left side (180 deg)
  const endAngle = 0;                // right side (0 deg)
  const totalArc = Math.PI;          // 180 degrees

  // Circumference of the semicircle
  const semiCircumference = Math.PI * r;

  // For the value arc, compute how far around it goes
  const valueSweep = (clampedPct / 100) * totalArc;

  // Helper: polar to cartesian
  const polarToXY = (angle) => ({
    x: cx + r * Math.cos(angle),
    y: cy - r * Math.sin(angle),
  });

  // Background track path (full semicircle, left to right across the top)
  const trackStart = polarToXY(startAngle);
  const trackEnd = polarToXY(endAngle);
  const trackPath = `M ${trackStart.x} ${trackStart.y} A ${r} ${r} 0 0 1 ${trackEnd.x} ${trackEnd.y}`;

  // Value arc path
  const valueEndAngle = startAngle - valueSweep;
  const valueEnd = polarToXY(valueEndAngle);
  const largeArc = valueSweep > Math.PI ? 1 : 0;
  const valuePath = `M ${trackStart.x} ${trackStart.y} A ${r} ${r} 0 ${largeArc} 1 ${valueEnd.x} ${valueEnd.y}`;

  // Color zones
  let gaugeColor = '#4ade80'; // green
  let glowColor = 'rgba(74, 222, 128, 0.4)';
  if (isOverCap) {
    gaugeColor = '#ff4444';
    glowColor = 'rgba(255, 68, 68, 0.5)';
  } else if (pct > 92) {
    gaugeColor = '#facc15';
    glowColor = 'rgba(250, 204, 21, 0.4)';
  } else if (pct > 80) {
    gaugeColor = '#fb923c';
    glowColor = 'rgba(251, 146, 60, 0.4)';
  }

  // Zone tick marks
  const zones = [
    { pct: 0, label: '$0' },
    { pct: 25, label: '' },
    { pct: 50, label: '' },
    { pct: 75, label: '' },
    { pct: 80, label: '80%' },
    { pct: 92, label: '92%' },
    { pct: 100, label: `$${totalCap}M` },
  ];

  return (
    <div style={{
      background: '#0f172a',
      borderRadius: 16,
      padding: '24px 20px 16px',
      marginBottom: 16,
      border: isOverCap ? '1px solid rgba(255,68,68,0.4)' : '1px solid rgba(0,240,255,0.12)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Subtle background glow */}
      <div style={{
        position: 'absolute',
        top: 0, left: '50%',
        transform: 'translateX(-50%)',
        width: 300, height: 200,
        background: `radial-gradient(ellipse at center, ${glowColor.replace('0.4', '0.06')}, transparent 70%)`,
        pointerEvents: 'none',
      }} />

      <div style={{ textAlign: 'center', marginBottom: 4 }}>
        <h2 style={{
          margin: 0, fontSize: 18,
          color: 'var(--bengals-orange)',
          fontFamily: "'Oswald', sans-serif",
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}>2026 Salary Cap</h2>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', position: 'relative' }}>
        <svg viewBox="0 0 320 160" style={{ width: '100%', maxWidth: 380, height: 'auto' }}>
          <defs>
            <filter id="gaugeGlow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            {/* Zone color gradient on the track */}
            <linearGradient id="zoneGradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(74,222,128,0.15)" />
              <stop offset="75%" stopColor="rgba(74,222,128,0.15)" />
              <stop offset="85%" stopColor="rgba(250,204,21,0.15)" />
              <stop offset="92%" stopColor="rgba(255,68,68,0.15)" />
              <stop offset="100%" stopColor="rgba(255,68,68,0.15)" />
            </linearGradient>
          </defs>

          {/* Background color zones (thin fills) */}
          {/* Green zone 0-80% */}
          {(() => {
            const zStart = polarToXY(startAngle);
            const zEndAngle = startAngle - 0.80 * totalArc;
            const zEnd = polarToXY(zEndAngle);
            return <path d={`M ${zStart.x} ${zStart.y} A ${r} ${r} 0 0 1 ${zEnd.x} ${zEnd.y}`}
              fill="none" stroke="rgba(74,222,128,0.12)" strokeWidth="18" strokeLinecap="butt" />;
          })()}
          {/* Yellow zone 80-92% */}
          {(() => {
            const zStartAngle = startAngle - 0.80 * totalArc;
            const zStart = polarToXY(zStartAngle);
            const zEndAngle = startAngle - 0.92 * totalArc;
            const zEnd = polarToXY(zEndAngle);
            return <path d={`M ${zStart.x} ${zStart.y} A ${r} ${r} 0 0 1 ${zEnd.x} ${zEnd.y}`}
              fill="none" stroke="rgba(250,204,21,0.12)" strokeWidth="18" strokeLinecap="butt" />;
          })()}
          {/* Red zone 92-100% */}
          {(() => {
            const zStartAngle = startAngle - 0.92 * totalArc;
            const zStart = polarToXY(zStartAngle);
            const zEnd = polarToXY(endAngle);
            return <path d={`M ${zStart.x} ${zStart.y} A ${r} ${r} 0 0 1 ${zEnd.x} ${zEnd.y}`}
              fill="none" stroke="rgba(255,68,68,0.12)" strokeWidth="18" strokeLinecap="butt" />;
          })()}

          {/* Background track */}
          <path d={trackPath} fill="none" stroke="rgba(0,240,255,0.08)" strokeWidth="18" strokeLinecap="round" />

          {/* Value arc */}
          <path d={valuePath} fill="none" stroke={gaugeColor} strokeWidth="14"
            strokeLinecap="round" filter="url(#gaugeGlow)"
            style={{ transition: 'all 0.6s ease-out' }} />

          {/* Zone tick marks */}
          {[80, 92].map(z => {
            const tickAngle = startAngle - (z / 100) * totalArc;
            const inner = { x: cx + (r - 14) * Math.cos(tickAngle), y: cy - (r - 14) * Math.sin(tickAngle) };
            const outer = { x: cx + (r + 14) * Math.cos(tickAngle), y: cy - (r + 14) * Math.sin(tickAngle) };
            return (
              <g key={z}>
                <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
                  stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
                <text x={outer.x} y={outer.y - 6} fill="rgba(255,255,255,0.35)"
                  textAnchor="middle" fontSize="8" fontFamily="Inter, sans-serif">{z}%</text>
              </g>
            );
          })}

          {/* Center text */}
          <text x={cx} y={cy - 30} textAnchor="middle" fill={gaugeColor}
            fontSize="32" fontWeight="800" fontFamily="Oswald, sans-serif"
            style={{ filter: `drop-shadow(0 0 8px ${glowColor})` }}>
            {pct.toFixed(1)}%
          </text>
          <text x={cx} y={cy - 10} textAnchor="middle" fill="rgba(255,255,255,0.5)"
            fontSize="10" fontFamily="Inter, sans-serif">
            CAP UTILIZED
          </text>

          {/* Left / Right labels */}
          <text x={trackStart.x - 4} y={trackStart.y + 14} textAnchor="start"
            fill="rgba(255,255,255,0.3)" fontSize="9" fontFamily="Inter, sans-serif">$0</text>
          <text x={trackEnd.x + 4} y={trackEnd.y + 14} textAnchor="end"
            fill="rgba(255,255,255,0.3)" fontSize="9" fontFamily="Inter, sans-serif">${totalCap}M</text>
        </svg>
      </div>

      {/* Summary numbers below gauge */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: 32,
        marginTop: 4,
        flexWrap: 'wrap',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#94A3B8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cap Used</div>
          <div style={{ color: '#fff', fontSize: 20, fontWeight: 800, fontFamily: "'Oswald', sans-serif" }}>
            ${capUsed.toFixed(1)}M
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#94A3B8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Available</div>
          <div style={{
            color: isOverCap ? '#ff4444' : '#4ade80',
            fontSize: 20, fontWeight: 800, fontFamily: "'Oswald', sans-serif",
          }}>
            {isOverCap ? `-$${(capUsed - totalCap).toFixed(1)}M` : `$${capAvailable.toFixed(1)}M`}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#94A3B8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Cap</div>
          <div style={{ color: '#CBD5E1', fontSize: 20, fontWeight: 800, fontFamily: "'Oswald', sans-serif" }}>
            ${totalCap}M
          </div>
        </div>
      </div>

      {isOverCap && (
        <div style={{
          marginTop: 16,
          background: 'rgba(255,68,68,0.1)',
          border: '1px solid rgba(255,68,68,0.3)',
          borderRadius: 8,
          padding: '10px 14px',
          color: '#ff6b6b',
          fontSize: 13,
          textAlign: 'center',
          fontWeight: 600,
        }}>
          You are ${(capUsed - totalCap).toFixed(1)}M over the salary cap. Cut or restructure contracts to become compliant.
        </div>
      )}
    </div>
  );
}

export default function CapTrackerPage() {
  const { roster, cutPlayers, capUsed, capAvailable, totalCap, currentTeamAbbr } = useGame();
  // Use team-specific dead cap data; fall back to hardcoded Bengals data for CIN
  const deadCapCharges = teamDeadCaps[currentTeamAbbr] || (currentTeamAbbr === 'CIN' ? bengalsDeadCap : []);
  const isOverCap = capUsed > totalCap;

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
      .filter(p => !p.isFranchise && p.capSavings > 0)
      .sort((a, b) => b.capSavings - a.capSavings)
      .slice(0, 8)
      .map(p => ({
        player: p.name,
        position: p.position,
        savings: p.capSavings,
        savingsFormatted: p.capSavings.toFixed(1),
        deadMoney: (p.deadMoney || 0).toFixed(1),
        capHit: p.capHit,
        netSavings: p.capSavings - (p.deadMoney || 0),
      }));
  }, [roster]);

  const totalPotentialSavings = suggestions.reduce((sum, s) => sum + s.savings, 0);

  const preExistingDeadCap = deadCapCharges.reduce((s, d) => s + d.amount, 0);
  const userDeadCap = cutPlayers.reduce((s, p) => s + (p.deadCap || 0), 0);
  const deadCapTotal = preExistingDeadCap + userDeadCap;

  // Sorted position groups for the improved breakdown
  const sortedGroups = useMemo(() =>
    Object.entries(byGroup).sort(([, a], [, b]) => b.total - a.total),
    [byGroup]
  );
  const maxGroupSpend = sortedGroups.length > 0 ? sortedGroups[0][1].total : 1;

  return (
    <div>
      <h1 style={{ margin: '0 0 16px', fontSize: 22, color: 'var(--bengals-orange)' }}>Cap Tracker</h1>

      {/* Semicircular Cap Gauge */}
      <CapGauge capUsed={capUsed} totalCap={totalCap} capAvailable={capAvailable} isOverCap={isOverCap} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: 16 }}>
        {/* Position Breakdown - Enhanced */}
        <div style={{ background: '#0f172a', borderRadius: 12, padding: 20, border: '1px solid rgba(0,240,255,0.12)' }}>
          <h3 style={{
            margin: '0 0 6px', color: '#fff', fontSize: 16,
            fontFamily: "'Oswald', sans-serif", textTransform: 'uppercase', letterSpacing: '0.03em',
          }}>By Position Group</h3>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 14 }}>
            Spending distribution across {Object.keys(byGroup).length} position groups
          </div>
          {sortedGroups.map(([group, data]) => {
              const pctOfCap = (data.total / capUsed) * 100;
              const pctOfMax = (data.total / maxGroupSpend) * 100;
              const color = GROUP_COLORS[group] || '#94A3B8';
              const playerCount = data.players.length;
              return (
                <div key={group} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        width: 10, height: 10, borderRadius: 2,
                        background: color,
                        boxShadow: `0 0 6px ${color}40`,
                      }} />
                      <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{group}</span>
                      <span style={{ color: '#64748b', fontSize: 11 }}>({playerCount})</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ color, fontSize: 13, fontWeight: 700 }}>${data.total.toFixed(1)}M</span>
                      <span style={{
                        color: '#94A3B8', fontSize: 11,
                        background: 'rgba(148,163,184,0.1)',
                        padding: '1px 6px', borderRadius: 8,
                      }}>{pctOfCap.toFixed(0)}%</span>
                    </div>
                  </div>
                  <div style={{
                    height: 10, background: 'rgba(0,240,255,0.06)', borderRadius: 5,
                    overflow: 'hidden', position: 'relative',
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${pctOfMax}%`,
                      background: `linear-gradient(90deg, ${color}dd, ${color})`,
                      borderRadius: 5,
                      transition: 'width 0.5s ease-out',
                      boxShadow: `0 0 8px ${color}30`,
                    }} />
                  </div>
                </div>
              );
            })}
        </div>

        {/* Top 10 Cap Hits */}
        <div style={{ background: '#0f172a', borderRadius: 12, padding: 20, border: '1px solid rgba(0,240,255,0.12)' }}>
          <h3 style={{
            margin: '0 0 16px', color: '#fff', fontSize: 16,
            fontFamily: "'Oswald', sans-serif", textTransform: 'uppercase', letterSpacing: '0.03em',
          }}>Top 10 Cap Hits</h3>
          {top10.map((p, i) => {
            const hitPct = (p.capHit / top10[0].capHit) * 100;
            return (
              <div key={p.id} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 0',
                borderBottom: '1px solid #1a2420',
                fontSize: 13,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                  <span style={{ color: '#64748b', width: 20 }}>#{i + 1}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: '#fff' }}>{p.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      <div style={{ color: '#94A3B8', fontSize: 11, width: 28 }}>{p.position}</div>
                      <div style={{
                        flex: 1, height: 3, background: 'rgba(0,240,255,0.06)',
                        borderRadius: 2, overflow: 'hidden', maxWidth: 80,
                      }}>
                        <div style={{
                          height: '100%', width: `${hitPct}%`,
                          background: 'var(--bengals-orange)',
                          borderRadius: 2,
                          transition: 'width 0.4s',
                        }} />
                      </div>
                    </div>
                  </div>
                </div>
                <span style={{ color: 'var(--bengals-orange)', fontWeight: 700 }}>${p.capHit.toFixed(1)}M</span>
              </div>
            );
          })}
        </div>

        {/* Dead Cap */}
        <div style={{ background: '#0f172a', borderRadius: 12, padding: 20, border: '1px solid rgba(0,240,255,0.12)' }}>
          <h3 style={{
            margin: '0 0 16px', color: '#fff', fontSize: 16,
            fontFamily: "'Oswald', sans-serif", textTransform: 'uppercase', letterSpacing: '0.03em',
          }}>
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
                <div style={{ color: '#CBD5E1' }}>{d.name}</div>
                <div style={{ color: '#94A3B8', fontSize: 11 }}>{d.reason}</div>
              </div>
              <span style={{ color: '#ff4444' }}>${d.amount.toFixed(1)}M</span>
            </div>
          ))}
          {cutPlayers.length === 0 && deadCapCharges.length === 0 ? (
            <p style={{ color: '#64748b', fontSize: 13 }}>No dead cap — no players have been cut.</p>
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
                  <div style={{ color: '#CBD5E1' }}>{p.name}</div>
                  <div style={{ color: '#94A3B8', fontSize: 11 }}>{p.position}</div>
                </div>
                <span style={{ color: '#ff4444' }}>${(p.deadCap || 0).toFixed(1)}M</span>
              </div>
            ))
          )}
        </div>

        {/* Suggestions - Enhanced */}
        <div style={{ background: '#0f172a', borderRadius: 12, padding: 20, border: '1px solid rgba(0,240,255,0.12)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <h3 style={{
              margin: 0, color: '#fff', fontSize: 16,
              fontFamily: "'Oswald', sans-serif", textTransform: 'uppercase', letterSpacing: '0.03em',
            }}>Cap Suggestions</h3>
            {suggestions.length > 0 && (
              <span style={{
                color: '#4ade80', fontSize: 12, fontWeight: 700,
                background: 'rgba(74,222,128,0.1)',
                padding: '2px 8px', borderRadius: 8,
              }}>
                Up to ${totalPotentialSavings.toFixed(1)}M savings
              </span>
            )}
          </div>
          {suggestions.length > 0 && (
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 12 }}>
              Sorted by highest net cap savings (savings minus dead money)
            </div>
          )}
          {suggestions.map((s, idx) => {
            // Impact bar relative to the top suggestion
            const maxSavings = suggestions[0].savings;
            const impactPct = (s.savings / maxSavings) * 100;
            // Color-code by net savings amount
            const isHighImpact = s.netSavings > 8;
            const isMedImpact = s.netSavings > 3;
            const impactColor = isHighImpact ? '#4ade80' : isMedImpact ? '#facc15' : '#94A3B8';
            const impactLabel = isHighImpact ? 'HIGH' : isMedImpact ? 'MED' : 'LOW';

            return (
              <div key={s.player} style={{
                padding: '10px 0',
                borderBottom: idx < suggestions.length - 1 ? '1px solid #1a2420' : 'none',
                fontSize: 13,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      fontSize: 9, fontWeight: 700,
                      color: impactColor,
                      background: `${impactColor}15`,
                      padding: '1px 5px', borderRadius: 4,
                      letterSpacing: '0.04em',
                    }}>{impactLabel}</span>
                    <span style={{ color: '#CBD5E1' }}>
                      Cut <strong style={{ color: '#fff' }}>{s.player}</strong>
                    </span>
                    <span style={{ color: '#64748b', fontSize: 11 }}>({s.position})</span>
                  </div>
                </div>
                {/* Impact bar */}
                <div style={{
                  height: 4, background: 'rgba(0,240,255,0.06)', borderRadius: 2,
                  overflow: 'hidden', marginBottom: 5,
                }}>
                  <div style={{
                    height: '100%', width: `${impactPct}%`,
                    background: `linear-gradient(90deg, ${impactColor}aa, ${impactColor})`,
                    borderRadius: 2,
                    transition: 'width 0.4s',
                  }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <span style={{ color: '#4ade80', fontSize: 12 }}>
                      Save <strong>${s.savingsFormatted}M</strong>
                    </span>
                    <span style={{ color: '#ff6b6b', fontSize: 12 }}>
                      Dead cap: ${s.deadMoney}M
                    </span>
                  </div>
                  <span style={{
                    color: s.netSavings > 0 ? '#4ade80' : '#ff4444',
                    fontSize: 12, fontWeight: 700,
                  }}>
                    Net: ${s.netSavings.toFixed(1)}M
                  </span>
                </div>
              </div>
            );
          })}
          {suggestions.length === 0 && (
            <p style={{ color: '#64748b', fontSize: 13, marginTop: 8 }}>Your roster looks efficient!</p>
          )}
        </div>
      </div>

      <PredictionMarkets maxMarkets={3} />
    </div>
  );
}

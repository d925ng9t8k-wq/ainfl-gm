import React, { useMemo } from 'react';
import { useNbaGame } from '../../context/NbaGameContext';

const POS_GROUPS = {
  PG: ['PG'],
  SG: ['SG', 'G'],
  SF: ['SF', 'F', 'SF/PF'],
  PF: ['PF', 'F/C'],
  C: ['C'],
};

const GROUP_COLORS = {
  PG: '#00F0FF', SG: '#FFA500', SF: '#10b981', PF: '#8b5cf6', C: '#ec4899',
};

function getGroup(pos) {
  for (const [g, arr] of Object.entries(POS_GROUPS)) {
    if (arr.includes(pos)) return g;
  }
  return 'Other';
}

function CapBar({ label, value, max, color, sublabel }) {
  const pct = Math.min((value / max) * 100, 120);
  const displayPct = Math.min(pct, 100);
  const over = value > max;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: over ? '#FF6B00' : '#94A3B8', fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 12, color: over ? '#FF6B00' : '#FFA500', fontWeight: 700 }}>${value.toFixed(1)}M / ${max.toFixed(1)}M</span>
      </div>
      <div style={{ height: 10, background: 'rgba(255,255,255,0.05)', borderRadius: 5, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${displayPct}%`,
          background: over
            ? 'linear-gradient(90deg, #FF6B00, #FF9500)'
            : displayPct > 85
              ? 'linear-gradient(90deg, #facc15, #fbbf24)'
              : `linear-gradient(90deg, ${color}, ${color}BB)`,
          borderRadius: 5, transition: 'width 0.4s ease',
        }} />
      </div>
      {sublabel && <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{sublabel}</div>}
    </div>
  );
}

export default function NbaCapTrackerPage() {
  const {
    roster, totalCap, capAvailable, luxuryTax, firstApron, secondApron,
    overLuxuryTax, overFirstApron, overSecondApron, cutPlayers, allTeams, currentTeamAbbr,
  } = useNbaGame();

  const totalSalary = roster.reduce((s, p) => s + p.capHit, 0);
  const deadCapTotal = cutPlayers.reduce((s, p) => s + (p.deadCap || 0), 0);

  const groupBreakdown = useMemo(() => {
    const groups = {};
    for (const g of Object.keys(POS_GROUPS)) groups[g] = { players: [], total: 0 };
    groups['Other'] = { players: [], total: 0 };
    for (const p of roster) {
      const g = getGroup(p.position);
      if (!groups[g]) groups[g] = { players: [], total: 0 };
      groups[g].players.push(p);
      groups[g].total += p.capHit;
    }
    return groups;
  }, [roster]);

  const sortedByHit = [...roster].sort((a, b) => b.capHit - a.capHit);

  const _taxPenalty = overLuxuryTax ? (totalSalary - luxuryTax) * 1.5 : 0; // simplified tax calc

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#FFA500', fontFamily: "'Oswald', sans-serif", letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
          Salary Cap Tracker
        </div>
        <div style={{ fontSize: 13, color: '#64748B' }}>
          {allTeams.find(t => t.abbreviation === currentTeamAbbr)?.city} {allTeams.find(t => t.abbreviation === currentTeamAbbr)?.name} — 2025-26 Season
        </div>
      </div>

      {/* Cap threshold bars */}
      <div style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(255,160,0,0.1)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>Cap Thresholds</div>
        <CapBar label="Salary Cap ($154.6M)" value={totalSalary} max={totalCap} color="#FFA500" sublabel="Below this = full cap exception available" />
        <CapBar label="Luxury Tax Line ($187.9M)" value={totalSalary} max={luxuryTax} color="#FF6B35" sublabel="Above this = pay luxury tax to other teams" />
        <CapBar label="First Apron ($195.9M)" value={totalSalary} max={firstApron} color="#FF4500" sublabel="Above this = restricted in trades + no TPE" />
        <CapBar label="Second Apron ($207.8M)" value={totalSalary} max={secondApron} color="#FF2D55" sublabel="Above this = hard restrictions, no mid-level, capped trades" />
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total Payroll', value: `$${totalSalary.toFixed(1)}M`, color: '#FFA500' },
          { label: 'Cap Space', value: `$${capAvailable.toFixed(1)}M`, color: capAvailable < 0 ? '#FF2D55' : '#39FF14' },
          { label: 'Tax Overage', value: overLuxuryTax ? `$${(totalSalary - luxuryTax).toFixed(1)}M over` : 'Under tax', color: overLuxuryTax ? '#FF6B00' : '#64748B' },
          { label: 'Buyout Dead Cap', value: `$${deadCapTotal.toFixed(1)}M`, color: deadCapTotal > 0 ? '#ff4466' : '#64748B' },
          { label: 'Roster Size', value: `${roster.length} players`, color: roster.length < 13 ? '#FF2D55' : roster.length > 15 ? '#FF6B00' : '#94A3B8' },
          { label: 'Status', value: overSecondApron ? '2nd Apron' : overFirstApron ? '1st Apron' : overLuxuryTax ? 'Over Tax' : 'Under Tax', color: overSecondApron ? '#FF2D55' : overFirstApron ? '#FF4500' : overLuxuryTax ? '#FF6B00' : '#39FF14' },
        ].map(item => (
          <div key={item.label} style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{item.label}</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: item.color, fontFamily: "'Oswald', sans-serif" }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* NBA Cap Rules Info */}
      {(overLuxuryTax || overFirstApron) && (
        <div style={{ background: 'rgba(255,107,0,0.06)', border: '1px solid rgba(255,107,0,0.2)', borderRadius: 10, padding: 14, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#FF6B00', marginBottom: 8 }}>
            {overSecondApron ? 'SECOND APRON — Severe Restrictions' : overFirstApron ? 'FIRST APRON — Trade Restrictions' : 'LUXURY TAX — Additional Cost'}
          </div>
          <div style={{ fontSize: 12, color: '#94A3B8', lineHeight: 1.7 }}>
            {overSecondApron && '• Cannot use mid-level exception  •  Cannot take on more salary in trades than sent  •  Picks sent in trades can\'t come back for 7 years  •  No sign-and-trades'}
            {overFirstApron && !overSecondApron && '• No trade player exception (TPE)  •  Reduced trade absorption  •  No bi-annual exception  •  Cannot use mid-level exception in full'}
            {overLuxuryTax && !overFirstApron && '• Pay dollar-for-dollar tax on first $5M over  •  Escalating rates beyond  •  Repeater teams pay higher rates'}
          </div>
        </div>
      )}

      {/* Breakdown by position group */}
      <div style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(255,160,0,0.1)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>Salary by Position</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {Object.entries(groupBreakdown).filter(([, data]) => data.players.length > 0).map(([g, data]) => (
            <div key={g} style={{
              flex: 1, minWidth: 100, background: 'rgba(15,23,42,0.6)',
              border: `1px solid ${GROUP_COLORS[g] || '#94A3B8'}33`, borderRadius: 8, padding: '10px 12px',
            }}>
              <div style={{ fontSize: 10, color: GROUP_COLORS[g] || '#94A3B8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>{g}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#E2E8F0', fontFamily: "'Oswald', sans-serif" }}>${data.total.toFixed(1)}M</div>
              <div style={{ fontSize: 11, color: '#64748B' }}>{data.players.length} player{data.players.length !== 1 ? 's' : ''}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Full contract table */}
      <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: 'rgba(15,23,42,0.8)' }}>
            <tr>
              {['Player', 'Pos', 'Age', 'Salary', 'Years Left', 'Total Value', 'Type', 'Bird Rights'].map(h => (
                <th key={h} style={{ padding: '8px 8px', color: '#64748B', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedByHit.map((p, idx) => (
              <tr key={p.id} style={{ background: idx % 2 === 0 ? 'rgba(15,23,42,0.3)' : 'transparent', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <td style={{ padding: '8px 8px', fontWeight: 600, color: '#E2E8F0' }}>{p.name}</td>
                <td style={{ padding: '8px 8px', color: GROUP_COLORS[getGroup(p.position)] || '#94A3B8', fontWeight: 700, fontSize: 12 }}>{p.position}</td>
                <td style={{ padding: '8px 8px', color: '#64748B' }}>{p.age}</td>
                <td style={{ padding: '8px 8px', color: '#FFA500', fontWeight: 700 }}>${p.capHit.toFixed(1)}M</td>
                <td style={{ padding: '8px 8px', color: p.yearsRemaining === 0 ? '#FF2D55' : '#94A3B8' }}>
                  {p.yearsRemaining === 0 ? 'Expiring' : `${p.yearsRemaining}yr`}
                </td>
                <td style={{ padding: '8px 8px', color: '#64748B' }}>${((p.yearsRemaining + 1) * p.capHit).toFixed(1)}M</td>
                <td style={{ padding: '8px 8px' }}>
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600,
                    color: p.contractType === 'max' || p.contractType === 'supermax' ? '#FFD700' : p.contractType === 'rookie' ? '#00F0FF' : '#94A3B8',
                    background: p.contractType === 'max' || p.contractType === 'supermax' ? 'rgba(255,215,0,0.1)' : p.contractType === 'rookie' ? 'rgba(0,240,255,0.1)' : 'rgba(148,163,184,0.1)',
                    border: `1px solid ${p.contractType === 'max' || p.contractType === 'supermax' ? 'rgba(255,215,0,0.3)' : p.contractType === 'rookie' ? 'rgba(0,240,255,0.3)' : 'rgba(148,163,184,0.2)'}`,
                  }}>{p.contractType || 'mid'}</span>
                </td>
                <td style={{ padding: '8px 8px', color: p.birdRights ? '#10b981' : '#475569', fontSize: 12 }}>
                  {p.birdRights ? 'Full Bird' : 'None'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* NBA CBA Guide */}
      <div style={{ marginTop: 20, background: 'rgba(15,23,42,0.4)', border: '1px solid rgba(255,160,0,0.08)', borderRadius: 10, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#FFA500', marginBottom: 10, fontFamily: "'Oswald', sans-serif", letterSpacing: '0.06em' }}>NBA CBA QUICK REFERENCE</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, fontSize: 12, color: '#64748B', lineHeight: 1.7 }}>
          <div><strong style={{ color: '#94A3B8' }}>Bird Rights:</strong> Allows re-signing over the cap. Full Bird = 5+ yrs, Early Bird = 2-4 yrs.</div>
          <div><strong style={{ color: '#94A3B8' }}>Max Contracts:</strong> 0-6 yrs: ~$34M/yr. 7-9 yrs: ~$41M/yr. 10+ yrs: ~$49M/yr.</div>
          <div><strong style={{ color: '#94A3B8' }}>Supermax:</strong> 35% of salary cap (~$54M). Must meet performance criteria (All-NBA, MVP, DPOY).</div>
          <div><strong style={{ color: '#94A3B8' }}>Mid-Level Exception (MLE):</strong> ~$12.8M for tax-paying teams, ~$14.1M for non-tax teams.</div>
          <div><strong style={{ color: '#94A3B8' }}>Two-Way Contracts:</strong> Players split time between NBA and G League. Capped at 50 days in NBA.</div>
          <div><strong style={{ color: '#94A3B8' }}>Roster Size:</strong> 13-15 standard contracts. Max 15 active + 2 two-way = 17 total.</div>
        </div>
      </div>
    </div>
  );
}

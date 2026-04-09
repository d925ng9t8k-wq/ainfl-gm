import React from 'react';
import { useNbaGame } from '../../context/NbaGameContext';

const POS_COLORS = { PG: '#00F0FF', SG: '#FFA500', SF: '#10b981', PF: '#8b5cf6', C: '#ec4899' };

export default function NbaSummaryPage() {
  const {
    roster, signingHistory, tradeHistory, cutPlayers,
    capAvailable, luxuryTax, overLuxuryTax,
    allTeams, currentTeamAbbr, resetGame,
  } = useNbaGame();

  const currentTeamObj = allTeams.find(t => t.abbreviation === currentTeamAbbr);
  const totalSalary = roster.reduce((s, p) => s + p.capHit, 0);
  const tradeCount = tradeHistory.filter(t => t.type === 'trade').length;
  const draftCount = tradeHistory.filter(t => t.type === 'draft').length;
  const extensionCount = tradeHistory.filter(t => t.type === 'extension').length;
  const cutCount = tradeHistory.filter(t => t.type === 'cut').length;
  const _totalMoves = tradeCount + draftCount + extensionCount + cutCount + signingHistory.length;
  const deadCap = cutPlayers.reduce((s, p) => s + (p.deadCap || 0), 0);

  // Team rating
  const sorted = [...roster].sort((a, b) => (b.rating || 70) - (a.rating || 70));
  const top8 = sorted.slice(0, 8);
  const avgRating = top8.length > 0 ? Math.round(top8.reduce((s, p) => s + (p.rating || 70), 0) / top8.length) : 70;
  const stars = roster.filter(p => (p.rating || 70) >= 90);
  const starters = roster.filter(p => (p.rating || 70) >= 80);

  // Grade the GM
  let grade = 'C';
  let gradeColor = '#FFA500';
  let gradeComment = '';
  if (avgRating >= 88) { grade = 'A+'; gradeColor = '#FFD700'; gradeComment = 'Elite roster — championship window is open.'; }
  else if (avgRating >= 84) { grade = 'A'; gradeColor = '#10b981'; gradeComment = 'Contending team. Push for a Finals run.'; }
  else if (avgRating >= 80) { grade = 'B+'; gradeColor = '#10b981'; gradeComment = 'Solid playoff team. Build around your stars.'; }
  else if (avgRating >= 76) { grade = 'B'; gradeColor = '#FFA500'; gradeComment = 'Play-in team. Fill key gaps in free agency.'; }
  else if (avgRating >= 72) { grade = 'C+'; gradeColor = '#FFA500'; gradeComment = 'Developing roster. Draft well and be patient.'; }
  else if (avgRating >= 68) { grade = 'C'; gradeColor = '#94A3B8'; gradeComment = 'Rebuilding. Tank for lottery picks.'; }
  else { grade = 'D'; gradeColor = '#FF2D55'; gradeComment = 'Full rebuild mode. Trade veterans for assets.'; }

  if (overLuxuryTax) { grade += '(Tax)'; gradeComment += ' Warning: over luxury tax — significant cost.'; }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#FFA500', fontFamily: "'Oswald', sans-serif", letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
          GM Summary
        </div>
        <div style={{ fontSize: 13, color: '#64748B' }}>
          {currentTeamObj?.city} {currentTeamObj?.name} — 2025-26 Offseason Report
        </div>
      </div>

      {/* GM Grade */}
      <div style={{
        background: `linear-gradient(135deg, ${gradeColor}15, ${gradeColor}05)`,
        border: `1px solid ${gradeColor}44`, borderRadius: 12, padding: '20px 24px', marginBottom: 24,
        display: 'flex', alignItems: 'center', gap: 24,
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 52, fontWeight: 900, color: gradeColor, fontFamily: "'Oswald', sans-serif", lineHeight: 1 }}>{grade}</div>
          <div style={{ fontSize: 11, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 4 }}>GM Grade</div>
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#E2E8F0', marginBottom: 6 }}>{gradeComment}</div>
          <div style={{ fontSize: 13, color: '#64748B' }}>
            Team Rating: <strong style={{ color: gradeColor }}>{avgRating}</strong> &bull;
            Stars (90+): <strong style={{ color: '#FFD700' }}>{stars.length}</strong> &bull;
            Rotation Players (80+): <strong style={{ color: '#10b981' }}>{starters.length}</strong>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Roster Size', value: `${roster.length}/15`, color: roster.length >= 13 ? '#10b981' : '#FF2D55' },
          { label: 'Total Payroll', value: `$${totalSalary.toFixed(1)}M`, color: '#FFA500' },
          { label: 'Cap Space', value: `$${capAvailable.toFixed(1)}M`, color: capAvailable >= 0 ? '#39FF14' : '#FF2D55' },
          { label: 'Luxury Tax', value: overLuxuryTax ? `+$${(totalSalary - luxuryTax).toFixed(1)}M` : 'Under', color: overLuxuryTax ? '#FF6B00' : '#10b981' },
          { label: 'Free Agents Signed', value: signingHistory.length, color: '#10b981' },
          { label: 'Trades Made', value: tradeCount, color: '#3b82f6' },
          { label: 'Draft Picks Used', value: draftCount, color: '#8b5cf6' },
          { label: 'Extensions', value: extensionCount, color: '#FFA500' },
          { label: 'Players Waived', value: cutCount, color: '#FF2D55' },
          { label: 'Dead Cap', value: `$${deadCap.toFixed(1)}M`, color: deadCap > 5 ? '#FF2D55' : '#64748B' },
        ].map(item => (
          <div key={item.label} style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{item.label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: item.color, fontFamily: "'Oswald', sans-serif" }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* Top players */}
      <div style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(255,160,0,0.1)', borderRadius: 10, padding: 16, marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#FFA500', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14, fontFamily: "'Oswald', sans-serif" }}>Projected Starting Five</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {sorted.slice(0, 5).map(p => (
            <div key={p.id} style={{
              flex: 1, minWidth: 140, background: 'rgba(15,23,42,0.6)',
              border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: '10px 12px',
            }}>
              <div style={{ fontSize: 11, color: POS_COLORS[p.position] || '#94A3B8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>{p.position}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#E2E8F0' }}>{p.name}</div>
              <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                ${p.capHit.toFixed(1)}M &bull; {p.yearsRemaining === 0 ? 'Expiring' : `${p.yearsRemaining}yr left`}
              </div>
              <div style={{
                display: 'inline-block', marginTop: 6, padding: '2px 8px', borderRadius: 5, fontSize: 12, fontWeight: 700,
                background: (p.rating || 70) >= 90 ? 'rgba(255,215,0,0.15)' : (p.rating || 70) >= 80 ? 'rgba(16,185,129,0.15)' : 'rgba(255,165,0,0.15)',
                color: (p.rating || 70) >= 90 ? '#FFD700' : (p.rating || 70) >= 80 ? '#10b981' : '#FFA500',
                border: `1px solid ${(p.rating || 70) >= 90 ? 'rgba(255,215,0,0.3)' : (p.rating || 70) >= 80 ? 'rgba(16,185,129,0.3)' : 'rgba(255,165,0,0.3)'}`,
              }}>{p.rating || 70} OVR</div>
            </div>
          ))}
        </div>
      </div>

      {/* Move history */}
      {tradeHistory.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Offseason Moves</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[...tradeHistory].reverse().slice(0, 20).map(entry => {
              const colors = { trade: '#3b82f6', signing: '#10b981', cut: '#FF2D55', draft: '#8b5cf6', extension: '#FFA500' };
              const color = colors[entry.type] || '#94A3B8';
              return (
                <div key={entry.id} style={{
                  background: 'rgba(15,23,42,0.4)', border: `1px solid ${color}22`, borderLeft: `3px solid ${color}`,
                  borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#CBD5E1',
                }}>
                  <span style={{ color, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: 8 }}>{entry.type}</span>
                  {entry.description}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Reset */}
      <div style={{ marginTop: 24, padding: '16px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <button onClick={() => { if (window.confirm('Reset all NBA GM progress? This cannot be undone.')) resetGame(); }}
          style={{ padding: '8px 20px', background: 'rgba(255,45,85,0.1)', border: '1px solid rgba(255,45,85,0.2)', borderRadius: 6, color: '#ff4466', cursor: 'pointer', fontSize: 13 }}>
          Reset GM Progress
        </button>
      </div>
    </div>
  );
}

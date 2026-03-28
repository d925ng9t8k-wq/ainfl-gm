import React, { useMemo } from 'react';
import { useMLBGame, computeCBT } from '../../context/MLBGameContext';
import { CBT_THRESHOLDS } from '../../data/mlb/mlbTeams';

function gradeFromScore(score) {
  if (score >= 95) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 85) return 'A-';
  if (score >= 80) return 'B+';
  if (score >= 75) return 'B';
  if (score >= 70) return 'B-';
  if (score >= 65) return 'C+';
  if (score >= 60) return 'C';
  if (score >= 55) return 'C-';
  if (score >= 50) return 'D+';
  return 'D';
}

function gradeColor(grade) {
  if (grade.startsWith('A')) return '#4ade80';
  if (grade.startsWith('B')) return '#60a5fa';
  if (grade.startsWith('C')) return '#facc15';
  if (grade.startsWith('D')) return '#fb923c';
  return '#ef4444';
}

function computeGrades(signingHistory, tradeHistory, cutPlayers, roster, payroll) {
  // Free Agency Grade
  let faScore = 70;
  if (signingHistory.length > 0) {
    const avgRating = signingHistory.reduce((s, m) => s + (m.rating || 70), 0) / signingHistory.length;
    const avgAAV = signingHistory.reduce((s, m) => s + (m.aav || 5), 0) / signingHistory.length;
    const valueRatio = avgRating / Math.max(avgAAV * 1.5, 1);
    const valueScore = Math.min(20, valueRatio * 4);
    const volumeBonus = Math.min(10, signingHistory.length * 2);
    const overspendPenalty = avgAAV > 20 ? (avgAAV - 20) * 1.5 : 0;
    faScore = 55 + valueScore + volumeBonus - overspendPenalty;
  }

  // Trade Grade
  const trades = tradeHistory.filter(t => t.type === 'trade');
  let tradeScore = 72;
  if (trades.length > 0) {
    tradeScore = 70 + Math.min(15, trades.length * 3);
  }

  // Payroll Grade — under CBT is always positive, over CBT has penalties
  let payrollScore = 75;
  if (payroll <= CBT_THRESHOLDS.first * 0.75) payrollScore = 68; // way under = maybe not spending enough
  else if (payroll <= CBT_THRESHOLDS.first) payrollScore = 82;
  else if (payroll <= CBT_THRESHOLDS.second) payrollScore = 70;
  else payrollScore = 58;

  // Roster quality grade
  const avgRating = roster.length > 0 ? roster.reduce((s, p) => s + (p.rating || 70), 0) / roster.length : 70;
  const rosterScore = Math.min(95, 40 + avgRating * 0.7);

  const overall = Math.round((faScore + tradeScore + payrollScore + rosterScore) / 4);

  return {
    freeAgency: { grade: gradeFromScore(Math.round(faScore)), score: Math.round(faScore) },
    trades: { grade: gradeFromScore(Math.round(tradeScore)), score: Math.round(tradeScore) },
    payroll: { grade: gradeFromScore(Math.round(payrollScore)), score: Math.round(payrollScore) },
    rosterQuality: { grade: gradeFromScore(Math.round(rosterScore)), score: Math.round(rosterScore) },
    overall: { grade: gradeFromScore(overall), score: overall },
  };
}

function GradeCard({ label, grade, score }) {
  const color = gradeColor(grade);
  return (
    <div style={{ background: 'rgba(30,41,59,0.5)', border: `1px solid ${color}33`, borderRadius: 10, padding: '16px', textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 40, fontWeight: 900, fontFamily: "'Oswald', sans-serif", color, lineHeight: 1, marginBottom: 4 }}>{grade}</div>
      <div style={{ fontSize: 12, color: '#64748b' }}>{score}/100</div>
    </div>
  );
}

export default function MLBSummaryPage() {
  const { roster, payroll, cbt, signingHistory, tradeHistory, cutPlayers, currentTeamAbbr, allTeams } = useMLBGame();

  const team = allTeams.find(t => t.abbreviation === currentTeamAbbr);
  const grades = useMemo(() => computeGrades(signingHistory, tradeHistory, cutPlayers, roster, payroll), [signingHistory, tradeHistory, cutPlayers, roster, payroll]);

  const totalMoves = signingHistory.length + tradeHistory.filter(t => t.type === 'trade').length + cutPlayers.length;
  const topPlayers = [...roster].sort((a, b) => b.rating - a.rating).slice(0, 5);
  const topContracts = [...roster].sort((a, b) => b.salary - a.salary).slice(0, 5);

  return (
    <div style={{ color: '#E2E8F0' }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: '0 0 4px', fontFamily: "'Oswald', sans-serif", fontSize: 22, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Offseason Report Card
        </h2>
        <div style={{ color: '#94A3B8', fontSize: 13 }}>
          {team?.city} {team?.name} &bull; {totalMoves} total moves
        </div>
      </div>

      {/* Overall Grade (big card) */}
      <div style={{
        background: `linear-gradient(135deg, ${gradeColor(grades.overall.grade)}18, rgba(30,41,59,0.6))`,
        border: `2px solid ${gradeColor(grades.overall.grade)}44`,
        borderRadius: 14, padding: '24px', textAlign: 'center', marginBottom: 20,
      }}>
        <div style={{ fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Overall GM Grade</div>
        <div style={{ fontSize: 72, fontWeight: 900, fontFamily: "'Oswald', sans-serif", color: gradeColor(grades.overall.grade), lineHeight: 1 }}>{grades.overall.grade}</div>
        <div style={{ fontSize: 16, color: '#94A3B8', marginTop: 6 }}>{grades.overall.score}/100</div>
      </div>

      {/* Individual Grades */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        <GradeCard label="Free Agency" grade={grades.freeAgency.grade} score={grades.freeAgency.score} />
        <GradeCard label="Trades" grade={grades.trades.grade} score={grades.trades.score} />
        <GradeCard label="Payroll Mgmt" grade={grades.payroll.grade} score={grades.payroll.score} />
        <GradeCard label="Roster Quality" grade={grades.rosterQuality.grade} score={grades.rosterQuality.score} />
      </div>

      {/* Two-column: top players + payroll */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
        {/* Top Players */}
        <div style={{ background: 'rgba(30,41,59,0.5)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '14px' }}>
          <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10, color: '#94A3B8' }}>
            Top Players by Rating
          </div>
          {topPlayers.map((p, i) => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: i < topPlayers.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#475569', fontSize: 12, minWidth: 16 }}>{i + 1}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#E2E8F0' }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{p.position}</div>
                </div>
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, color: p.rating >= 90 ? '#fbbf24' : p.rating >= 80 ? '#4ade80' : '#94A3B8' }}>
                {p.rating}
              </div>
            </div>
          ))}
        </div>

        {/* Top Contracts */}
        <div style={{ background: 'rgba(30,41,59,0.5)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '14px' }}>
          <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10, color: '#94A3B8' }}>
            Biggest Contracts
          </div>
          {topContracts.map((p, i) => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: i < topContracts.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#475569', fontSize: 12, minWidth: 16 }}>{i + 1}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#E2E8F0' }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{p.position} &bull; {p.contractYears}yr</div>
                </div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: p.salary >= 30 ? '#fbbf24' : '#E2E8F0' }}>
                ${p.salary.toFixed(1)}M
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Payroll summary */}
      <div style={{ background: 'rgba(30,41,59,0.5)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '14px', marginBottom: 16 }}>
        <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10, color: '#94A3B8' }}>
          Payroll Summary
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          {[
            { label: 'Total Payroll', value: `$${payroll.toFixed(1)}M` },
            { label: 'CBT Threshold', value: `$${CBT_THRESHOLDS.first}M` },
            { label: 'CBT Status', value: cbt.label, color: cbt.color },
            { label: 'Tax Bill', value: cbt.penaltyAmt > 0 ? `$${cbt.penaltyAmt.toFixed(1)}M` : '$0', color: cbt.penaltyAmt > 0 ? '#ef4444' : '#4ade80' },
          ].map(item => (
            <div key={item.label} style={{ background: 'rgba(15,23,42,0.5)', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{item.label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: item.color || '#E2E8F0', marginTop: 3 }}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Move History */}
      {totalMoves > 0 && (
        <div style={{ background: 'rgba(30,41,59,0.5)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '14px' }}>
          <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10, color: '#94A3B8' }}>
            Moves Log
          </div>
          {[...signingHistory.map(s => ({
            type: 'signing', text: `Signed ${s.player} — ${s.years}yr / $${s.aav.toFixed(1)}M AAV`,
            timestamp: s.timestamp,
          })), ...tradeHistory.map(t => ({
            type: t.type, text: t.description, timestamp: t.timestamp,
          })), ...cutPlayers.map(p => ({
            type: 'release', text: `Released ${p.name} (${p.position})`,
            timestamp: p.releaseDate || '',
          }))]
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, 10)
            .map((m, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3, flexShrink: 0, marginTop: 1,
                  background: m.type === 'signing' ? 'rgba(74,222,128,0.15)' : m.type === 'trade' ? 'rgba(59,130,246,0.15)' : 'rgba(239,68,68,0.15)',
                  color: m.type === 'signing' ? '#4ade80' : m.type === 'trade' ? '#60a5fa' : '#ef4444',
                }}>
                  {m.type.toUpperCase()}
                </span>
                <span style={{ fontSize: 12, color: '#94A3B8', flex: 1 }}>{m.text}</span>
              </div>
            ))}
        </div>
      )}

      {totalMoves === 0 && (
        <div style={{ textAlign: 'center', padding: 32, color: '#475569', background: 'rgba(30,41,59,0.3)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ fontSize: 13 }}>No moves made yet. Go sign free agents, make trades, or release players to build your team.</div>
        </div>
      )}
    </div>
  );
}

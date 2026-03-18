import React, { useRef, useState, useMemo } from 'react';
import { toPng } from 'html-to-image';
import { useGame } from '../context/GameContext';
import { computeBaselineGrade, preseasonMoves } from '../data/offseasonMoves';

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
  if (score >= 45) return 'D';
  return 'F';
}

function gradeColor(grade) {
  if (grade.startsWith('A')) return '#4ade80';
  if (grade.startsWith('B')) return '#60a5fa';
  if (grade.startsWith('C')) return '#facc15';
  if (grade.startsWith('D')) return '#fb923c';
  return '#ef4444';
}

// Realistic grading: quality over quantity, cap efficiency, roster balance
function computeGrades(signingHistory, tradeHistory, draftedPlayers, cutPlayers, roster, capUsed, totalCap, baselineScore = 60) {
  // ─── FREE AGENCY GRADE ───
  // Factors: value of signings (rating vs cost), cap efficiency, filling needs
  let faScore = 70; // base: average
  if (signingHistory.length > 0) {
    // Value metric: avg rating of signed players relative to AAV spent
    const avgRating = signingHistory.reduce((s, m) => s + (m.rating || 70), 0) / signingHistory.length;
    const avgAAV = signingHistory.reduce((s, m) => s + (m.aav || 5), 0) / signingHistory.length;

    // Good value = high rating for low cost. 80+ rating at <$10M = great deal
    const valueRatio = avgRating / Math.max(avgAAV * 2, 1); // higher = better value
    const valueScore = Math.min(20, valueRatio * 5);

    // Volume bonus: 1-3 signings = modest, 4-6 = good, 7+ = aggressive
    const volumeBonus = Math.min(10, signingHistory.length * 2);

    // Overspend penalty: if avg AAV > $15M, you're overpaying
    const overspendPenalty = avgAAV > 15 ? (avgAAV - 15) * 1.5 : 0;

    faScore = 55 + valueScore + volumeBonus - overspendPenalty;
  } else {
    faScore = 60; // did nothing in FA = below average
  }

  // ─── TRADE GRADE ───
  // Factors: net value gained/lost in trades, cap impact
  const trades = tradeHistory.filter(t => t.type === 'trade');
  let tradeScore = 72; // default: decent (no trades = you stood pat, not bad)
  if (trades.length > 0) {
    // Activity bonus
    tradeScore = 65 + Math.min(10, trades.length * 3);

    // Cut analysis: smart cuts save cap, bad cuts waste dead money
    const cuts = tradeHistory.filter(t => t.type === 'cut');
    if (cuts.length > 0) {
      const totalDeadCap = cutPlayers.reduce((s, p) => s + (p.deadCap || 0), 0);
      const totalSavings = cutPlayers.reduce((s, p) => s + ((p.capHit || 0) - (p.deadCap || 0)), 0);
      // Good cuts: high savings relative to dead cap
      if (totalSavings > totalDeadCap) tradeScore += 5;
      else if (totalDeadCap > totalSavings * 3) tradeScore -= 10; // terrible cuts
    }

    // Restructure analysis
    const restructures = tradeHistory.filter(t => t.type === 'restructure');
    tradeScore += Math.min(8, restructures.length * 2); // restructures show cap savvy
  }

  // ─── DRAFT GRADE ───
  // Uses same formula as DraftPage for consistency
  let draftScore = 70;
  let draftLetter = 'C'; // default if no picks
  if (draftedPlayers.length > 0) {
    const avgGrade = draftedPlayers.reduce((s, p) => s + (p.grade || 60), 0) / draftedPlayers.length;
    const avgPick = draftedPlayers.reduce((s, p) => s + (p.pickNumber || 100), 0) / draftedPlayers.length;
    // Same formula as DraftPage.draftGradeLetter:
    const bonus = avgGrade - (100 - avgPick * 0.5);
    if (bonus >= 20) { draftLetter = 'A+'; draftScore = 97; }
    else if (bonus >= 15) { draftLetter = 'A'; draftScore = 92; }
    else if (bonus >= 10) { draftLetter = 'A-'; draftScore = 87; }
    else if (bonus >= 5) { draftLetter = 'B+'; draftScore = 82; }
    else if (bonus >= 0) { draftLetter = 'B'; draftScore = 77; }
    else if (bonus >= -5) { draftLetter = 'B-'; draftScore = 72; }
    else if (bonus >= -10) { draftLetter = 'C+'; draftScore = 67; }
    else if (bonus >= -15) { draftLetter = 'C'; draftScore = 62; }
    else if (bonus >= -20) { draftLetter = 'C-'; draftScore = 57; }
    else if (bonus >= -25) { draftLetter = 'D'; draftScore = 47; }
    else { draftLetter = 'F'; draftScore = 40; }

    // Wider grade spread: apply avgValue * 2.0 multiplier
    const avgValue = avgGrade / 100;
    draftScore = Math.round(draftScore * (1 + (avgValue * 2.0 - 1) * 0.15));

    // Per-pick reach/steal penalties/bonuses
    let pickAdjust = 0;
    draftedPlayers.forEach(p => {
      const pickNum = p.pickNumber || 0;
      const expectedGrade = Math.max(35, 95 - pickNum * 0.32);
      const diff = (p.grade || 60) - expectedGrade;
      if (diff < -15) pickAdjust -= 5;  // reach penalty
      if (diff > 15) pickAdjust += 3;   // steal bonus
    });
    draftScore = Math.max(30, Math.min(99, draftScore + pickAdjust));
    draftLetter = gradeFromScore(draftScore);
  }

  // ─── CAP MANAGEMENT BONUS/PENALTY ───
  const capSpace = totalCap - capUsed;
  let capBonus = 0;
  if (capSpace < 0) capBonus = -10; // over the cap = big penalty
  else if (capSpace < 5) capBonus = -3; // dangerously tight
  else if (capSpace > 50) capBonus = -5; // too much unused space = not aggressive enough
  else if (capSpace >= 10 && capSpace <= 35) capBonus = 5; // sweet spot

  // ─── ROSTER BALANCE ───
  // Check if key positions are filled (at least 1 QB, 2 WR, etc.)
  let balanceBonus = 0;
  const posCount = {};
  roster.forEach(p => { posCount[p.position] = (posCount[p.position] || 0) + 1; });
  if ((posCount['QB'] || 0) >= 2) balanceBonus += 2;
  if ((posCount['WR'] || 0) >= 4) balanceBonus += 2;
  if ((posCount['DE'] || 0) + (posCount['EDGE'] || 0) >= 3) balanceBonus += 2;
  if ((posCount['CB'] || 0) >= 3) balanceBonus += 2;
  if (roster.length >= 50 && roster.length <= 55) balanceBonus += 3; // realistic roster size

  // ─── OVERALL ───
  // Blend baseline (pre-existing offseason moves) with user's simulation actions
  // If user hasn't done anything, overall should reflect baseline
  // As user makes moves, their actions increasingly weight the grade
  const userActions = signingHistory.length + tradeHistory.length + draftedPlayers.length;
  const hasUserActions = userActions > 0;

  // User simulation score: weighted by category
  const userSimScore = Math.round(
    draftScore * 0.35 +
    faScore * 0.30 +
    (tradeScore + capBonus) * 0.25 +
    (70 + balanceBonus) * 0.10
  );

  // Blend: baseline gets less weight as user makes more moves
  // 0 moves = 100% baseline, 5 moves = 50/50, 10+ moves = 80% user
  const userWeight = Math.min(0.8, userActions * 0.1);
  const baselineWeight = 1 - userWeight;
  const overallScore = hasUserActions
    ? Math.round(baselineScore * baselineWeight + userSimScore * userWeight)
    : baselineScore;

  return {
    fa: { grade: gradeFromScore(Math.round(faScore)), score: Math.round(faScore) },
    trades: { grade: gradeFromScore(Math.round(tradeScore)), score: Math.round(tradeScore) },
    draft: { grade: draftedPlayers.length > 0 ? draftLetter : gradeFromScore(Math.round(draftScore)), score: Math.round(draftScore) },
    overall: { grade: gradeFromScore(overallScore), score: overallScore },
    preseason: { grade: gradeFromScore(baselineScore), score: baselineScore },
    yourMoves: { grade: gradeFromScore(userSimScore), score: userSimScore },
    baseline: baselineScore,
    userSim: userSimScore,
    userWeight: Math.round(userWeight * 100),
    capBonus,
    balanceBonus,
  };
}

function TypeIcon({ type }) {
  const icons = { signing: '\u270D\uFE0F', cut: '\u2702\uFE0F', trade: '\uD83D\uDD04', draft: '\uD83C\uDFAF', restructure: '\uD83D\uDCCB' };
  return <span>{icons[type] || '\u2022'}</span>;
}

export default function SummaryPage() {
  const {
    signingHistory, tradeHistory, draftedPlayers, cutPlayers,
    roster, capUsed, totalCap, resetGame, selectedTeamColors, currentTeamAbbr,
    draftComplete,
  } = useGame();
  const summaryRef = useRef(null);
  const [exporting, setExporting] = useState(false);
  const [shareLink, setShareLink] = useState('');

  const accentColor = selectedTeamColors?.primaryColor || '#FB4F14';

  // Baseline grade from real offseason moves BEFORE user simulation
  const baseline = useMemo(() => computeBaselineGrade(currentTeamAbbr), [currentTeamAbbr]);
  const teamPreMoves = preseasonMoves[currentTeamAbbr] || {};

  const allMoves = [
    ...signingHistory.map(m => ({ ...m })),
    ...tradeHistory.map(m => ({ ...m })),
  ].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const grades = computeGrades(signingHistory, tradeHistory, draftedPlayers, cutPlayers, roster, capUsed, totalCap, baseline.score);
  const capSpace = totalCap - capUsed;

  async function handleExport() {
    if (!summaryRef.current) return;
    setExporting(true);
    try {
      const dataUrl = await toPng(summaryRef.current, { backgroundColor: '#0f0f0f', pixelRatio: 2 });
      const link = document.createElement('a');
      link.download = `${currentTeamAbbr}-Offseason-Summary.png`;
      link.href = dataUrl;
      link.click();
    } catch (e) {
      console.error(e);
    }
    setExporting(false);
  }

  function handleShare() {
    const data = {
      team: currentTeamAbbr,
      moves: allMoves.length,
      signings: signingHistory.length,
      drafted: draftedPlayers.length,
      cuts: cutPlayers.length,
      grade: grades.overall.grade,
      capSpace: Math.round(capSpace),
    };
    const encoded = btoa(JSON.stringify(data));
    const url = `${window.location.origin}${window.location.pathname}?share=${encoded}`;
    setShareLink(url);
    navigator.clipboard?.writeText(url).catch(() => {});
  }

  function handleReset() {
    if (window.confirm('Reset all offseason progress? This cannot be undone.')) {
      resetGame();
    }
  }

  // Position group cap breakdown
  const posGroupCap = {};
  roster.forEach(p => {
    const pos = p.position || 'UNK';
    let group = 'Other';
    if (['QB'].includes(pos)) group = 'QB';
    else if (['RB', 'FB'].includes(pos)) group = 'RB';
    else if (['WR'].includes(pos)) group = 'WR';
    else if (['TE'].includes(pos)) group = 'TE';
    else if (['LT', 'RT', 'LG', 'RG', 'C', 'OT', 'OG', 'IOL'].includes(pos)) group = 'OL';
    else if (['DE', 'DT', 'NT', 'EDGE', 'DL'].includes(pos)) group = 'DL';
    else if (['LB', 'MLB', 'OLB', 'ILB'].includes(pos)) group = 'LB';
    else if (['CB'].includes(pos)) group = 'CB';
    else if (['S', 'FS', 'SS'].includes(pos)) group = 'S';
    else if (['K', 'P', 'LS'].includes(pos)) group = 'ST';
    posGroupCap[group] = (posGroupCap[group] || 0) + (p.capHit || 0);
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 22, color: accentColor }}>Offseason Summary</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleExport} disabled={exporting}
            style={{ background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 13, opacity: exporting ? 0.7 : 1 }}
          >{exporting ? 'Exporting...' : 'Export Image'}</button>
          <button onClick={handleShare}
            style={{ background: '#166534', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
          >Share</button>
          <button onClick={handleReset}
            style={{ background: '#7f1d1d', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
          >Reset All</button>
        </div>
      </div>

      {shareLink && (
        <div style={{ background: '#0f172a', border: '1px solid rgba(0,240,255,0.12)', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 12 }}>
          <div style={{ color: '#4ade80', marginBottom: 4 }}>Share link copied to clipboard!</div>
          <div style={{ color: '#94A3B8', wordBreak: 'break-all' }}>{shareLink}</div>
        </div>
      )}

      <div ref={summaryRef} style={{ background: '#0f0f0f', padding: 4 }}>
        {/* Grade Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
          {[
            { label: 'Free Agency', key: 'fa', detail: `${signingHistory.length} signings` },
            { label: 'Trades & Cuts', key: 'trades', detail: `${tradeHistory.filter(t=>t.type==='trade').length} trades, ${cutPlayers.length} cuts` },
            { label: 'Draft', key: 'draft', detail: `${draftedPlayers.length} picks` },
            { label: 'Pre-Season', key: 'preseason', detail: `Real offseason moves` },
            { label: 'Your Moves', key: 'yourMoves', detail: `Simulation actions` },
            { label: 'Overall', key: 'overall', detail: `Pre-season ${grades.preseason.grade} + Sim ${grades.userWeight}%` },
          ].map(({ label, key, detail }) => {
            const { grade, score } = grades[key];
            const color = gradeColor(grade);
            return (
              <div key={key} style={{
                background: '#0f172a',
                border: `1px solid ${key === 'overall' ? accentColor : 'rgba(0,240,255,0.12)'}`,
                borderRadius: 12, padding: 16, textAlign: 'center',
              }}>
                <div style={{ color: '#94A3B8', fontSize: 12, marginBottom: 4 }}>{label}</div>
                <div style={{ color, fontSize: 36, fontWeight: 900, lineHeight: 1 }}>{grade}</div>
                <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>{detail}</div>
              </div>
            );
          })}
        </div>

        {/* Baseline Offseason Report */}
        <div style={{ background: '#0f172a', border: `1px solid ${accentColor}33`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0, color: '#fff', fontSize: 15 }}>Pre-Simulation Offseason Report</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#94A3B8', fontSize: 12 }}>Baseline Grade:</span>
              <span style={{
                background: gradeColor(baseline.grade) + '22',
                color: gradeColor(baseline.grade),
                border: `1px solid ${gradeColor(baseline.grade)}`,
                borderRadius: 6, padding: '2px 10px', fontSize: 16, fontWeight: 900,
              }}>{baseline.grade}</span>
            </div>
          </div>

          {baseline.summary && (
            <p style={{ color: '#CBD5E1', fontSize: 13, margin: '0 0 12px', lineHeight: 1.5 }}>{baseline.summary}</p>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {/* Signings */}
            {(teamPreMoves.signings || []).length > 0 && (
              <div style={{ background: '#0a0f1e', borderRadius: 8, padding: 10 }}>
                <div style={{ color: '#4ade80', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Signings</div>
                {teamPreMoves.signings.map((s, i) => (
                  <div key={i} style={{ color: '#CBD5E1', fontSize: 12, marginBottom: 3 }}>
                    <span style={{ color: '#fff', fontWeight: 600 }}>{s.player}</span>
                    <span style={{ color: '#94A3B8' }}> ({s.position}) — </span>
                    <span style={{ color: '#4ade80' }}>{s.years}yr/${s.total || (s.aav * s.years)}M</span>
                    <span style={{ color: '#64748b' }}> (${s.aav}M/yr{s.guaranteed ? `, $${s.guaranteed}M gtd` : ''})</span>
                    <span style={{ color: 'rgba(0,240,255,0.18)' }}> from {s.previousTeam}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Extensions */}
            {(teamPreMoves.extensions || []).length > 0 && (
              <div style={{ background: '#0a0f1e', borderRadius: 8, padding: 10 }}>
                <div style={{ color: '#60a5fa', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Extensions</div>
                {teamPreMoves.extensions.map((e, i) => (
                  <div key={i} style={{ color: '#CBD5E1', fontSize: 12, marginBottom: 3 }}>
                    <span style={{ color: '#fff', fontWeight: 600 }}>{e.player}</span>
                    <span style={{ color: '#94A3B8' }}> ({e.position}) — {e.details}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Departures */}
            {(teamPreMoves.departures || []).length > 0 && (
              <div style={{ background: '#0a0f1e', borderRadius: 8, padding: 10 }}>
                <div style={{ color: '#ef4444', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Departures</div>
                {teamPreMoves.departures.map((d, i) => (
                  <div key={i} style={{ color: '#CBD5E1', fontSize: 12, marginBottom: 3 }}>
                    <span style={{ color: '#fff', fontWeight: 600 }}>{d.player}</span>
                    <span style={{ color: '#94A3B8' }}> ({d.position}) → </span>
                    <span style={{ color: '#ef4444' }}>{d.destination}</span>
                    {d.contract && <span style={{ color: '#64748b' }}> ({d.contract})</span>}
                    {d.note && <span style={{ color: '#64748b' }}> — {d.note}</span>}
                  </div>
                ))}
              </div>
            )}

            {/* Trades */}
            {(teamPreMoves.trades || []).length > 0 && (
              <div style={{ background: '#0a0f1e', borderRadius: 8, padding: 10 }}>
                <div style={{ color: '#fbbf24', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Trades</div>
                {teamPreMoves.trades.map((t, i) => (
                  <div key={i} style={{ color: '#CBD5E1', fontSize: 12, marginBottom: 3 }}>
                    <span style={{ color: '#fff', fontWeight: 600 }}>{t.acquired}</span>
                    <span style={{ color: '#94A3B8' }}> ({t.position}) from {t.from}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {!teamPreMoves.signings && !teamPreMoves.departures && !teamPreMoves.trades && (
            <p style={{ color: '#64748b', fontSize: 13 }}>No confirmed offseason moves tracked for this team yet.</p>
          )}

          <div style={{ borderTop: '1px solid rgba(0,240,255,0.12)', marginTop: 12, paddingTop: 8, color: '#94A3B8', fontSize: 11 }}>
            Your simulation results below show how your moves compare to this starting point.
          </div>
        </div>

        {/* Grading Breakdown */}
        <div style={{ background: '#0f172a', border: '1px solid rgba(0,240,255,0.12)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', color: '#fff', fontSize: 15 }}>Your Simulation Grade Breakdown</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, fontSize: 12 }}>
            <div>
              <div style={{ color: '#94A3B8', marginBottom: 6, fontWeight: 600 }}>Positive Factors</div>
              {signingHistory.length > 0 && (
                <div style={{ color: '#4ade80', marginBottom: 3 }}>
                  + FA activity ({signingHistory.length} signing{signingHistory.length > 1 ? 's' : ''})
                </div>
              )}
              {draftedPlayers.length > 0 && (() => {
                const avgGrade = draftedPlayers.reduce((s,p) => s + (p.grade||60), 0) / draftedPlayers.length;
                return avgGrade > 70 ? <div style={{ color: '#4ade80', marginBottom: 3 }}>+ Strong draft picks (avg grade: {Math.round(avgGrade)})</div> : null;
              })()}
              {capSpace >= 10 && capSpace <= 35 && (
                <div style={{ color: '#4ade80', marginBottom: 3 }}>+ Healthy cap flexibility (${capSpace.toFixed(1)}M)</div>
              )}
              {grades.balanceBonus > 5 && (
                <div style={{ color: '#4ade80', marginBottom: 3 }}>+ Good roster balance</div>
              )}
              {tradeHistory.filter(t=>t.type==='restructure').length > 0 && (
                <div style={{ color: '#4ade80', marginBottom: 3 }}>+ Cap-savvy restructures</div>
              )}
            </div>
            <div>
              <div style={{ color: '#94A3B8', marginBottom: 6, fontWeight: 600 }}>Areas to Improve</div>
              {signingHistory.length === 0 && (
                <div style={{ color: '#fb923c', marginBottom: 3 }}>- No FA signings made</div>
              )}
              {draftedPlayers.length === 0 && (
                <div style={{ color: '#fb923c', marginBottom: 3 }}>- No draft picks made</div>
              )}
              {capSpace < 0 && (
                <div style={{ color: '#ef4444', marginBottom: 3 }}>- Over the salary cap!</div>
              )}
              {capSpace > 50 && (
                <div style={{ color: '#fb923c', marginBottom: 3 }}>- Too much unused cap space (${capSpace.toFixed(1)}M)</div>
              )}
              {cutPlayers.length > 0 && (() => {
                const totalDead = cutPlayers.reduce((s,p) => s + (p.deadCap||0), 0);
                return totalDead > 10 ? <div style={{ color: '#ef4444', marginBottom: 3 }}>- Heavy dead cap from cuts (${totalDead.toFixed(1)}M)</div> : null;
              })()}
            </div>
          </div>
        </div>

        {/* Stats Row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 16 }}>
          {[
            { label: 'Players Signed', value: signingHistory.length, color: '#4ade80' },
            { label: 'Trades Made', value: tradeHistory.filter(t => t.type === 'trade').length, color: '#60a5fa' },
            { label: 'Players Drafted', value: draftedPlayers.length, color: accentColor },
            { label: 'Players Cut', value: cutPlayers.length, color: '#ef4444' },
            { label: 'Restructured', value: tradeHistory.filter(t => t.type === 'restructure').length, color: '#fbbf24' },
            { label: 'Roster Size', value: roster.length, color: '#fff' },
            { label: 'Cap Used', value: `$${capUsed.toFixed(1)}M`, color: '#CBD5E1' },
            { label: 'Cap Space', value: `$${capSpace.toFixed(1)}M`, color: capSpace >= 0 ? '#4ade80' : '#ef4444' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              background: '#0f172a', border: '1px solid rgba(0,240,255,0.12)', borderRadius: 10,
              padding: '10px 12px', textAlign: 'center',
            }}>
              <div style={{ color: '#94A3B8', fontSize: 10 }}>{label}</div>
              <div style={{ color, fontSize: 18, fontWeight: 700 }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Draft Class Recap */}
        {draftedPlayers.length > 0 && (
          <div style={{ background: '#0f172a', border: `1px solid ${accentColor}33`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, color: '#fff', fontSize: 15 }}>
                {draftComplete ? 'Mock Draft Results' : 'Draft Picks So Far'}
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#94A3B8', fontSize: 12 }}>Draft Grade:</span>
                <span style={{
                  background: gradeColor(grades.draft.grade) + '22',
                  color: gradeColor(grades.draft.grade),
                  border: `1px solid ${gradeColor(grades.draft.grade)}`,
                  borderRadius: 6, padding: '2px 10px', fontSize: 18, fontWeight: 900,
                }}>{grades.draft.grade}</span>
              </div>
            </div>
            <div style={{ color: '#94A3B8', fontSize: 12, marginBottom: 10 }}>
              {draftedPlayers.length} pick{draftedPlayers.length > 1 ? 's' : ''} made · Avg prospect grade: {Math.round(draftedPlayers.reduce((s,p) => s + (p.grade||60), 0) / draftedPlayers.length)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
              {draftedPlayers.map(p => {
                const pickNum = p.pickNumber || 0;
                const expectedGrade = Math.max(35, 95 - pickNum * 0.32);
                const valueVsExpected = (p.grade || 60) - expectedGrade;
                const isSteal = valueVsExpected > 10;
                const isReach = valueVsExpected < -10;
                return (
                  <div key={p.id} style={{
                    background: '#0a0f1e', borderRadius: 8, padding: 10,
                    border: isSteal ? '1px solid #4ade8044' : isReach ? '1px solid #ef444444' : '1px solid #1a2420',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{p.name}</div>
                      <span style={{
                        fontSize: 12, fontWeight: 700, borderRadius: 4, padding: '1px 6px',
                        background: (p.grade >= 80 ? '#4ade80' : p.grade >= 65 ? '#facc15' : '#fb923c') + '22',
                        color: p.grade >= 80 ? '#4ade80' : p.grade >= 65 ? '#facc15' : '#fb923c',
                      }}>{p.grade}</span>
                    </div>
                    <div style={{ color: '#94A3B8', fontSize: 11 }}>
                      {p.position} · {p.school} · Pick #{pickNum}
                    </div>
                    <div style={{ color: isSteal ? '#4ade80' : isReach ? '#ef4444' : '#94A3B8', fontSize: 10, marginTop: 2 }}>
                      {isSteal ? 'STEAL' : isReach ? 'REACH' : 'Fair value'} ({valueVsExpected > 0 ? '+' : ''}{Math.round(valueVsExpected)} vs expected)
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Cap Breakdown by Position */}
        <div style={{ background: '#0f172a', border: '1px solid rgba(0,240,255,0.12)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', color: '#fff', fontSize: 15 }}>Cap Allocation by Position</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {Object.entries(posGroupCap)
              .sort((a, b) => b[1] - a[1])
              .map(([group, total]) => {
                const pct = capUsed > 0 ? (total / capUsed * 100) : 0;
                return (
                  <div key={group} style={{
                    background: '#0a0f1e', borderRadius: 8, padding: '8px 12px',
                    minWidth: 80, textAlign: 'center',
                  }}>
                    <div style={{ color: accentColor, fontSize: 12, fontWeight: 700 }}>{group}</div>
                    <div style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>${total.toFixed(1)}M</div>
                    <div style={{ color: '#64748b', fontSize: 10 }}>{pct.toFixed(1)}%</div>
                  </div>
                );
              })}
          </div>
        </div>

        {/* Timeline */}
        <div style={{ background: '#0f172a', border: '1px solid rgba(0,240,255,0.12)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 14px', color: '#fff', fontSize: 16 }}>Offseason Timeline</h3>
          {allMoves.length === 0 ? (
            <p style={{ color: '#64748b', fontSize: 13 }}>No moves made yet. Start by signing free agents, making trades, or running the draft.</p>
          ) : (
            <div>
              {allMoves.map((move, i) => (
                <div key={move.id || i} style={{
                  display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid #1a2420',
                }}>
                  <div style={{
                    width: 32, height: 32, background: '#1e293b', borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, flexShrink: 0,
                  }}>
                    <TypeIcon type={move.type} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: '#CBD5E1', fontSize: 13 }}>
                      {move.type === 'signing' && (
                        <>Signed <strong style={{ color: '#fff' }}>{move.player}</strong> ({move.position}) — ${move.aav?.toFixed(1)}M/yr for {move.years}yr</>
                      )}
                      {move.type !== 'signing' && (
                        <span>{move.description}</span>
                      )}
                    </div>
                    <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
                      {new Date(move.timestamp).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Final Roster */}
        <div style={{ background: '#0f172a', border: '1px solid rgba(0,240,255,0.12)', borderRadius: 12, padding: 16 }}>
          <h3 style={{ margin: '0 0 14px', color: '#fff', fontSize: 16 }}>
            Final Roster — {roster.length} Players
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${accentColor}` }}>
                  <th style={{ padding: '5px 8px', textAlign: 'left', color: '#94A3B8', fontWeight: 600, whiteSpace: 'nowrap' }}>Player</th>
                  <th style={{ padding: '5px 8px', textAlign: 'left', color: '#94A3B8', fontWeight: 600, whiteSpace: 'nowrap' }}>Pos</th>
                  <th style={{ padding: '5px 8px', textAlign: 'left', color: '#94A3B8', fontWeight: 600, whiteSpace: 'nowrap' }}>Age</th>
                  <th style={{ padding: '5px 8px', textAlign: 'right', color: '#94A3B8', fontWeight: 600, whiteSpace: 'nowrap' }}>Cap Hit</th>
                  <th style={{ padding: '5px 8px', textAlign: 'right', color: '#94A3B8', fontWeight: 600, whiteSpace: 'nowrap' }}>Dead $</th>
                  <th style={{ padding: '5px 8px', textAlign: 'left', color: '#94A3B8', fontWeight: 600, whiteSpace: 'nowrap' }}>Yrs</th>
                </tr>
              </thead>
              <tbody>
                {[...roster]
                  .sort((a, b) => b.capHit - a.capHit)
                  .map((p, i) => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #1a1a1a', background: i % 2 === 0 ? '#0a0f1e' : 'transparent' }}>
                      <td style={{ padding: '5px 8px', color: '#fff' }}>
                        {p.isFranchise && <span style={{ color: accentColor, fontSize: 9, marginRight: 4 }}>FR</span>}
                        {p.name}
                      </td>
                      <td style={{ padding: '5px 8px', color: accentColor, fontWeight: 700 }}>{p.position}</td>
                      <td style={{ padding: '5px 8px', color: '#94A3B8' }}>{p.age}</td>
                      <td style={{ padding: '5px 8px', color: '#CBD5E1', fontWeight: 600, textAlign: 'right' }}>${(p.capHit || 0).toFixed(1)}M</td>
                      <td style={{ padding: '5px 8px', color: (p.deadMoney || 0) > (p.capHit || 0) ? '#ef4444' : '#64748b', textAlign: 'right' }}>
                        ${(p.deadMoney || 0).toFixed(1)}M
                      </td>
                      <td style={{ padding: '5px 8px', color: (p.capHit || 0) === 0 ? '#facc15' : '#94A3B8' }}>
                        {(p.capHit || 0) === 0 ? 'FA' : `${p.yearsRemaining + 1}yr`}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

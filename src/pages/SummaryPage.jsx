import React, { useRef, useState, useMemo } from 'react';
import { toPng } from 'html-to-image';
import { useGame } from '../context/GameContext';
import { computeBaselineGrade, preseasonMoves } from '../data/offseasonMoves';
import Leaderboard, { submitToLeaderboard } from '../components/Leaderboard';

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
    draftComplete, allTeams,
  } = useGame();
  const summaryRef = useRef(null);
  const [exporting, setExporting] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitUsername, setSubmitUsername] = useState('');
  const [submitted, setSubmitted] = useState(false);

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

  function handleShareX() {
    const grade = grades.overall.grade;
    const team = currentTeamAbbr;
    const currentTeamObj = allTeams?.find(t => t.abbreviation === team);
    const signings = signingHistory.length;
    const drafted = draftedPlayers.length;
    const trades = tradeHistory.filter(t => t.type === 'trade').length;

    const gradeEmoji = grade.startsWith('A') ? '\u{1F525}' : grade.startsWith('B') ? '\u{1F4AA}' : '\u{1F914}';
    const text = encodeURIComponent(
      `${gradeEmoji} I earned a ${grade} running the ${currentTeamObj?.name || team} offseason on AiNFL GM!\n\n` +
      `\u{1F4CA} Overall Grade: ${grade}\n` +
      `\u270D\uFE0F ${signings} FA signing${signings !== 1 ? 's' : ''} | ` +
      `\u{1F504} ${trades} trade${trades !== 1 ? 's' : ''} | ` +
      `\u{1F3AF} ${drafted} draft pick${drafted !== 1 ? 's' : ''}\n\n` +
      `Think you can do better? Try it yourself \u{1F447}\n` +
      `ainflgm.com`
    );

    window.open(`https://x.com/intent/tweet?text=${text}`, '_blank');
  }

  function handleSubmitToLeaderboard() {
    submitToLeaderboard({
      username: submitUsername.trim() || 'Anonymous GM',
      team: currentTeamAbbr,
      overallGrade: grades.overall.grade,
      draftGrade: grades.draft.grade,
      faGrade: grades.fa.grade,
    });
    setSubmitted(true);
    setShowSubmitModal(false);
    setSubmitUsername('');
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
          <button onClick={handleShareX}
            style={{ background: '#000', color: '#fff', border: '1px solid #333', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
          >Share on X</button>
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
        {/* Overall Grade Hero */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          background: '#0f172a', border: `2px solid ${accentColor}`,
          borderRadius: 16, padding: '24px 16px 20px', marginBottom: 16,
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            background: `radial-gradient(ellipse at center, ${gradeColor(grades.overall.grade)}08 0%, transparent 70%)`,
            pointerEvents: 'none',
          }} />
          <div style={{ color: '#94A3B8', fontSize: 13, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8, fontFamily: 'Oswald, sans-serif' }}>Overall Offseason Grade</div>
          {/* Shield badge */}
          <div style={{
            position: 'relative', width: 110, height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8,
          }}>
            <svg viewBox="0 0 110 120" width="110" height="120" style={{ position: 'absolute', top: 0, left: 0 }}>
              <path d="M55 4 L102 20 L102 70 Q102 100 55 116 Q8 100 8 70 L8 20 Z"
                fill={gradeColor(grades.overall.grade) + '18'}
                stroke={gradeColor(grades.overall.grade)}
                strokeWidth="2.5"
              />
            </svg>
            <span style={{
              color: gradeColor(grades.overall.grade), fontSize: 48, fontWeight: 900,
              fontFamily: 'Oswald, sans-serif', lineHeight: 1, position: 'relative', zIndex: 1,
              textShadow: `0 0 24px ${gradeColor(grades.overall.grade)}44`,
            }}>{grades.overall.grade}</span>
          </div>
          <div style={{ color: '#64748b', fontSize: 12 }}>
            Pre-season {grades.preseason.grade} + Your simulation ({grades.userWeight}% weight)
          </div>
        </div>

        {/* Category Grade Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
          {[
            { label: 'Free Agency', key: 'fa', detail: `${signingHistory.length} signings`, isBaseline: false },
            { label: 'Trades & Cuts', key: 'trades', detail: `${tradeHistory.filter(t=>t.type==='trade').length} trades, ${cutPlayers.length} cuts`, isBaseline: false },
            { label: 'Draft', key: 'draft', detail: `${draftedPlayers.length} picks`, isBaseline: false },
            { label: 'Pre-Season', key: 'preseason', detail: `Real moves (baseline)`, isBaseline: true },
            { label: 'Your Moves', key: 'yourMoves', detail: `Simulation actions`, isBaseline: false },
          ].map(({ label, key, detail, isBaseline }) => {
            const { grade, score } = grades[key];
            const color = gradeColor(grade);
            return (
              <div key={key} style={{
                background: isBaseline ? '#0d1525' : '#0f172a',
                border: `1px solid ${isBaseline ? '#334155' : 'rgba(0,240,255,0.12)'}`,
                borderRadius: 12, padding: 16, textAlign: 'center',
                position: 'relative', overflow: 'hidden',
              }}>
                {isBaseline && (
                  <div style={{
                    position: 'absolute', top: 6, right: 8, fontSize: 9, color: '#64748b',
                    background: '#1e293b', borderRadius: 4, padding: '1px 5px', fontWeight: 600,
                  }}>BASELINE</div>
                )}
                <div style={{ color: '#94A3B8', fontSize: 12, marginBottom: 8, fontFamily: 'Oswald, sans-serif', letterSpacing: 0.5 }}>{label}</div>
                {/* Circular badge */}
                <div style={{
                  width: 56, height: 56, borderRadius: '50%', margin: '0 auto 6px',
                  background: color + '18', border: `2px solid ${color}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span style={{ color, fontSize: 22, fontWeight: 900, fontFamily: 'Oswald, sans-serif', lineHeight: 1 }}>{grade}</span>
                </div>
                <div style={{ color: '#64748b', fontSize: 11 }}>{detail}</div>
              </div>
            );
          })}
        </div>

        {/* Leaderboard Actions */}
        <div style={{
          display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap',
          justifyContent: 'center',
        }}>
          <button onClick={() => setShowSubmitModal(true)} disabled={submitted} style={{
            background: submitted ? '#1e293b' : 'linear-gradient(135deg, #f59e0b, #d97706)',
            color: submitted ? '#64748b' : '#000', border: 'none', borderRadius: 10,
            padding: '10px 20px', cursor: submitted ? 'default' : 'pointer',
            fontWeight: 800, fontSize: 14, letterSpacing: 0.3,
            boxShadow: submitted ? 'none' : '0 0 20px rgba(245,158,11,0.3)',
            transition: 'all 0.2s',
          }}>
            {submitted ? 'Submitted!' : 'Submit to Leaderboard'}
          </button>
          <button onClick={() => setShowLeaderboard(true)} style={{
            background: '#0f172a', color: '#00f0ff',
            border: '1px solid rgba(0,240,255,0.3)', borderRadius: 10,
            padding: '10px 20px', cursor: 'pointer',
            fontWeight: 700, fontSize: 14,
            transition: 'all 0.2s',
          }}>
            View Leaderboard
          </button>
        </div>

        {/* Baseline Offseason Report */}
        <div style={{ background: '#0f172a', border: `1px solid ${accentColor}33`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0, color: '#fff', fontSize: 15 }}>Pre-Simulation Offseason Report</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#94A3B8', fontSize: 12 }}>Baseline Grade:</span>
              <div style={{
                width: 44, height: 44, borderRadius: '50%',
                background: gradeColor(baseline.grade) + '18',
                border: `2px solid ${gradeColor(baseline.grade)}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{
                  color: gradeColor(baseline.grade), fontSize: 18, fontWeight: 900,
                  fontFamily: 'Oswald, sans-serif',
                }}>{baseline.grade}</span>
              </div>
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
          <h3 style={{ margin: '0 0 12px', color: '#fff', fontSize: 15, fontFamily: 'Oswald, sans-serif' }}>Your Simulation Grade Breakdown</h3>
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
          <h3 style={{ margin: '0 0 12px', color: '#fff', fontSize: 15, fontFamily: 'Oswald, sans-serif' }}>Cap Allocation by Position</h3>
          {/* Stacked bar visualization */}
          {(() => {
            const sortedGroups = Object.entries(posGroupCap).sort((a, b) => b[1] - a[1]);
            const barColors = {
              QB: '#ef4444', RB: '#f97316', WR: '#facc15', TE: '#a3e635',
              OL: '#4ade80', DL: '#22d3ee', LB: '#60a5fa', CB: '#a78bfa',
              S: '#e879f9', ST: '#94A3B8', Other: '#64748b',
            };
            return (
              <>
                {/* Compact stacked bar */}
                <div style={{ display: 'flex', height: 18, borderRadius: 9, overflow: 'hidden', marginBottom: 14, background: '#0a0f1e' }}>
                  {sortedGroups.map(([group, total]) => {
                    const pct = capUsed > 0 ? (total / capUsed * 100) : 0;
                    if (pct < 0.5) return null;
                    return (
                      <div key={group} title={`${group}: $${total.toFixed(1)}M (${pct.toFixed(1)}%)`} style={{
                        width: `${pct}%`, background: barColors[group] || '#64748b',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 9, fontWeight: 700, color: '#000',
                        minWidth: pct > 4 ? 0 : 0,
                      }}>
                        {pct > 6 ? group : ''}
                      </div>
                    );
                  })}
                </div>
                {/* Per-group rows with bars */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {sortedGroups.map(([group, total]) => {
                    const pct = capUsed > 0 ? (total / capUsed * 100) : 0;
                    const maxPct = capUsed > 0 ? (sortedGroups[0][1] / capUsed * 100) : 0;
                    const barWidth = maxPct > 0 ? (pct / maxPct * 100) : 0;
                    return (
                      <div key={group} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 32, color: barColors[group] || '#64748b', fontSize: 12, fontWeight: 700, textAlign: 'right', flexShrink: 0, fontFamily: 'Oswald, sans-serif' }}>{group}</div>
                        <div style={{ flex: 1, height: 16, background: '#0a0f1e', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                          <div style={{
                            height: '100%', width: `${barWidth}%`,
                            background: `linear-gradient(90deg, ${barColors[group] || '#64748b'}cc, ${barColors[group] || '#64748b'}88)`,
                            borderRadius: 4, transition: 'width 0.3s ease',
                          }} />
                        </div>
                        <div style={{ width: 68, color: '#fff', fontSize: 12, fontWeight: 600, textAlign: 'right', flexShrink: 0 }}>${total.toFixed(1)}M</div>
                        <div style={{ width: 40, color: '#64748b', fontSize: 11, textAlign: 'right', flexShrink: 0 }}>{pct.toFixed(0)}%</div>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
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

        {/* Branding watermark — appears in exported images */}
        <div style={{
          display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6,
          padding: '8px 0 4px', color: '#475569', fontSize: 10,
          fontFamily: "'Inter', system-ui, sans-serif",
        }}>
          <span>Built with</span>
          <span style={{ color: '#00f0ff', fontWeight: 700, fontFamily: "'Oswald', sans-serif", letterSpacing: '0.04em' }}>AiNFL GM</span>
          <span>— ainflgm.com</span>
        </div>
      </div>

      {/* Support CTA — shown after summary results when user feels the value */}
      <a
        href="https://buymeacoffee.com/ainflgm"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 14,
          margin: '20px 0 12px',
          padding: '16px 24px',
          background: 'linear-gradient(135deg, rgba(251,79,20,0.15), rgba(255,129,63,0.08))',
          border: '1px solid rgba(251,79,20,0.35)',
          borderRadius: 14,
          textDecoration: 'none',
          color: '#E2E8F0',
          transition: 'all 0.2s ease',
          boxShadow: '0 2px 16px rgba(251,79,20,0.1)',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(251,79,20,0.6)'; e.currentTarget.style.boxShadow = '0 4px 24px rgba(251,79,20,0.2)'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(251,79,20,0.35)'; e.currentTarget.style.boxShadow = '0 2px 16px rgba(251,79,20,0.1)'; }}
      >
        <span style={{ fontSize: 28, lineHeight: 1 }}>&#9749;</span>
        <div>
          <div style={{
            fontWeight: 800,
            fontSize: 15,
            fontFamily: "'Oswald', sans-serif",
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: '#FB4F14',
          }}>
            Enjoyed your offseason? Buy us a coffee
          </div>
          <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 3 }}>
            100% free, built by one person. Every dollar goes toward better data and new features.
          </div>
        </div>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FB4F14" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.7 }}>
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </a>

      {/* Submit Modal */}
      {showSubmitModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)', zIndex: 9998,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 16,
        }} onClick={(e) => { if (e.target === e.currentTarget) setShowSubmitModal(false); }}>
          <div style={{
            background: '#0a0f1e', border: '1px solid rgba(0,240,255,0.2)',
            borderRadius: 16, padding: 'clamp(16px, 4vw, 32px)', width: '100%', maxWidth: 'min(420px, 95vw)',
          }}>
            <h3 style={{ margin: '0 0 8px', color: '#fff', fontSize: 18, fontWeight: 800 }}>
              Submit to Leaderboard
            </h3>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 20 }}>
              Share your {currentTeamAbbr} offseason grade with the community
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: 16 }}>
                {[
                  { label: 'Overall', grade: grades.overall.grade },
                  { label: 'Draft', grade: grades.draft.grade },
                  { label: 'FA', grade: grades.fa.grade },
                ].map(({ label, grade }) => (
                  <div key={label} style={{ textAlign: 'center' }}>
                    <div style={{ color: '#94A3B8', fontSize: 11, marginBottom: 4 }}>{label}</div>
                    <div style={{
                      color: gradeColor(grade), fontSize: 28, fontWeight: 900,
                    }}>{grade}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ color: '#94A3B8', fontSize: 12, display: 'block', marginBottom: 6 }}>
                Username (optional)
              </label>
              <input
                type="text"
                value={submitUsername}
                onChange={e => setSubmitUsername(e.target.value)}
                placeholder="Anonymous GM"
                maxLength={24}
                style={{
                  width: '100%', background: '#0f172a', color: '#fff',
                  border: '1px solid rgba(0,240,255,0.2)', borderRadius: 8,
                  padding: '10px 14px', fontSize: 14, outline: 'none',
                  boxSizing: 'border-box',
                }}
                onKeyDown={e => { if (e.key === 'Enter') handleSubmitToLeaderboard(); }}
                autoFocus
              />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={handleSubmitToLeaderboard} style={{
                flex: 1, background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                color: '#000', border: 'none', borderRadius: 10,
                padding: '12px', cursor: 'pointer', fontWeight: 800, fontSize: 14,
              }}>Submit</button>
              <button onClick={() => setShowSubmitModal(false)} style={{
                flex: 1, background: '#1e293b', color: '#94A3B8',
                border: '1px solid #334155', borderRadius: 10,
                padding: '12px', cursor: 'pointer', fontWeight: 600, fontSize: 14,
              }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Leaderboard Modal */}
      {showLeaderboard && (
        <Leaderboard
          onClose={() => setShowLeaderboard(false)}
          accentColor={accentColor}
        />
      )}
    </div>
  );
}

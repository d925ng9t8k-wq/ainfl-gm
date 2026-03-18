import React, { useState, useMemo, useCallback } from 'react';
import { useGame } from '../context/GameContext';

// NFL divisions
const DIVISIONS = {
  'AFC North': ['BAL', 'CIN', 'CLE', 'PIT'],
  'AFC South': ['HOU', 'IND', 'JAX', 'TEN'],
  'AFC East': ['BUF', 'MIA', 'NE', 'NYJ'],
  'AFC West': ['DEN', 'KC', 'LAC', 'LV'],
  'NFC North': ['CHI', 'DET', 'GB', 'MIN'],
  'NFC South': ['ATL', 'CAR', 'NO', 'TB'],
  'NFC East': ['DAL', 'NYG', 'PHI', 'WSH'],
  'NFC West': ['ARI', 'LAR', 'SEA', 'SF'],
};

const POSITION_GROUPS = {
  QB: ['QB'],
  WR: ['WR'],
  RB: ['RB', 'FB'],
  TE: ['TE'],
  OL: ['OT', 'OG', 'C', 'OL', 'LT', 'RT', 'LG', 'RG', 'T', 'G'],
  DL: ['DE', 'DT', 'DL', 'NT', 'EDGE'],
  LB: ['LB', 'ILB', 'OLB', 'MLB'],
  CB: ['CB'],
  S: ['S', 'SS', 'FS', 'DB'],
  K: ['K'],
  P: ['P'],
};

const POSITION_WEIGHTS = {
  QB: 3.0, WR: 1.5, RB: 0.8, TE: 1.0, OL: 1.8, DL: 1.8, LB: 1.3, CB: 1.5, S: 1.2, K: 0.3, P: 0.2,
};

// Cap benchmarks for "elite" spending at each group (rough NFL averages for top teams)
const CAP_BENCHMARKS = {
  QB: 55, WR: 25, RB: 10, TE: 12, OL: 18, DL: 18, LB: 14, CB: 18, S: 12, K: 5, P: 3,
};

function classifyPosition(pos) {
  if (!pos) return null;
  const upper = pos.toUpperCase();
  for (const [group, positions] of Object.entries(POSITION_GROUPS)) {
    if (positions.includes(upper)) return group;
  }
  return null;
}

function calculatePositionStrengths(roster) {
  const groups = {};
  for (const group of Object.keys(POSITION_WEIGHTS)) {
    groups[group] = { players: [], totalCap: 0 };
  }

  for (const player of roster) {
    const group = classifyPosition(player.position);
    if (group && groups[group]) {
      groups[group].players.push(player);
      groups[group].totalCap += player.capHit || 0;
    }
  }

  const strengths = {};
  for (const [group, data] of Object.entries(groups)) {
    const benchmark = CAP_BENCHMARKS[group];
    const count = data.players.length;
    // Score based on cap investment relative to benchmark, plus depth bonus
    let rawScore = (data.totalCap / benchmark) * 50;
    // Depth bonus: having enough players matters
    const idealDepth = group === 'QB' ? 2 : group === 'K' || group === 'P' ? 1 : group === 'OL' ? 5 : 3;
    const depthRatio = Math.min(count / idealDepth, 1.5);
    rawScore *= (0.5 + 0.5 * depthRatio);
    strengths[group] = Math.max(0, Math.min(100, rawScore));
  }

  return strengths;
}

function calculateRosterStrength(roster) {
  const strengths = calculatePositionStrengths(roster);

  let weightedSum = 0;
  let totalWeight = 0;
  for (const [group, weight] of Object.entries(POSITION_WEIGHTS)) {
    weightedSum += (strengths[group] || 0) * weight;
    totalWeight += weight;
  }

  let baseScore = weightedSum / totalWeight;

  // QB multiplier: great QB amplifies, bad QB diminishes
  const qbScore = strengths.QB || 0;
  if (qbScore > 70) {
    baseScore *= 1 + (qbScore - 70) * 0.005; // up to 15% boost
  } else if (qbScore < 30) {
    baseScore *= 0.7 + (qbScore / 30) * 0.3; // up to 30% penalty
  }

  return { overall: Math.max(0, Math.min(100, baseScore)), positions: strengths };
}

function projectWins(strengthScore, seed) {
  // Map score to expected wins: 50 -> 8.5, 70 -> 11.5, 30 -> 4.5
  const baseWins = 3 + (strengthScore / 100) * 14;
  // Randomness: ±1.5 wins
  const rng = seededRandom(seed);
  const noise = (rng() - 0.5) * 3;
  const rawWins = Math.max(0, Math.min(17, baseWins + noise));
  const wins = Math.round(rawWins);
  const losses = 17 - wins;

  // Playoff probability based on wins
  let playoffChance;
  if (wins >= 13) playoffChance = 98;
  else if (wins >= 12) playoffChance = 92;
  else if (wins >= 11) playoffChance = 78;
  else if (wins >= 10) playoffChance = 58;
  else if (wins >= 9) playoffChance = 35;
  else if (wins >= 8) playoffChance = 18;
  else if (wins >= 7) playoffChance = 8;
  else playoffChance = 3;

  // Add some noise to playoff chance
  playoffChance = Math.max(1, Math.min(99, playoffChance + Math.round((rng() - 0.5) * 10)));

  return { wins, losses, playoffChance };
}

function seededRandom(seed) {
  let s = seed;
  return function () {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

// Estimate other teams' wins (rough baseline from cap space + randomness)
function estimateTeamWins(teamAbbr, allTeams, seed) {
  const team = allTeams.find(t => t.abbreviation === teamAbbr);
  if (!team) return 8;
  // Use cap space as a rough proxy — teams with more cap space tend to be rebuilding
  // Invert: less cap space = better team (already spent on talent)
  const capSpace = team.capSpace || 30;
  let baseStrength;
  if (capSpace < 10) baseStrength = 62; // contenders, tight cap
  else if (capSpace < 25) baseStrength = 52;
  else if (capSpace < 40) baseStrength = 45;
  else if (capSpace < 55) baseStrength = 38;
  else baseStrength = 32; // rebuilding teams with tons of space

  const rng = seededRandom(seed + teamAbbr.charCodeAt(0) * 1000 + teamAbbr.charCodeAt(1) * 100);
  const noise = (rng() - 0.5) * 20;
  const score = Math.max(15, Math.min(85, baseStrength + noise));
  return projectWins(score, seed + teamAbbr.charCodeAt(0));
}

function getDivisionForTeam(teamAbbr) {
  for (const [div, teams] of Object.entries(DIVISIONS)) {
    if (teams.includes(teamAbbr)) return div;
  }
  return null;
}

export default function SeasonSimPage() {
  const { roster, currentTeamAbbr, allTeams, selectedTeamColors } = useGame();
  const [simSeed, setSimSeed] = useState(() => Date.now());

  const primaryColor = selectedTeamColors?.primaryColor || '#FB4F14';
  const accentColor = primaryColor === '#000000' ? (selectedTeamColors?.secondaryColor !== '#000000' ? selectedTeamColors?.secondaryColor : '#FB4F14') : primaryColor;

  const { overall, positions } = useMemo(() => calculateRosterStrength(roster), [roster]);

  const projection = useMemo(() => projectWins(overall, simSeed), [overall, simSeed]);

  const division = getDivisionForTeam(currentTeamAbbr);

  const divisionStandings = useMemo(() => {
    if (!division) return [];
    const teams = DIVISIONS[division];
    const standings = teams.map(abbr => {
      if (abbr === currentTeamAbbr) {
        return { abbr, ...projection };
      }
      const est = estimateTeamWins(abbr, allTeams, simSeed);
      return { abbr, ...est };
    });
    standings.sort((a, b) => b.wins - a.wins || a.losses - b.losses);
    return standings;
  }, [division, currentTeamAbbr, projection, allTeams, simSeed]);

  const teamObj = allTeams.find(t => t.abbreviation === currentTeamAbbr);
  const teamLabel = teamObj ? `${teamObj.city} ${teamObj.name}` : currentTeamAbbr;

  const handleResimulate = useCallback(() => {
    setSimSeed(Date.now() + Math.random() * 100000);
  }, []);

  // Determine season outcome text
  const outcomeText = projection.wins >= 13 ? 'DOMINANT SEASON'
    : projection.wins >= 11 ? 'PLAYOFF CONTENDER'
    : projection.wins >= 9 ? 'COMPETITIVE SEASON'
    : projection.wins >= 7 ? 'BELOW EXPECTATIONS'
    : projection.wins >= 5 ? 'REBUILDING YEAR'
    : 'TANK MODE';

  const outcomeColor = projection.wins >= 11 ? '#39FF14'
    : projection.wins >= 9 ? '#00D4FF'
    : projection.wins >= 7 ? '#facc15'
    : '#FF2D55';

  const positionGroupsOrdered = ['QB', 'WR', 'RB', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K', 'P'];

  function getStrengthColor(score) {
    if (score >= 70) return '#39FF14';
    if (score >= 50) return '#00D4FF';
    if (score >= 30) return '#facc15';
    return '#FF2D55';
  }

  function getStrengthLabel(score) {
    if (score >= 80) return 'ELITE';
    if (score >= 60) return 'STRONG';
    if (score >= 40) return 'AVERAGE';
    if (score >= 20) return 'WEAK';
    return 'CRITICAL';
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Page Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 4,
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="2">
            <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
            <path d="M4 22h16"/><path d="M10 22V10"/><path d="M14 22V10"/>
            <path d="M5 9h14l-1 7H6L5 9z"/>
          </svg>
          <h1 style={{
            fontSize: 22,
            fontWeight: 900,
            fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: '#E2E8F0',
            margin: 0,
          }}>Season Simulator</h1>
        </div>
        <p style={{ color: '#94A3B8', fontSize: 13, margin: 0 }}>
          Project your {teamLabel} season based on current roster strength
        </p>
      </div>

      {/* Big Win-Loss Display */}
      <div style={{
        background: 'rgba(15,23,42,0.85)',
        border: '1px solid rgba(0,240,255,0.15)',
        borderRadius: 16,
        padding: '32px 24px',
        textAlign: 'center',
        marginBottom: 20,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Glow accent */}
        <div style={{
          position: 'absolute',
          top: -50,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 300,
          height: 100,
          background: `radial-gradient(ellipse, ${outcomeColor}22, transparent 70%)`,
          pointerEvents: 'none',
        }} />

        <div style={{
          color: '#94A3B8',
          fontSize: 12,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
          marginBottom: 8,
        }}>2026 Season Projection</div>

        <div style={{
          fontSize: 72,
          fontWeight: 900,
          fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
          letterSpacing: '0.04em',
          color: '#E2E8F0',
          lineHeight: 1,
          marginBottom: 8,
          textShadow: `0 0 30px ${outcomeColor}44`,
        }}>
          {projection.wins}-{projection.losses}
        </div>

        <div style={{
          color: outcomeColor,
          fontSize: 16,
          fontWeight: 800,
          fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          textShadow: `0 0 12px ${outcomeColor}44`,
          marginBottom: 20,
        }}>{outcomeText}</div>

        {/* Playoff Probability */}
        <div style={{ maxWidth: 360, margin: '0 auto' }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 6,
          }}>
            <span style={{ color: '#94A3B8', fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: "'Oswald', 'Inter', system-ui, sans-serif" }}>Playoff Probability</span>
            <span style={{
              color: projection.playoffChance >= 50 ? '#39FF14' : projection.playoffChance >= 25 ? '#facc15' : '#FF2D55',
              fontSize: 22,
              fontWeight: 800,
              fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
            }}>{projection.playoffChance}%</span>
          </div>
          <div style={{
            width: '100%',
            height: 10,
            background: 'rgba(0,240,255,0.06)',
            borderRadius: 5,
            overflow: 'hidden',
            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.4)',
          }}>
            <div style={{
              width: `${projection.playoffChance}%`,
              height: '100%',
              background: projection.playoffChance >= 50
                ? 'linear-gradient(90deg, #39FF14, #2bcc0f)'
                : projection.playoffChance >= 25
                  ? 'linear-gradient(90deg, #facc15, #f59e0b)'
                  : 'linear-gradient(90deg, #FF2D55, #ef4444)',
              borderRadius: 5,
              transition: 'width 0.5s ease',
              boxShadow: `0 0 8px ${projection.playoffChance >= 50 ? 'rgba(57,255,20,0.4)' : projection.playoffChance >= 25 ? 'rgba(250,204,21,0.4)' : 'rgba(255,45,85,0.4)'}`,
            }} />
          </div>
        </div>

        {/* Roster Strength Score */}
        <div style={{ marginTop: 20 }}>
          <span style={{ color: '#94A3B8', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: "'Oswald', 'Inter', system-ui, sans-serif" }}>Overall Roster Strength</span>
          <div style={{
            fontSize: 28,
            fontWeight: 800,
            fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
            color: getStrengthColor(overall),
            textShadow: `0 0 12px ${getStrengthColor(overall)}44`,
          }}>{Math.round(overall)} / 100</div>
        </div>

        {/* Simulate Again Button */}
        <button
          onClick={handleResimulate}
          style={{
            marginTop: 24,
            background: 'linear-gradient(135deg, rgba(0,240,255,0.15), rgba(0,240,255,0.05))',
            color: '#00F0FF',
            border: '1px solid rgba(0,240,255,0.3)',
            borderRadius: 10,
            padding: '12px 32px',
            fontWeight: 800,
            fontSize: 14,
            fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            boxShadow: '0 0 16px rgba(0,240,255,0.15)',
          }}
          onMouseEnter={e => {
            e.target.style.background = 'linear-gradient(135deg, rgba(0,240,255,0.3), rgba(0,240,255,0.1))';
            e.target.style.boxShadow = '0 0 24px rgba(0,240,255,0.3)';
          }}
          onMouseLeave={e => {
            e.target.style.background = 'linear-gradient(135deg, rgba(0,240,255,0.15), rgba(0,240,255,0.05))';
            e.target.style.boxShadow = '0 0 16px rgba(0,240,255,0.15)';
          }}
        >
          <span style={{ marginRight: 8 }}>&#x21bb;</span>
          Simulate Again
        </button>
      </div>

      {/* Two-column layout for Division Standings and Position Strengths */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: 20,
        marginBottom: 20,
      }}>
        {/* Division Standings */}
        <div style={{
          background: 'rgba(15,23,42,0.85)',
          border: '1px solid rgba(0,240,255,0.15)',
          borderRadius: 14,
          padding: '20px',
        }}>
          <div style={{
            color: '#00F0FF',
            fontSize: 13,
            fontWeight: 700,
            fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
              <line x1="4" y1="22" x2="4" y2="15"/>
            </svg>
            {division || 'Division'} Standings
          </div>

          {divisionStandings.map((team, idx) => {
            const isUser = team.abbr === currentTeamAbbr;
            const teamData = allTeams.find(t => t.abbreviation === team.abbr);
            const label = teamData ? `${teamData.city} ${teamData.name}` : team.abbr;
            return (
              <div key={team.abbr} style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 12px',
                borderRadius: 8,
                marginBottom: 4,
                background: isUser ? `rgba(${hexToRgb(accentColor)}, 0.1)` : 'rgba(30,41,59,0.4)',
                border: isUser ? `1px solid ${accentColor}44` : '1px solid transparent',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background: idx === 0 ? 'rgba(57,255,20,0.15)' : 'rgba(148,163,184,0.1)',
                    color: idx === 0 ? '#39FF14' : '#94A3B8',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 700,
                    fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
                  }}>{idx + 1}</span>
                  <div>
                    <div style={{
                      color: isUser ? accentColor : '#E2E8F0',
                      fontSize: 13,
                      fontWeight: isUser ? 700 : 500,
                      fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
                      letterSpacing: '0.03em',
                    }}>{label}</div>
                    {isUser && <div style={{ color: '#94A3B8', fontSize: 10 }}>Your Team</div>}
                  </div>
                </div>
                <div style={{
                  fontSize: 18,
                  fontWeight: 800,
                  fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
                  color: isUser ? accentColor : '#E2E8F0',
                  letterSpacing: '0.04em',
                }}>{team.wins}-{team.losses}</div>
              </div>
            );
          })}

          {divisionStandings.length > 0 && (
            <div style={{
              marginTop: 10,
              padding: '8px 12px',
              background: 'rgba(0,240,255,0.04)',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#39FF14', boxShadow: '0 0 6px rgba(57,255,20,0.4)' }} />
              <span style={{ color: '#94A3B8', fontSize: 11 }}>
                {divisionStandings[0].abbr === currentTeamAbbr
                  ? 'Division Champions — auto playoff berth'
                  : `${(() => { const t = allTeams.find(t => t.abbreviation === divisionStandings[0].abbr); return t ? t.name : divisionStandings[0].abbr; })()} projected to win the division`
                }
              </span>
            </div>
          )}
        </div>

        {/* Position Group Strengths */}
        <div style={{
          background: 'rgba(15,23,42,0.85)',
          border: '1px solid rgba(0,240,255,0.15)',
          borderRadius: 14,
          padding: '20px',
        }}>
          <div style={{
            color: '#00F0FF',
            fontSize: 13,
            fontWeight: 700,
            fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/>
            </svg>
            Position Group Strength
          </div>

          {positionGroupsOrdered.map(group => {
            const score = Math.round(positions[group] || 0);
            const color = getStrengthColor(score);
            const label = getStrengthLabel(score);
            return (
              <div key={group} style={{ marginBottom: 8 }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 3,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      color: '#E2E8F0',
                      fontSize: 12,
                      fontWeight: 700,
                      fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
                      letterSpacing: '0.04em',
                      minWidth: 24,
                    }}>{group}</span>
                    <span style={{
                      color,
                      fontSize: 9,
                      fontWeight: 600,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
                    }}>{label}</span>
                  </div>
                  <span style={{
                    color,
                    fontSize: 12,
                    fontWeight: 700,
                    fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
                  }}>{score}</span>
                </div>
                <div style={{
                  width: '100%',
                  height: 6,
                  background: 'rgba(0,240,255,0.06)',
                  borderRadius: 3,
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${score}%`,
                    height: '100%',
                    background: `linear-gradient(90deg, ${color}CC, ${color})`,
                    borderRadius: 3,
                    transition: 'width 0.4s ease',
                    boxShadow: `0 0 6px ${color}44`,
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Key Insights */}
      <div style={{
        background: 'rgba(15,23,42,0.85)',
        border: '1px solid rgba(0,240,255,0.15)',
        borderRadius: 14,
        padding: '20px',
        marginBottom: 20,
      }}>
        <div style={{
          color: '#00F0FF',
          fontSize: 13,
          fontWeight: 700,
          fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
          Key Insights
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <InsightCard
            positions={positions}
            type="strength"
            groups={positionGroupsOrdered}
          />
          <InsightCard
            positions={positions}
            type="weakness"
            groups={positionGroupsOrdered}
          />
          <InsightCard
            positions={positions}
            type="qb"
            groups={positionGroupsOrdered}
          />
        </div>
      </div>
    </div>
  );
}

function InsightCard({ positions, type, groups }) {
  const coreGroups = groups.filter(g => g !== 'K' && g !== 'P');

  if (type === 'strength') {
    const best = coreGroups.reduce((a, b) => (positions[a] || 0) >= (positions[b] || 0) ? a : b);
    const score = Math.round(positions[best] || 0);
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        background: 'rgba(57,255,20,0.06)',
        border: '1px solid rgba(57,255,20,0.15)',
        borderRadius: 8,
      }}>
        <div style={{ color: '#39FF14', fontSize: 18 }}>&#9650;</div>
        <div>
          <div style={{ color: '#E2E8F0', fontSize: 13, fontWeight: 600 }}>
            <span style={{ color: '#39FF14', fontWeight: 700 }}>{best}</span> is your strongest position group
          </div>
          <div style={{ color: '#94A3B8', fontSize: 11 }}>Rated {score}/100 — giving you an edge on game day</div>
        </div>
      </div>
    );
  }

  if (type === 'weakness') {
    const worst = coreGroups.reduce((a, b) => (positions[a] || 0) <= (positions[b] || 0) ? a : b);
    const score = Math.round(positions[worst] || 0);
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        background: 'rgba(255,45,85,0.06)',
        border: '1px solid rgba(255,45,85,0.15)',
        borderRadius: 8,
      }}>
        <div style={{ color: '#FF2D55', fontSize: 18 }}>&#9660;</div>
        <div>
          <div style={{ color: '#E2E8F0', fontSize: 13, fontWeight: 600 }}>
            <span style={{ color: '#FF2D55', fontWeight: 700 }}>{worst}</span> needs attention
          </div>
          <div style={{ color: '#94A3B8', fontSize: 11 }}>Rated {score}/100 — opponents will exploit this weakness</div>
        </div>
      </div>
    );
  }

  if (type === 'qb') {
    const qbScore = Math.round(positions.QB || 0);
    const isGood = qbScore >= 60;
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        background: isGood ? 'rgba(0,212,255,0.06)' : 'rgba(250,204,21,0.06)',
        border: `1px solid ${isGood ? 'rgba(0,212,255,0.15)' : 'rgba(250,204,21,0.15)'}`,
        borderRadius: 8,
      }}>
        <div style={{ color: isGood ? '#00D4FF' : '#facc15', fontSize: 18 }}>&#9733;</div>
        <div>
          <div style={{ color: '#E2E8F0', fontSize: 13, fontWeight: 600 }}>
            QB play {isGood ? 'amplifies' : 'limits'} your roster
          </div>
          <div style={{ color: '#94A3B8', fontSize: 11 }}>
            {isGood
              ? `QB strength (${qbScore}/100) is multiplying your team's potential`
              : `QB weakness (${qbScore}/100) is holding back an otherwise capable roster`
            }
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return '0,240,255';
  return `${parseInt(result[1], 16)},${parseInt(result[2], 16)},${parseInt(result[3], 16)}`;
}

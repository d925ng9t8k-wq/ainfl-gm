import React, { useState, useCallback } from 'react';
import { useMLBGame } from '../../context/MLBGameContext';
import { MLB_DIVISIONS } from '../../data/mlb/mlbTeams';
import { mlbRosters } from '../../data/mlb/mlbRosters';

// Calculate team strength from roster
function getTeamStrength(teamAbbr, roster) {
  if (!roster || roster.length === 0) {
    // Use static data
    const teamData = mlbRosters[teamAbbr];
    if (!teamData) return 72;
    const players = teamData.players;
    return players.reduce((s, p) => s + (p.rating || 72), 0) / players.length;
  }
  return roster.reduce((s, p) => s + (p.rating || 72), 0) / roster.length;
}

// Simulate a series (7-game playoff format)
function simulateSeries(team1, team2, team1Strength, team2Strength, numGames = 7) {
  const total = team1Strength + team2Strength;
  const p1 = team1Strength / total;
  let w1 = 0, w2 = 0;
  const needed = numGames === 7 ? 4 : numGames === 5 ? 3 : 3;
  const games = [];

  while (w1 < needed && w2 < needed) {
    const homeAdvantage = games.length % 2 === 0 ? 0.03 : -0.03;
    const roll = Math.random();
    const win1 = roll < (p1 + homeAdvantage);
    if (win1) w1++;
    else w2++;
    games.push(win1 ? team1 : team2);
  }

  return { winner: w1 === needed ? team1 : team2, games: `${w1}-${w2}` };
}

// Simulate full 162-game regular season for one division
function simulateDivision(teams, strengths) {
  const standings = teams.map(abbr => ({ abbr, wins: 0, losses: 0 }));

  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      // Play 19 games per division opponent
      for (let g = 0; g < 19; g++) {
        const total = strengths[teams[i]] + strengths[teams[j]];
        const p = strengths[teams[i]] / total;
        if (Math.random() < p + (Math.random() * 0.06 - 0.03)) {
          standings[i].wins++;
          standings[j].losses++;
        } else {
          standings[j].wins++;
          standings[i].losses++;
        }
      }
    }
  }

  // Play ~56 out-of-division games (simplified: random wins based on strength)
  standings.forEach(s => {
    const abbr = s.abbr;
    const strength = strengths[abbr];
    const remaining = 162 - (s.wins + s.losses);
    const expectedWinPct = 0.35 + (strength - 65) / 100; // 65 rating = .35 win%, 85 = .55
    const wins = Math.round(remaining * Math.min(0.70, Math.max(0.30, expectedWinPct + (Math.random() * 0.08 - 0.04))));
    s.wins += wins;
    s.losses += (remaining - wins);
  });

  return standings.sort((a, b) => b.wins - a.wins);
}

export default function MLBSeasonSimPage() {
  const { roster, currentTeamAbbr, allTeams, selectedTeamColors } = useMLBGame();
  const [simState, setSimState] = useState(null);
  const [simRunning, setSimRunning] = useState(false);
  const [playoffState, setPlayoffState] = useState(null);
  const [playoffRound, setPlayoffRound] = useState(0);

  const accentColor = selectedTeamColors?.primaryColor || '#003087';

  const runSeason = useCallback(() => {
    setSimRunning(true);
    setPlayoffState(null);
    setPlayoffRound(0);

    setTimeout(() => {
      // Build strength map
      const strengths = {};
      allTeams.forEach(t => {
        const teamRoster = mlbRosters[t.abbreviation]?.players || [];
        strengths[t.abbreviation] = getTeamStrength(t.abbreviation === currentTeamAbbr ? null : null, null);
      });
      // Use static data but boost player's team if they've made moves
      allTeams.forEach(t => {
        const teamRoster = t.abbreviation === currentTeamAbbr ? roster : (mlbRosters[t.abbreviation]?.players || []);
        const ratings = teamRoster.map(p => p.rating || 72);
        strengths[t.abbreviation] = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 72;
      });

      // Simulate each division
      const divisionResults = {};
      for (const [divName, divTeams] of Object.entries(MLB_DIVISIONS)) {
        divisionResults[divName] = simulateDivision(divTeams, strengths);
      }

      // Wild card: top 2 non-division-winners in each league
      const alDivs = ['AL East', 'AL Central', 'AL West'];
      const nlDivs = ['NL East', 'NL Central', 'NL West'];

      function getPlayoffTeams(divs) {
        const divWinners = divs.map(d => divisionResults[d][0]);
        // All non-winners, sorted by wins
        const nonWinners = divs.flatMap(d => divisionResults[d].slice(1));
        nonWinners.sort((a, b) => b.wins - a.wins);
        const wildcards = nonWinners.slice(0, 3); // 3 wild cards per league
        return [...divWinners, ...wildcards];
      }

      const alPlayoff = getPlayoffTeams(alDivs);
      const nlPlayoff = getPlayoffTeams(nlDivs);

      setSimState({ divisionResults, alPlayoff, nlPlayoff, strengths });
      setSimRunning(false);
    }, 800);
  }, [roster, allTeams, currentTeamAbbr]);

  function simPlayoffs() {
    if (!simState) return;
    const { alPlayoff, nlPlayoff, strengths } = simState;

    // Wild card round (3 vs 6, 4 vs 5)
    function simWildCard(teams) {
      const s3 = simulateSeries(teams[2].abbr, teams[5].abbr, strengths[teams[2].abbr], strengths[teams[5].abbr], 3);
      const s4 = simulateSeries(teams[3].abbr, teams[4].abbr, strengths[teams[3].abbr], strengths[teams[4].abbr], 3);
      return [teams[0], teams[1], s3.winner, s4.winner].map(abbr => typeof abbr === 'string' ? { abbr } : abbr);
    }

    function simDivSeries(teams) {
      // 1 vs 4, 2 vs 3
      const s1 = simulateSeries(teams[0].abbr, teams[3].abbr, strengths[teams[0].abbr], strengths[teams[3].abbr], 5);
      const s2 = simulateSeries(teams[1].abbr, teams[2].abbr, strengths[teams[1].abbr], strengths[teams[2].abbr], 5);
      return [{ abbr: s1.winner }, { abbr: s2.winner }];
    }

    const alWC = simWildCard(alPlayoff);
    const nlWC = simWildCard(nlPlayoff);
    const alDS = simDivSeries(alWC);
    const nlDS = simDivSeries(nlWC);
    const alCS = simulateSeries(alDS[0].abbr, alDS[1].abbr, strengths[alDS[0].abbr], strengths[alDS[1].abbr], 7);
    const nlCS = simulateSeries(nlDS[0].abbr, nlDS[1].abbr, strengths[nlDS[0].abbr], strengths[nlDS[1].abbr], 7);
    const ws = simulateSeries(alCS.winner, nlCS.winner, strengths[alCS.winner], strengths[nlCS.winner], 7);

    setPlayoffState({ alWC, nlWC, alDS, nlDS, alCS, nlCS, ws });
  }

  function getTeamName(abbr) {
    const t = allTeams.find(t => t.abbreviation === abbr);
    return t ? `${t.city} ${t.name}` : abbr;
  }

  function TeamDisplay({ abbr, isChamp = false, isUser = false }) {
    const t = allTeams.find(t => t.abbreviation === abbr);
    const isMyTeam = abbr === currentTeamAbbr;
    return (
      <span style={{
        fontWeight: isMyTeam ? 900 : 600,
        color: isMyTeam ? (accentColor || '#00C853') : '#E2E8F0',
        background: isChamp ? 'rgba(251,191,36,0.15)' : 'transparent',
        padding: isChamp ? '2px 6px' : 0,
        borderRadius: isChamp ? 4 : 0,
      }}>
        {t ? `${t.city} ${t.name}` : abbr} {isChamp ? '🏆' : ''}
      </span>
    );
  }

  return (
    <div style={{ color: '#E2E8F0' }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: '0 0 4px', fontFamily: "'Oswald', sans-serif", fontSize: 22, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Season Simulator
        </h2>
        <div style={{ color: '#94A3B8', fontSize: 13 }}>Simulate the full 162-game MLB season and playoffs. Your roster changes affect the outcome.</div>
      </div>

      {/* Sim Controls */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <button
          onClick={runSeason}
          disabled={simRunning}
          style={{
            background: 'rgba(0,200,83,0.2)', border: '1px solid rgba(0,200,83,0.5)', color: '#00C853',
            borderRadius: 8, padding: '10px 20px', fontSize: 14, cursor: simRunning ? 'not-allowed' : 'pointer',
            fontWeight: 700, fontFamily: "'Oswald', sans-serif", textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
          {simRunning ? 'Simulating...' : 'Simulate Season'}
        </button>
        {simState && (
          <button
            onClick={simPlayoffs}
            style={{
              background: 'rgba(251,191,36,0.2)', border: '1px solid rgba(251,191,36,0.5)', color: '#fbbf24',
              borderRadius: 8, padding: '10px 20px', fontSize: 14, cursor: 'pointer',
              fontWeight: 700, fontFamily: "'Oswald', sans-serif", textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
            Simulate Playoffs
          </button>
        )}
      </div>

      {/* Division Standings */}
      {simState && (
        <div>
          <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 14, color: '#94A3B8' }}>
            Regular Season Standings
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, marginBottom: 24 }}>
            {Object.entries(simState.divisionResults).map(([divName, standings]) => (
              <div key={divName} style={{ background: 'rgba(30,41,59,0.5)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ background: 'rgba(0,200,83,0.1)', padding: '8px 12px', fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#00C853' }}>
                  {divName}
                </div>
                {standings.map((s, i) => {
                  const t = allTeams.find(t => t.abbreviation === s.abbr);
                  const isMyTeam = s.abbr === currentTeamAbbr;
                  const isWild = i >= 1 && i <= 3;
                  return (
                    <div key={s.abbr} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '8px 12px', borderBottom: i < standings.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                      background: isMyTeam ? 'rgba(0,200,83,0.06)' : 'transparent',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: '#475569', fontSize: 12, minWidth: 16 }}>{i + 1}</span>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: isMyTeam ? 800 : 600, color: isMyTeam ? '#00C853' : '#E2E8F0' }}>
                            {t ? `${t.city} ${t.name}` : s.abbr}
                          </div>
                          <div style={{ fontSize: 10, color: '#64748b' }}>
                            {i === 0 ? 'Division Leader' : isWild ? 'Wild Card' : 'Out'}
                          </div>
                        </div>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: i === 0 ? '#4ade80' : '#94A3B8' }}>
                        {s.wins}-{s.losses}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Playoff Bracket */}
          {playoffState && (
            <div>
              <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 14, color: '#fbbf24' }}>
                Playoff Results
              </div>

              {/* AL Playoffs */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: '#94A3B8', fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>American League</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    ALDS: <TeamDisplay abbr={playoffState.alDS[0].abbr} /> vs <TeamDisplay abbr={playoffState.alDS[1].abbr} />
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>
                    ALCS Winner: <TeamDisplay abbr={playoffState.alCS.winner} />
                  </div>
                </div>
              </div>

              {/* NL Playoffs */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: '#94A3B8', fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>National League</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    NLDS: <TeamDisplay abbr={playoffState.nlDS[0].abbr} /> vs <TeamDisplay abbr={playoffState.nlDS[1].abbr} />
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>
                    NLCS Winner: <TeamDisplay abbr={playoffState.nlCS.winner} />
                  </div>
                </div>
              </div>

              {/* World Series */}
              <div style={{
                background: 'linear-gradient(135deg, rgba(251,191,36,0.12), rgba(251,191,36,0.05))',
                border: '2px solid rgba(251,191,36,0.4)', borderRadius: 12, padding: '20px 24px', marginBottom: 16,
              }}>
                <div style={{ fontSize: 11, color: '#fbbf24', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>World Series</div>
                <div style={{ fontSize: 14, color: '#94A3B8', marginBottom: 10 }}>
                  <TeamDisplay abbr={playoffState.alCS.winner} /> vs <TeamDisplay abbr={playoffState.nlCS.winner} />
                </div>
                <div style={{ fontSize: 22, fontWeight: 900, fontFamily: "'Oswald', sans-serif" }}>
                  World Series Champion: <TeamDisplay abbr={playoffState.ws.winner} isChamp={true} />
                </div>
                {playoffState.ws.winner === currentTeamAbbr && (
                  <div style={{ marginTop: 10, fontSize: 14, color: '#00C853', fontWeight: 700 }}>
                    Your team won the World Series! Your moves made the difference.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {!simState && !simRunning && (
        <div style={{ textAlign: 'center', padding: 48, color: '#475569', background: 'rgba(30,41,59,0.3)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚾</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Ready to Simulate</div>
          <div style={{ fontSize: 13 }}>Hit "Simulate Season" to run all 30 teams through a 162-game season. Your roster changes affect your team's strength.</div>
        </div>
      )}
    </div>
  );
}

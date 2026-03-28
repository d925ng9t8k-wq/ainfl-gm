import React, { useState, useMemo } from 'react';
import { useNbaGame } from '../../context/NbaGameContext';

// NBA divisions
const DIVISIONS = {
  'Atlantic': ['BOS', 'BKN', 'NYK', 'PHI', 'TOR'],
  'Central': ['CHI', 'CLE', 'DET', 'IND', 'MIL'],
  'Southeast': ['ATL', 'CHA', 'MIA', 'ORL', 'WAS'],
  'Northwest': ['DEN', 'MIN', 'OKC', 'POR', 'UTA'],
  'Pacific': ['GSW', 'LAC', 'LAL', 'PHX', 'SAC'],
  'Southwest': ['DAL', 'HOU', 'MEM', 'NOP', 'SAS'],
};

const CONFERENCE_MAP = {
  'Atlantic': 'East', 'Central': 'East', 'Southeast': 'East',
  'Northwest': 'West', 'Pacific': 'West', 'Southwest': 'West',
};

function getConference(abbr) {
  for (const [div, teams] of Object.entries(DIVISIONS)) {
    if (teams.includes(abbr)) return CONFERENCE_MAP[div];
  }
  return 'West';
}

// Calculate team rating based on roster
function getTeamRating(roster) {
  if (!roster || roster.length === 0) return 72;
  const sorted = [...roster].sort((a, b) => (b.rating || 70) - (a.rating || 70));
  const top8 = sorted.slice(0, 8);
  const avg = top8.reduce((s, p) => s + (p.rating || 70), 0) / top8.length;
  return Math.round(avg);
}

function simulateSeason(allTeams, userRoster, userAbbr, nbaRosters) {
  const teams = allTeams.map(t => {
    const roster = t.abbreviation === userAbbr ? userRoster : (nbaRosters[t.abbreviation]?.players || []);
    const rating = getTeamRating(roster);
    // Add randomness (variance) to make it fun
    const variance = (Math.random() - 0.5) * 12;
    const adjustedRating = Math.max(50, rating + variance);
    const wins = Math.min(82, Math.max(10, Math.round((adjustedRating - 60) * 1.4 + 41)));
    return {
      ...t,
      rating: Math.round(adjustedRating),
      wins,
      losses: 82 - wins,
      conference: getConference(t.abbreviation),
      isUser: t.abbreviation === userAbbr,
    };
  });

  // Sort by conference, then wins
  const east = teams.filter(t => t.conference === 'East').sort((a, b) => b.wins - a.wins);
  const west = teams.filter(t => t.conference === 'West').sort((a, b) => b.wins - a.wins);

  return { east, west };
}

function simulatePlayoffs(seeds) {
  // Simple 8-team bracket sim
  function playGame(t1, t2) {
    const r1 = t1.rating + (Math.random() - 0.5) * 10;
    const r2 = t2.rating + (Math.random() - 0.5) * 10;
    return r1 > r2 ? t1 : t2;
  }
  function simulateSeries(t1, t2) {
    let w1 = 0, w2 = 0;
    while (w1 < 4 && w2 < 4) {
      const winner = playGame(t1, t2);
      if (winner === t1) w1++; else w2++;
    }
    return w1 === 4 ? t1 : t2;
  }
  const round1 = [
    simulateSeries(seeds[0], seeds[7]),
    simulateSeries(seeds[1], seeds[6]),
    simulateSeries(seeds[2], seeds[5]),
    simulateSeries(seeds[3], seeds[4]),
  ];
  const round2 = [
    simulateSeries(round1[0], round1[3]),
    simulateSeries(round1[1], round1[2]),
  ];
  const confChampion = simulateSeries(round2[0], round2[1]);
  return { round1, round2, confChampion };
}

export default function NbaSeasonSimPage() {
  const { roster, allTeams, currentTeamAbbr } = useNbaGame();
  const [simResult, setSimResult] = useState(null);
  const [playoffs, setPlayoffs] = useState(null);
  const [champion, setChampion] = useState(null);
  const [simming, setSimming] = useState(false);

  // Dynamic import of nbaRosters to avoid circular dependency
  const [nbaRostersLoaded, setNbaRostersLoaded] = useState(null);
  React.useEffect(() => {
    import('../../data/nba/nbaRosters').then(m => setNbaRostersLoaded(m.nbaRosters));
  }, []);

  function runSim() {
    if (!nbaRostersLoaded) return;
    setSimming(true);
    setTimeout(() => {
      const result = simulateSeason(allTeams, roster, currentTeamAbbr, nbaRostersLoaded);
      setSimResult(result);

      // Playoff simulation
      const eastSeeds = result.east.slice(0, 8);
      const westSeeds = result.west.slice(0, 8);
      const eastPlayoffs = simulatePlayoffs(eastSeeds);
      const westPlayoffs = simulatePlayoffs(westSeeds);

      // Finals
      const finalist1 = eastPlayoffs.confChampion;
      const finalist2 = westPlayoffs.confChampion;
      let fw1 = 0, fw2 = 0;
      while (fw1 < 4 && fw2 < 4) {
        const r1 = finalist1.rating + (Math.random() - 0.5) * 10;
        const r2 = finalist2.rating + (Math.random() - 0.5) * 10;
        if (r1 > r2) fw1++; else fw2++;
      }
      const finalsChamp = fw1 === 4 ? finalist1 : finalist2;

      setPlayoffs({ east: eastPlayoffs, west: westPlayoffs, finalist1, finalist2, fw1, fw2 });
      setChampion(finalsChamp);
      setSimming(false);
    }, 300);
  }

  const userTeam = simResult
    ? [...simResult.east, ...simResult.west].find(t => t.abbreviation === currentTeamAbbr)
    : null;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#FFA500', fontFamily: "'Oswald', sans-serif", letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
          Season Simulator
        </div>
        <div style={{ fontSize: 13, color: '#64748B' }}>Simulate the full 82-game season and NBA Playoffs based on your current roster.</div>
      </div>

      <button onClick={runSim} disabled={simming || !nbaRostersLoaded}
        style={{
          padding: '12px 32px', marginBottom: 24,
          background: simming ? 'rgba(30,41,59,0.5)' : 'linear-gradient(135deg, rgba(255,160,0,0.25), rgba(255,107,0,0.15))',
          border: '1px solid rgba(255,160,0,0.4)', borderRadius: 8,
          color: simming ? '#64748B' : '#FFA500', fontWeight: 800, fontSize: 15,
          cursor: simming ? 'not-allowed' : 'pointer',
          fontFamily: "'Oswald', sans-serif", letterSpacing: '0.1em', textTransform: 'uppercase',
        }}>
        {simming ? 'Simulating...' : simResult ? 'Re-Simulate Season' : 'Simulate Season'}
      </button>

      {champion && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(255,215,0,0.15), rgba(255,160,0,0.08))',
          border: '2px solid rgba(255,215,0,0.4)', borderRadius: 12, padding: '20px 24px', marginBottom: 24,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 24, fontWeight: 900, color: '#FFD700', fontFamily: "'Oswald', sans-serif", letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            NBA CHAMPION
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#FFA500', marginTop: 4 }}>
            {champion.city} {champion.name}
          </div>
          <div style={{ fontSize: 14, color: '#94A3B8', marginTop: 4 }}>
            Regular Season: {champion.wins}-{champion.losses} &bull; Rating: {champion.rating}
          </div>
          {champion.isUser && (
            <div style={{ fontSize: 16, color: '#FFD700', fontWeight: 800, marginTop: 10 }}>
              CONGRATULATIONS — YOUR TEAM WON THE CHAMPIONSHIP!
            </div>
          )}
        </div>
      )}

      {playoffs && (
        <div style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(255,160,0,0.1)', borderRadius: 10, padding: 16, marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#FFA500', marginBottom: 12, fontFamily: "'Oswald', sans-serif", letterSpacing: '0.08em', textTransform: 'uppercase' }}>NBA Finals</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ fontSize: 14, color: '#E2E8F0', fontWeight: 600 }}>
              <span style={{ color: playoffs.finalist1.isUser ? '#FFA500' : '#94A3B8' }}>{playoffs.finalist1.city} {playoffs.finalist1.name} ({playoffs.finalist1.conference})</span>
              {' '}<span style={{ color: '#64748B' }}>vs</span>{' '}
              <span style={{ color: playoffs.finalist2.isUser ? '#FFA500' : '#94A3B8' }}>{playoffs.finalist2.city} {playoffs.finalist2.name} ({playoffs.finalist2.conference})</span>
            </div>
            {champion && (
              <div style={{ fontSize: 13, color: '#FFD700', fontWeight: 700 }}>
                {champion.city} {champion.name} wins {champion === playoffs.finalist1 ? `4-${playoffs.fw2}` : `4-${playoffs.fw1}`}
              </div>
            )}
          </div>
        </div>
      )}

      {simResult && userTeam && (
        <div style={{ background: 'rgba(255,160,0,0.06)', border: '1px solid rgba(255,160,0,0.2)', borderRadius: 10, padding: 14, marginBottom: 20 }}>
          <div style={{ fontSize: 13, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Your Team Result</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#FFA500', fontFamily: "'Oswald', sans-serif" }}>
            {userTeam.city} {userTeam.name}: {userTeam.wins}-{userTeam.losses}
          </div>
          <div style={{ fontSize: 13, color: '#94A3B8', marginTop: 4 }}>
            {userTeam.conference} Conference &bull; Rating: {userTeam.rating} &bull;{' '}
            {userTeam.wins >= 50 ? 'Championship Contender' :
              userTeam.wins >= 41 ? 'Playoff Team' :
                userTeam.wins >= 35 ? 'Play-In Contender' : 'Lottery Bound'}
          </div>
        </div>
      )}

      {simResult && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {['East', 'West'].map(conf => {
            const standings = conf === 'East' ? simResult.east : simResult.west;
            return (
              <div key={conf} style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ background: 'rgba(15,23,42,0.8)', padding: '10px 14px', fontSize: 13, fontWeight: 700, color: '#FFA500', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {conf}ern Conference
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr style={{ background: 'rgba(15,23,42,0.6)' }}>
                    {['#', 'Team', 'W', 'L', 'Rating'].map(h => (
                      <th key={h} style={{ padding: '6px 8px', color: '#64748B', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', textAlign: h === 'Team' ? 'left' : 'center' }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {standings.map((t, idx) => (
                      <tr key={t.abbreviation} style={{
                        background: t.isUser ? 'rgba(255,160,0,0.1)' : idx < 6 ? 'transparent' : idx < 8 ? 'rgba(255,255,255,0.02)' : 'transparent',
                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                        borderLeft: idx < 6 ? '2px solid rgba(16,185,129,0.3)' : idx < 8 ? '2px solid rgba(255,160,0,0.2)' : '2px solid transparent',
                      }}>
                        <td style={{ padding: '5px 8px', color: '#64748B', textAlign: 'center', fontWeight: 700 }}>
                          {idx + 1}
                          {idx < 6 && <span style={{ fontSize: 8, color: '#10b981', marginLeft: 2 }}>P</span>}
                          {idx >= 6 && idx < 8 && <span style={{ fontSize: 8, color: '#FFA500', marginLeft: 2 }}>PI</span>}
                        </td>
                        <td style={{ padding: '5px 8px', color: t.isUser ? '#FFA500' : '#E2E8F0', fontWeight: t.isUser ? 700 : 400 }}>
                          {t.abbreviation}
                        </td>
                        <td style={{ padding: '5px 8px', color: '#10b981', fontWeight: 700, textAlign: 'center' }}>{t.wins}</td>
                        <td style={{ padding: '5px 8px', color: '#64748B', textAlign: 'center' }}>{t.losses}</td>
                        <td style={{ padding: '5px 8px', color: '#94A3B8', textAlign: 'center' }}>{t.rating}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ padding: '6px 10px', fontSize: 10, color: '#475569', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                  P = Playoff Seed | PI = Play-In (7-10 seeds)
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

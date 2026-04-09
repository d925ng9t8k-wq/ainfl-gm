import React, { useState, useEffect, useRef } from 'react';
import { useNbaGame } from '../../context/NbaGameContext';

const POS_COLORS = { PG: '#00F0FF', SG: '#FFA500', SF: '#10b981', PF: '#8b5cf6', C: '#ec4899' };

function GradeBadge({ grade }) {
  const color = grade >= 95 ? '#FFD700' : grade >= 85 ? '#10b981' : grade >= 70 ? '#FFA500' : '#94A3B8';
  return (
    <span style={{ padding: '2px 8px', borderRadius: 5, fontSize: 11, fontWeight: 700, background: `${color}22`, border: `1px solid ${color}66`, color }}>
      {grade}
    </span>
  );
}

export default function NbaDraftPage() {
  const {
    draftBoard, draftedPlayers, myPicks, draftStarted, draftComplete,
    draftPlayer, cpuDraftPlayer, startDraft, completeDraft, resetDraft, addDraftClass,
    draftClassAdded, currentDraftPick, currentTeamAbbr, allTeams,
  } = useNbaGame();

  const [searchQuery, setSearchQuery] = useState('');
  const [autoSimming, setAutoSimming] = useState(false);
  const [draftLog, setDraftLog] = useState([]);
  const [filterRound, setFilterRound] = useState('All');
  const simRef = useRef(null);

  const ALL_PICKS = Array.from({ length: 60 }, (_, i) => i + 1);
  const totalPicks = 60;

  const myPickNumbers = myPicks.map(pk => pk.overall);

  const currentPickNumber = currentDraftPick + 1;
  const currentPickObj = currentPickNumber <= totalPicks ? {
    overall: currentPickNumber,
    round: currentPickNumber <= 30 ? 1 : 2,
    pick: currentPickNumber <= 30 ? currentPickNumber : currentPickNumber - 30,
  } : null;

  const isMyPick = currentPickObj && myPickNumbers.includes(currentPickObj.overall);

  function handleDraftPlayer(prospect) {
    if (!currentPickObj) return;
    draftPlayer(prospect, currentPickObj.overall);
    setDraftLog(log => [...log, {
      pick: currentPickObj.overall,
      round: currentPickObj.round,
      team: currentTeamAbbr,
      player: prospect.name,
      position: prospect.position,
      school: prospect.school,
      grade: prospect.grade,
    }]);
    if (currentPickNumber >= totalPicks) completeDraft();
  }

  function cpuPick(pickNumber) {
    if (draftBoard.length === 0) return null;
    // CPU picks best available
    const best = [...draftBoard].sort((a, b) => b.grade - a.grade)[0];
    if (!best) return null;
    const teamIdx = (pickNumber - 1) % allTeams.length;
    const teamAbbr = allTeams[teamIdx]?.abbreviation || 'CPU';
    cpuDraftPlayer(best, pickNumber, teamAbbr);
    setDraftLog(log => [...log, {
      pick: pickNumber,
      round: pickNumber <= 30 ? 1 : 2,
      team: teamAbbr,
      player: best.name,
      position: best.position,
      school: best.school,
      grade: best.grade,
    }]);
    return best;
  }

  // Auto-sim: run CPU picks until it's the user's turn or draft ends
  useEffect(() => {
    if (!autoSimming || !draftStarted || draftComplete) {
      setAutoSimming(false);
      return;
    }
    if (isMyPick || currentPickNumber > totalPicks) {
      setAutoSimming(false);
      return;
    }
    simRef.current = setTimeout(() => {
      cpuPick(currentPickNumber);
      if (currentPickNumber >= totalPicks) completeDraft();
    }, 120);
    return () => clearTimeout(simRef.current);
  }, [autoSimming, currentPickNumber, draftStarted, draftComplete, isMyPick]);

  const filteredBoard = draftBoard
    .filter(p => filterRound === 'All' || p.round === parseInt(filterRound))
    .filter(p => !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()));

  const myDraftedThisSim = draftedPlayers;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#FFA500', fontFamily: "'Oswald', sans-serif", letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
          2026 NBA Draft
        </div>
        <div style={{ fontSize: 13, color: '#64748B' }}>
          2 rounds, 60 picks total. Lottery order determines Round 1 position.
        </div>
      </div>

      {/* My picks summary */}
      <div style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(255,160,0,0.15)', borderRadius: 10, padding: 14, marginBottom: 18 }}>
        <div style={{ fontSize: 12, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Your Draft Picks</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {myPicks.length === 0 ? (
            <span style={{ fontSize: 12, color: '#475569' }}>No picks — all traded away</span>
          ) : myPicks.map(pk => (
            <span key={pk.overall} style={{
              fontSize: 12, padding: '4px 10px', borderRadius: 6, fontWeight: 700,
              background: 'rgba(255,160,0,0.15)', border: '1px solid rgba(255,160,0,0.3)', color: '#FFA500',
            }}>
              R{pk.round} #{pk.overall}
            </span>
          ))}
        </div>
      </div>

      {/* Draft controls */}
      {!draftStarted ? (
        <div style={{ textAlign: 'center', padding: '30px 0' }}>
          <div style={{ fontSize: 15, color: '#94A3B8', marginBottom: 16 }}>Ready to run the 2026 NBA Draft?</div>
          <button onClick={startDraft} style={{
            padding: '12px 32px', background: 'linear-gradient(135deg, rgba(255,160,0,0.25), rgba(255,107,0,0.15))',
            border: '1px solid rgba(255,160,0,0.4)', borderRadius: 8, color: '#FFA500',
            fontWeight: 800, fontSize: 16, cursor: 'pointer', fontFamily: "'Oswald', sans-serif",
            letterSpacing: '0.1em', textTransform: 'uppercase',
          }}>Start Draft</button>
        </div>
      ) : draftComplete ? (
        <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 10, padding: 16, marginBottom: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#10b981', marginBottom: 8 }}>Draft Complete!</div>
          {myDraftedThisSim.length > 0 && (
            <div style={{ fontSize: 13, color: '#CBD5E1', marginBottom: 12 }}>
              You selected: {myDraftedThisSim.map(p => `${p.name} (${p.position})`).join(', ')}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {!draftClassAdded && (
              <button onClick={addDraftClass} style={{
                padding: '8px 20px', background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.4)',
                borderRadius: 6, color: '#10b981', fontWeight: 700, cursor: 'pointer', fontSize: 13,
              }}>Add Rookies to Roster</button>
            )}
            <button onClick={resetDraft} style={{
              padding: '8px 20px', background: 'rgba(30,41,59,0.8)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6, color: '#94A3B8', cursor: 'pointer', fontSize: 13,
            }}>Reset Draft</button>
          </div>
        </div>
      ) : (
        <div style={{ background: 'rgba(15,23,42,0.6)', border: `1px solid ${isMyPick ? 'rgba(255,160,0,0.4)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 10, padding: 14, marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Current Pick</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: isMyPick ? '#FFA500' : '#94A3B8', fontFamily: "'Oswald', sans-serif" }}>
                {currentPickObj ? `Round ${currentPickObj.round}, Pick ${currentPickObj.pick} (Overall #${currentPickObj.overall})` : 'Draft Complete'}
              </div>
            </div>
            {currentPickObj && (
              <div>
                <div style={{ fontSize: 11, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Picking Team</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: isMyPick ? '#FFA500' : '#E2E8F0' }}>
                  {isMyPick ? `YOU (${currentTeamAbbr})` : allTeams[(currentPickNumber - 1) % allTeams.length]?.city + ' ' + allTeams[(currentPickNumber - 1) % allTeams.length]?.name}
                </div>
              </div>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              {!isMyPick && !autoSimming && (
                <button onClick={() => { cpuPick(currentPickNumber); if (currentPickNumber >= totalPicks) completeDraft(); }}
                  style={{ padding: '6px 14px', background: 'rgba(30,41,59,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#94A3B8', cursor: 'pointer', fontSize: 12 }}>
                  CPU Pick
                </button>
              )}
              {!isMyPick && (
                <button onClick={() => setAutoSimming(a => !a)}
                  style={{
                    padding: '6px 14px', background: autoSimming ? 'rgba(255,160,0,0.15)' : 'rgba(30,41,59,0.8)',
                    border: autoSimming ? '1px solid rgba(255,160,0,0.4)' : '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6, color: autoSimming ? '#FFA500' : '#94A3B8', cursor: 'pointer', fontSize: 12, fontWeight: autoSimming ? 700 : 400,
                  }}>
                  {autoSimming ? 'Auto-Sim ON' : 'Auto-Sim'}
                </button>
              )}
            </div>
          </div>
          {isMyPick && (
            <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(255,160,0,0.08)', borderRadius: 6, fontSize: 12, color: '#FFA500', fontWeight: 600 }}>
              YOUR PICK — Select a player from the board below
            </div>
          )}
        </div>
      )}

      {/* Draft board */}
      {draftStarted && !draftComplete && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search prospect..."
              style={{ background: 'rgba(30,41,59,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '6px 10px', color: '#E2E8F0', fontSize: 13, outline: 'none', width: 160 }}
            />
            {['All', '1', '2'].map(r => (
              <button key={r} onClick={() => setFilterRound(r)} style={{
                padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                background: filterRound === r ? 'rgba(255,160,0,0.15)' : 'rgba(30,41,59,0.5)',
                border: filterRound === r ? '1px solid rgba(255,160,0,0.4)' : '1px solid rgba(255,255,255,0.08)',
                color: filterRound === r ? '#FFA500' : '#94A3B8',
              }}>{r === 'All' ? 'All Rounds' : `Round ${r}`}</button>
            ))}
          </div>
          <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ background: 'rgba(15,23,42,0.8)' }}>
                <tr>
                  {['Rank', 'Player', 'Pos', 'School', 'Age', 'Grade', 'Action'].map(h => (
                    <th key={h} style={{ padding: '8px 8px', color: '#64748B', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredBoard.slice(0, 40).map((p, idx) => (
                  <tr key={p.id} style={{ background: idx % 2 === 0 ? 'rgba(15,23,42,0.3)' : 'transparent', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '8px 8px', color: '#64748B', fontWeight: 700 }}>#{p.rank}</td>
                    <td style={{ padding: '8px 8px', fontWeight: 600, color: '#E2E8F0' }}>
                      {p.name}
                      {p.round === 1 && p.rank <= 5 && <span style={{ marginLeft: 6, fontSize: 9, color: '#FFD700', background: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.2)', borderRadius: 3, padding: '1px 4px' }}>LOTTERY</span>}
                    </td>
                    <td style={{ padding: '8px 8px', color: POS_COLORS[p.position] || '#94A3B8', fontWeight: 700, fontSize: 12 }}>{p.position}</td>
                    <td style={{ padding: '8px 8px', color: '#64748B' }}>{p.school}</td>
                    <td style={{ padding: '8px 8px', color: '#64748B' }}>{p.age}</td>
                    <td style={{ padding: '8px 8px' }}><GradeBadge grade={p.grade} /></td>
                    <td style={{ padding: '8px 8px' }}>
                      {isMyPick && draftStarted && !draftComplete ? (
                        <button onClick={() => handleDraftPlayer(p)} style={{
                          padding: '4px 12px', background: 'rgba(255,160,0,0.2)', border: '1px solid rgba(255,160,0,0.4)',
                          borderRadius: 4, color: '#FFA500', fontSize: 11, cursor: 'pointer', fontWeight: 700,
                        }}>Draft</button>
                      ) : (
                        <span style={{ fontSize: 11, color: '#475569' }}>Avail.</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Draft log */}
      {draftLog.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 12, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Draft Results</div>
          <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid rgba(255,255,255,0.04)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: 'rgba(15,23,42,0.8)' }}>
                {['Pick', 'Team', 'Player', 'Pos', 'School', 'Grade'].map(h => (
                  <th key={h} style={{ padding: '6px 8px', color: '#64748B', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', textAlign: 'left' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {[...draftLog].reverse().map((entry, idx) => (
                  <tr key={idx} style={{
                    background: entry.team === currentTeamAbbr ? 'rgba(255,160,0,0.08)' : idx % 2 === 0 ? 'rgba(15,23,42,0.3)' : 'transparent',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                  }}>
                    <td style={{ padding: '6px 8px', color: '#94A3B8', fontWeight: 700 }}>#{entry.pick}</td>
                    <td style={{ padding: '6px 8px', color: entry.team === currentTeamAbbr ? '#FFA500' : '#64748B', fontWeight: entry.team === currentTeamAbbr ? 700 : 400 }}>{entry.team}</td>
                    <td style={{ padding: '6px 8px', fontWeight: 600, color: entry.team === currentTeamAbbr ? '#FFA500' : '#E2E8F0' }}>{entry.player}</td>
                    <td style={{ padding: '6px 8px', color: POS_COLORS[entry.position] || '#94A3B8', fontSize: 11 }}>{entry.position}</td>
                    <td style={{ padding: '6px 8px', color: '#64748B' }}>{entry.school}</td>
                    <td style={{ padding: '6px 8px' }}><GradeBadge grade={entry.grade} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

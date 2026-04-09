import React, { useState, useMemo } from 'react';
import { useMLBGame } from '../../context/MLBGameContext';
import { mlbRosters } from '../../data/mlb/mlbRosters';

// MLB trade value: rating-based with age/contract adjustments
function getMLBPlayerValue(player) {
  if (!player) return 0;
  const ratingVal = player.rating || 65;
  const ageBonus = player.age <= 26 ? 15 : player.age <= 29 ? 8 : player.age <= 32 ? 0 : -10;
  const yearsBonus = player.contractYears > 3 ? 5 : player.contractYears > 1 ? 0 : -5;
  const salaryPenalty = player.salary > 25 ? -8 : player.salary > 15 ? -3 : 0;
  const serviceBonus = player.serviceTime < 3 ? 12 : player.serviceTime < 5 ? 5 : 0; // pre-arb is valuable
  return Math.max(0, ratingVal + ageBonus + yearsBonus + salaryPenalty + serviceBonus);
}

function getTeamPlayers(teamAbbr) {
  const teamData = mlbRosters[teamAbbr];
  if (!teamData) return [];
  return teamData.players.map((p, i) => ({ ...p, id: `${teamAbbr}-${i}` }));
}

// Simple AI GM evaluation
function evaluateTradeForAI(myPlayers, theirPlayers) {
  const myVal = myPlayers.reduce((s, p) => s + getMLBPlayerValue(p), 0);
  const theirVal = theirPlayers.reduce((s, p) => s + getMLBPlayerValue(p), 0);

  if (theirVal === 0) return { accepted: false, reason: 'No players included in return.' };
  if (myVal === 0) return { accepted: true, reason: 'GM accepted — getting value for nothing!' };

  const ratio = theirVal / myVal;
  if (ratio >= 0.85) return { accepted: true, reason: 'GM accepted the trade — fair deal.' };
  if (ratio >= 0.70) {
    const rand = Math.random();
    if (rand > 0.5) return { accepted: true, reason: 'GM accepted — they see positional value.' };
    return { accepted: false, reason: 'GM rejected — wants more value in return.' };
  }
  return { accepted: false, reason: 'GM rejected — significant value gap. Improve your offer.' };
}

function ValueIndicator({ myVal, theirVal }) {
  const ratio = myVal > 0 ? theirVal / myVal : 0;
  let color, label;
  if (ratio >= 0.9 && ratio <= 1.1) { color = '#4ade80'; label = 'Fair Trade'; }
  else if (ratio > 1.1) { color = '#4ade80'; label = 'You Win'; }
  else if (ratio >= 0.75) { color = '#facc15'; label = 'Slight Loss'; }
  else { color = '#ef4444'; label = 'Bad Trade'; }
  return (
    <div style={{ background: color + '18', border: `1px solid ${color}44`, borderRadius: 8, padding: '8px 14px', textAlign: 'center', color, fontWeight: 700, fontSize: 13 }}>
      {label}
      <div style={{ fontSize: 11, fontWeight: 400, color: '#CBD5E1', marginTop: 2 }}>
        You give: {myVal} pts | You get: {theirVal} pts
      </div>
    </div>
  );
}

export default function MLBTradePage() {
  const { roster, tradePlayer, tradeHistory, currentTeamAbbr, allTeams } = useMLBGame();
  const [selectedTeam, setSelectedTeam] = useState('');
  const [myOffer, setMyOffer] = useState([]);
  const [theirOffer, setTheirOffer] = useState([]);
  const [tradeResult, setTradeResult] = useState(null);
  const [mySearch, setMySearch] = useState('');
  const [theirSearch, setTheirSearch] = useState('');

  const otherTeams = allTeams.filter(t => t.abbreviation !== currentTeamAbbr);
  const theirRoster = selectedTeam ? getTeamPlayers(selectedTeam) : [];

  const myVal = useMemo(() => myOffer.reduce((s, p) => s + getMLBPlayerValue(p), 0), [myOffer]);
  const theirVal = useMemo(() => theirOffer.reduce((s, p) => s + getMLBPlayerValue(p), 0), [theirOffer]);

  function toggleMyPlayer(player) {
    setMyOffer(prev => prev.find(p => p.id === player.id) ? prev.filter(p => p.id !== player.id) : [...prev, player]);
  }

  function toggleTheirPlayer(player) {
    setTheirOffer(prev => prev.find(p => p.id === player.id) ? prev.filter(p => p.id !== player.id) : [...prev, player]);
  }

  function submitTrade() {
    if (!selectedTeam || myOffer.length === 0 || theirOffer.length === 0) return;
    const targetTeamName = allTeams.find(t => t.abbreviation === selectedTeam)?.name || selectedTeam;
    const result = evaluateTradeForAI(myOffer, theirOffer, theirRoster);
    if (result.accepted) {
      tradePlayer(myOffer, theirOffer, targetTeamName);
      setMyOffer([]);
      setTheirOffer([]);
    }
    setTradeResult({ ...result, targetTeam: targetTeamName });
  }

  const filteredMyRoster = roster.filter(p => !mySearch || p.name.toLowerCase().includes(mySearch.toLowerCase()));
  const filteredTheirRoster = theirRoster.filter(p => !theirSearch || p.name.toLowerCase().includes(theirSearch.toLowerCase()));

  const recentTrades = tradeHistory.filter(t => t.type === 'trade').slice(-3).reverse();

  return (
    <div style={{ color: '#E2E8F0' }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: '0 0 4px', fontFamily: "'Oswald', sans-serif", fontSize: 22, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Trade Center
        </h2>
        <div style={{ color: '#94A3B8', fontSize: 13 }}>Propose trades with any of the 30 MLB teams. AI GMs evaluate all offers.</div>
      </div>

      {/* Trade Result Banner */}
      {tradeResult && (
        <div style={{
          background: tradeResult.accepted ? 'rgba(74,222,128,0.1)' : 'rgba(239,68,68,0.1)',
          border: `1px solid ${tradeResult.accepted ? '#4ade80' : '#ef4444'}`,
          borderRadius: 8, padding: '12px 16px', marginBottom: 16,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div style={{ fontWeight: 700, color: tradeResult.accepted ? '#4ade80' : '#ef4444', fontSize: 14 }}>
              {tradeResult.accepted ? `Trade ACCEPTED by ${tradeResult.targetTeam}!` : `Trade REJECTED by ${tradeResult.targetTeam}`}
            </div>
            <div style={{ color: '#94A3B8', fontSize: 12, marginTop: 2 }}>{tradeResult.reason}</div>
          </div>
          <button onClick={() => setTradeResult(null)} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
      )}

      {/* Team Selector */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 12, color: '#94A3B8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Select Trade Partner
        </label>
        <select
          value={selectedTeam}
          onChange={e => { setSelectedTeam(e.target.value); setMyOffer([]); setTheirOffer([]); setTradeResult(null); }}
          style={{ background: 'rgba(30,41,59,0.9)', color: '#E2E8F0', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '8px 12px', fontSize: 14, width: 240 }}
        >
          <option value="">-- Pick a team --</option>
          {otherTeams.map(t => (
            <option key={t.abbreviation} value={t.abbreviation} style={{ background: '#1e293b' }}>
              {t.city} {t.name}
            </option>
          ))}
        </select>
      </div>

      {/* Value Indicator */}
      {(myOffer.length > 0 || theirOffer.length > 0) && (
        <div style={{ marginBottom: 16 }}>
          <ValueIndicator myVal={myVal} theirVal={theirVal} />
        </div>
      )}

      {/* Two-panel trade builder */}
      {selectedTeam && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
          {/* My Roster */}
          <div style={{ background: 'rgba(30,41,59,0.5)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '14px' }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: '#E2E8F0', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: "'Oswald', sans-serif" }}>
              My Offer ({myOffer.length} players)
            </div>
            <input value={mySearch} onChange={e => setMySearch(e.target.value)} placeholder="Search my roster..."
              style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '5px 10px', color: '#E2E8F0', fontSize: 12, width: '100%', marginBottom: 8, boxSizing: 'border-box' }} />
            <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {filteredMyRoster.map(p => {
                const selected = !!myOffer.find(mp => mp.id === p.id);
                return (
                  <div key={p.id} onClick={() => toggleMyPlayer(p)}
                    style={{
                      padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                      background: selected ? 'rgba(0,200,83,0.15)' : 'rgba(15,23,42,0.4)',
                      border: `1px solid ${selected ? 'rgba(0,200,83,0.4)' : 'rgba(255,255,255,0.05)'}`,
                      transition: 'background 0.15s',
                    }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#E2E8F0' }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>{p.position} &bull; Age {p.age} &bull; ${p.salary.toFixed(1)}M</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#94A3B8' }}>{getMLBPlayerValue(p)} pts</div>
                        {selected && <div style={{ fontSize: 10, color: '#00C853' }}>Selected</div>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Their Roster */}
          <div style={{ background: 'rgba(30,41,59,0.5)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '14px' }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: '#E2E8F0', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: "'Oswald', sans-serif" }}>
              Request ({theirOffer.length} players)
            </div>
            <input value={theirSearch} onChange={e => setTheirSearch(e.target.value)} placeholder="Search their roster..."
              style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '5px 10px', color: '#E2E8F0', fontSize: 12, width: '100%', marginBottom: 8, boxSizing: 'border-box' }} />
            <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {filteredTheirRoster.map(p => {
                const selected = !!theirOffer.find(tp => tp.id === p.id);
                return (
                  <div key={p.id} onClick={() => toggleTheirPlayer(p)}
                    style={{
                      padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                      background: selected ? 'rgba(59,130,246,0.15)' : 'rgba(15,23,42,0.4)',
                      border: `1px solid ${selected ? 'rgba(59,130,246,0.4)' : 'rgba(255,255,255,0.05)'}`,
                      transition: 'background 0.15s',
                    }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#E2E8F0' }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>{p.position} &bull; Age {p.age} &bull; ${p.salary.toFixed(1)}M</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#94A3B8' }}>{getMLBPlayerValue(p)} pts</div>
                        {selected && <div style={{ fontSize: 10, color: '#3b82f6' }}>Requested</div>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Submit Button */}
      {selectedTeam && (
        <div style={{ marginBottom: 20 }}>
          <button
            onClick={submitTrade}
            disabled={myOffer.length === 0 || theirOffer.length === 0}
            style={{
              width: '100%', background: myOffer.length > 0 && theirOffer.length > 0 ? 'rgba(0,200,83,0.2)' : 'rgba(30,41,59,0.4)',
              border: `1px solid ${myOffer.length > 0 && theirOffer.length > 0 ? 'rgba(0,200,83,0.5)' : 'rgba(255,255,255,0.08)'}`,
              color: myOffer.length > 0 && theirOffer.length > 0 ? '#00C853' : '#475569',
              borderRadius: 8, padding: '12px', fontSize: 14, cursor: myOffer.length > 0 && theirOffer.length > 0 ? 'pointer' : 'not-allowed',
              fontWeight: 700, fontFamily: "'Oswald', sans-serif", textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
            Propose Trade
          </button>
          {(myOffer.length === 0 || theirOffer.length === 0) && (
            <div style={{ textAlign: 'center', fontSize: 12, color: '#475569', marginTop: 6 }}>
              Select players on both sides to propose a trade
            </div>
          )}
        </div>
      )}

      {/* Trade History */}
      {recentTrades.length > 0 && (
        <div style={{ background: 'rgba(30,41,59,0.5)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '14px' }}>
          <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10, color: '#94A3B8' }}>
            Recent Trades
          </div>
          {recentTrades.map(t => (
            <div key={t.id} style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 12, color: '#94A3B8' }}>
              {t.description}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

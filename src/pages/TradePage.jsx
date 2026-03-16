import React, { useState, useMemo } from 'react';
import { useGame } from '../context/GameContext';
import { allRosters } from '../data/allRosters';

// Simplified trade value chart (based on Jimmy Johnson chart, scaled)
const PICK_VALUES = {
  '1-1': 3000, '1-2': 2600, '1-3': 2200, '1-4': 1800, '1-5': 1700,
  '1-6': 1600, '1-7': 1500, '1-8': 1400, '1-9': 1350, '1-10': 1300,
  '1-11': 1250, '1-12': 1200, '1-13': 1150, '1-14': 1100, '1-15': 1050,
  '1-16': 1000, '1-17': 950, '1-18': 900, '1-19': 850, '1-20': 800,
  '1-21': 750, '1-22': 700, '1-23': 650, '1-24': 600, '1-25': 550,
  '1-26': 500, '1-27': 480, '1-28': 460, '1-29': 440, '1-30': 420,
  '1-31': 400, '1-32': 380,
  '2-1': 360, '2-2': 340, '2-3': 320, '2-4': 300, '2-5': 290,
  '2-10': 260, '2-17': 230, '2-20': 210, '2-32': 180,
  '3-1': 170, '3-17': 130, '3-32': 100,
  '4-1': 95, '4-17': 75, '4-32': 60,
  '5-1': 55, '5-17': 45, '5-32': 35,
  '6-1': 30, '6-17': 22, '6-32': 16,
  '7-1': 15, '7-17': 10, '7-32': 6,
};

function getPickValue(round, pick) {
  const key = `${round}-${pick}`;
  if (PICK_VALUES[key]) return PICK_VALUES[key];
  // Interpolate roughly
  const base = [0, 3000, 360, 170, 95, 55, 30, 15][round] || 10;
  return Math.max(5, base - (pick - 1) * (base * 0.55 / 32));
}

function getPlayerValue(player) {
  // Rough trade value: higher for younger players with bigger cap hits
  const ageMultiplier = Math.max(0.3, 1 - (player.age - 22) * 0.04);
  return Math.round(player.capHit * 20 * ageMultiplier);
}

function getTeamPlayers(teamAbbr) {
  const teamData = allRosters[teamAbbr];
  if (!teamData) return [];
  // Prefix IDs with team abbreviation to avoid collisions
  return teamData.players.map((p, i) => ({ ...p, id: `${teamAbbr}-${i}` }));
}

function getTeamCapSummary(teamAbbr) {
  const teamData = allRosters[teamAbbr];
  if (!teamData || !teamData.capSummary) return null;
  return teamData.capSummary;
}

function ValueIndicator({ myValue, theirValue }) {
  const ratio = myValue > 0 ? theirValue / myValue : 0;
  let color, label;
  if (ratio >= 0.9 && ratio <= 1.1) { color = '#4ade80'; label = '\u2713 Fair Trade'; }
  else if (ratio > 1.1 && ratio <= 1.25) { color = '#facc15'; label = '\u2191 Slight Win'; }
  else if (ratio > 1.25) { color = '#4ade80'; label = '\u2713 Great Trade'; }
  else if (ratio >= 0.75) { color = '#facc15'; label = '\u2193 Slight Loss'; }
  else { color = '#ff4444'; label = '\u2717 Bad Trade'; }

  return (
    <div style={{
      background: color + '22',
      border: `1px solid ${color}`,
      borderRadius: 8,
      padding: '8px 16px',
      textAlign: 'center',
      color,
      fontWeight: 700,
      fontSize: 14,
    }}>
      {label}
      <div style={{ fontSize: 11, fontWeight: 400, marginTop: 2, color: '#88b898' }}>
        You give: {myValue} pts | You get: {theirValue} pts
      </div>
    </div>
  );
}

// Calculate cap impact of trading players
// When you trade a player AWAY: you lose their cap hit but absorb their dead money
// Net cap effect = capHit - deadMoney (positive = cap relief, negative = cap penalty)
function computeCapImpact(sentPlayers, receivedPlayers) {
  const sentCapRelief = sentPlayers.reduce((sum, p) => {
    const deadMoney = p.deadMoney != null ? p.deadMoney : 0;
    const capHit = p.capHit || 0;
    return sum + (capHit - deadMoney); // positive = cap space freed
  }, 0);

  const receivedCapCost = receivedPlayers.reduce((sum, p) => sum + (p.capHit || 0), 0);

  return {
    capFreed: sentCapRelief,      // cap space gained from sending players
    capAbsorbed: receivedCapCost,  // cap space consumed by receiving players
    netCapImpact: sentCapRelief - receivedCapCost, // positive = more cap space
    deadCapHit: sentPlayers.reduce((sum, p) => sum + (p.deadMoney != null ? p.deadMoney : 0), 0),
  };
}

export default function TradePage() {
  const { roster, myPicks, allTeams, tradePlayer, tradeHistory, currentTeamAbbr, capUsed, totalCap } = useGame();
  const [selectedTeam, setSelectedTeam] = useState('');
  const [myOfferPlayers, setMyOfferPlayers] = useState([]);
  const [myOfferPicks, setMyOfferPicks] = useState([]);
  const [theirOfferPlayers, setTheirOfferPlayers] = useState([]);
  const [theirOfferPicks, setTheirOfferPicks] = useState([]);
  const [feedback, setFeedback] = useState('');

  const otherTeams = allTeams.filter(t => t.abbreviation !== currentTeamAbbr);
  const targetTeam = allTeams.find(t => t.id === Number(selectedTeam));
  const currentTeamObj = allTeams.find(t => t.abbreviation === currentTeamAbbr);
  const currentTeamLabel = currentTeamObj ? currentTeamObj.name : 'My Team';

  // Get real players for the target team
  const targetTeamPlayers = useMemo(() => {
    if (!targetTeam) return [];
    return getTeamPlayers(targetTeam.abbreviation);
  }, [targetTeam]);

  const targetCapSummary = useMemo(() => {
    if (!targetTeam) return null;
    return getTeamCapSummary(targetTeam.abbreviation);
  }, [targetTeam]);

  const myValue = useMemo(() => {
    const pv = myOfferPlayers.reduce((s, p) => s + getPlayerValue(p), 0);
    const pickv = myOfferPicks.reduce((s, pk) => s + getPickValue(pk.round, pk.pick), 0);
    return pv + pickv;
  }, [myOfferPlayers, myOfferPicks]);

  const theirValue = useMemo(() => {
    const pv = theirOfferPlayers.reduce((s, p) => s + getPlayerValue(p), 0);
    const pickv = theirOfferPicks.reduce((s, pk) => s + getPickValue(pk.round, pk.pick), 0);
    return pv + pickv;
  }, [theirOfferPlayers, theirOfferPicks]);

  function toggleMyPlayer(player) {
    setMyOfferPlayers(prev =>
      prev.find(p => p.id === player.id) ? prev.filter(p => p.id !== player.id) : [...prev, player]
    );
  }

  function toggleMyPick(pick) {
    const key = `${pick.round}-${pick.pick}`;
    setMyOfferPicks(prev =>
      prev.find(pk => `${pk.round}-${pk.pick}` === key) ? prev.filter(pk => `${pk.round}-${pk.pick}` !== key) : [...prev, pick]
    );
  }

  function toggleTheirPlayer(player) {
    setTheirOfferPlayers(prev =>
      prev.find(p => p.id === player.id) ? prev.filter(p => p.id !== player.id) : [...prev, player]
    );
  }

  function toggleTheirPick(pick) {
    const key = `${pick.round}-${pick.pick}`;
    setTheirOfferPicks(prev =>
      prev.find(pk => `${pk.round}-${pk.pick}` === key) ? prev.filter(pk => `${pk.round}-${pk.pick}` !== key) : [...prev, pick]
    );
  }

  function handleTrade() {
    if (!targetTeam) { setFeedback('Please select a team first.'); return; }
    if (myOfferPlayers.length === 0 && myOfferPicks.length === 0) { setFeedback('Add something to offer.'); return; }
    if (theirOfferPlayers.length === 0 && theirOfferPicks.length === 0) { setFeedback('Request something in return.'); return; }

    const ratio = myValue > 0 ? theirValue / myValue : 0;
    if (ratio < 0.6) {
      setFeedback('Trade rejected -- too one-sided (you would be giving up too much value).');
      return;
    }

    tradePlayer(myOfferPlayers, myOfferPicks, theirOfferPlayers, theirOfferPicks, targetTeam.name);
    setFeedback(`Trade complete with ${targetTeam.name}!`);
    setMyOfferPlayers([]);
    setMyOfferPicks([]);
    setTheirOfferPlayers([]);
    setTheirOfferPicks([]);
    setSelectedTeam('');
    setTimeout(() => setFeedback(''), 4000);
  }

  const trades = tradeHistory.filter(t => t.type === 'trade');

  return (
    <div>
      <h1 style={{ margin: '0 0 16px', fontSize: 22, color: 'var(--bengals-orange)' }}>Trade Simulator</h1>

      {feedback && (
        <div style={{
          background: feedback.startsWith('Trade rejected') ? 'rgba(255,68,68,0.15)' : 'rgba(74,222,128,0.15)',
          border: `1px solid ${feedback.startsWith('Trade rejected') ? '#ff4444' : '#4ade80'}`,
          borderRadius: 8, padding: 10, marginBottom: 12,
          color: feedback.startsWith('Trade rejected') ? '#ff4444' : '#4ade80', fontSize: 13,
        }}>{feedback}</div>
      )}

      {/* Team Selector */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', color: '#6a9a78', fontSize: 12, marginBottom: 6 }}>Select Trade Partner</label>
        <select
          value={selectedTeam}
          onChange={e => { setSelectedTeam(e.target.value); setTheirOfferPlayers([]); setTheirOfferPicks([]); }}
          style={{ background: '#1a3a22', color: '#fff', border: '1px solid rgba(40,200,40,0.32)', borderRadius: 8, padding: '8px 12px', fontSize: 14, width: '100%', maxWidth: 300 }}
        >
          <option value="">-- Select Team --</option>
          {otherTeams.map(t => (
            <option key={t.id} value={t.id}>{t.city} {t.name}</option>
          ))}
        </select>
        {targetCapSummary && (
          <div style={{ color: '#6a9a78', fontSize: 12, marginTop: 4 }}>
            Cap space: ${targetCapSummary.capSpace.toFixed(1)}M | Cap used: ${targetCapSummary.capUsed.toFixed(1)}M
          </div>
        )}
      </div>

      {/* Trade Builder */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 16 }}>
        {/* My Offers */}
        <div style={{ background: '#0d2a16', border: '1px solid rgba(40,200,40,0.25)', borderRadius: 10, padding: 14 }}>
          <h3 style={{ margin: '0 0 12px', color: '#fff', fontSize: 15 }}>My Offers ({currentTeamLabel})</h3>
          <div style={{ marginBottom: 8 }}>
            <div style={{ color: '#6a9a78', fontSize: 12, marginBottom: 6 }}>Players</div>
            <div style={{ maxHeight: 250, overflowY: 'auto' }}>
              {roster.map(p => {
                const selected = !!myOfferPlayers.find(x => x.id === p.id);
                return (
                  <div
                    key={p.id}
                    onClick={() => toggleMyPlayer(p)}
                    style={{
                      display: 'flex', justifyContent: 'space-between',
                      padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                      background: selected ? 'rgba(251,79,20,0.2)' : 'transparent',
                      border: selected ? '1px solid var(--bengals-orange)' : '1px solid transparent',
                      marginBottom: 2, fontSize: 12,
                    }}
                  >
                    <span style={{ color: '#c4d8cc' }}>{p.name} <span style={{ color: '#6a9a78' }}>({p.position})</span></span>
                    <span style={{ color: '#4d6356' }}>${p.capHit.toFixed(1)}M | ~{getPlayerValue(p)}pts</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <div style={{ color: '#6a9a78', fontSize: 12, marginBottom: 6 }}>Draft Picks</div>
            {myPicks.map((pk, i) => {
              const key = `${pk.round}-${pk.pick}`;
              const selected = !!myOfferPicks.find(x => `${x.round}-${x.pick}` === key);
              return (
                <div
                  key={i}
                  onClick={() => toggleMyPick(pk)}
                  style={{
                    display: 'flex', justifyContent: 'space-between',
                    padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                    background: selected ? 'rgba(251,79,20,0.2)' : 'transparent',
                    border: selected ? '1px solid var(--bengals-orange)' : '1px solid transparent',
                    marginBottom: 2, fontSize: 12,
                  }}
                >
                  <span style={{ color: '#c4d8cc' }}>2026 Round {pk.round} (#{pk.overall})</span>
                  <span style={{ color: '#6a9a78' }}>~{Math.round(getPickValue(pk.round, pk.pick))}pts</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Their Offers */}
        <div style={{ background: '#0d2a16', border: '1px solid rgba(40,200,40,0.25)', borderRadius: 10, padding: 14 }}>
          <h3 style={{ margin: '0 0 12px', color: '#fff', fontSize: 15 }}>
            Requesting from {targetTeam ? `${targetTeam.city} ${targetTeam.name}` : '(select team)'}
          </h3>
          {!targetTeam ? (
            <p style={{ color: '#4a7a58', fontSize: 13 }}>Select a trade partner first.</p>
          ) : (
            <>
              <div style={{ marginBottom: 8 }}>
                <div style={{ color: '#6a9a78', fontSize: 12, marginBottom: 6 }}>Their Players</div>
                <div style={{ maxHeight: 250, overflowY: 'auto' }}>
                  {targetTeamPlayers.map(p => {
                    const selected = !!theirOfferPlayers.find(x => x.id === p.id);
                    return (
                      <div
                        key={p.id}
                        onClick={() => toggleTheirPlayer(p)}
                        style={{
                          display: 'flex', justifyContent: 'space-between',
                          padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                          background: selected ? 'rgba(59,130,246,0.2)' : 'transparent',
                          border: selected ? '1px solid #3b82f6' : '1px solid transparent',
                          marginBottom: 2, fontSize: 12,
                        }}
                      >
                        <span style={{ color: '#c4d8cc' }}>{p.name} <span style={{ color: '#6a9a78' }}>({p.position})</span></span>
                        <span style={{ color: '#4d6356' }}>${p.capHit.toFixed(1)}M | ~{getPlayerValue(p)}pts</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <div style={{ color: '#6a9a78', fontSize: 12, marginBottom: 6 }}>Their Picks</div>
                {targetTeam.picks.map((pk, i) => {
                  const key = `${pk.round}-${pk.pick}`;
                  const selected = !!theirOfferPicks.find(x => `${x.round}-${x.pick}` === key);
                  return (
                    <div
                      key={i}
                      onClick={() => toggleTheirPick(pk)}
                      style={{
                        display: 'flex', justifyContent: 'space-between',
                        padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                        background: selected ? 'rgba(59,130,246,0.2)' : 'transparent',
                        border: selected ? '1px solid #3b82f6' : '1px solid transparent',
                        marginBottom: 2, fontSize: 12,
                      }}
                    >
                      <span style={{ color: '#c4d8cc' }}>2026 Round {pk.round} (#{pk.overall})</span>
                      <span style={{ color: '#6a9a78' }}>~{Math.round(getPickValue(pk.round, pk.pick))}pts</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Trade Summary */}
      {(myOfferPlayers.length > 0 || myOfferPicks.length > 0 || theirOfferPlayers.length > 0 || theirOfferPicks.length > 0) && (
        <div style={{ background: '#0d2a16', border: '1px solid rgba(40,200,40,0.32)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 12px', color: '#fff' }}>Trade Summary</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ color: '#6a9a78', fontSize: 12, marginBottom: 6 }}>{currentTeamLabel} send:</div>
              {myOfferPlayers.map(p => <div key={p.id} style={{ color: '#c4d8cc', fontSize: 13 }}>- {p.name} ({p.position}) ${p.capHit.toFixed(1)}M</div>)}
              {myOfferPicks.map((pk, i) => <div key={i} style={{ color: '#c4d8cc', fontSize: 13 }}>- 2026 R{pk.round} #{pk.overall}</div>)}
            </div>
            <div>
              <div style={{ color: '#6a9a78', fontSize: 12, marginBottom: 6 }}>{currentTeamLabel} receive:</div>
              {theirOfferPlayers.map(p => <div key={p.id} style={{ color: '#c4d8cc', fontSize: 13 }}>- {p.name} ({p.position}) ${p.capHit.toFixed(1)}M</div>)}
              {theirOfferPicks.map((pk, i) => <div key={i} style={{ color: '#c4d8cc', fontSize: 13 }}>- 2026 R{pk.round} #{pk.overall}</div>)}
            </div>
          </div>
          <ValueIndicator myValue={myValue} theirValue={theirValue} />

          {/* Cap Impact Analysis */}
          {(() => {
            const impact = computeCapImpact(myOfferPlayers, theirOfferPlayers);
            const currentCapSpace = totalCap - capUsed;
            const newCapSpace = currentCapSpace + impact.netCapImpact;
            return (
              <div style={{
                background: '#081f0e', border: '1px solid rgba(40,200,40,0.25)', borderRadius: 8,
                padding: 12, marginTop: 12,
              }}>
                <div style={{ color: '#fff', fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Cap Impact</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 8, fontSize: 12 }}>
                  <div>
                    <div style={{ color: '#6a9a78', marginBottom: 4 }}>Sending players:</div>
                    {myOfferPlayers.length > 0 ? myOfferPlayers.map(p => (
                      <div key={p.id} style={{ color: '#c4d8cc', marginBottom: 2 }}>
                        {p.name}: <span style={{ color: '#4ade80' }}>+${(p.capHit || 0).toFixed(1)}M cap relief</span>
                        {(p.deadMoney != null && p.deadMoney > 0) && (
                          <span style={{ color: '#ff4444' }}> (${p.deadMoney.toFixed(1)}M dead cap)</span>
                        )}
                      </div>
                    )) : <div style={{ color: '#4a7a58' }}>No players</div>}
                  </div>
                  <div>
                    <div style={{ color: '#6a9a78', marginBottom: 4 }}>Receiving players:</div>
                    {theirOfferPlayers.length > 0 ? theirOfferPlayers.map(p => (
                      <div key={p.id} style={{ color: '#c4d8cc', marginBottom: 2 }}>
                        {p.name}: <span style={{ color: '#ff4444' }}>-${(p.capHit || 0).toFixed(1)}M cap absorbed</span>
                      </div>
                    )) : <div style={{ color: '#4a7a58' }}>No players</div>}
                  </div>
                </div>
                <div style={{
                  borderTop: '1px solid rgba(40,200,40,0.25)', marginTop: 8, paddingTop: 8,
                  display: 'flex', justifyContent: 'space-between', fontSize: 13,
                }}>
                  <div>
                    <span style={{ color: '#6a9a78' }}>Net cap impact: </span>
                    <span style={{ color: impact.netCapImpact >= 0 ? '#4ade80' : '#ff4444', fontWeight: 700 }}>
                      {impact.netCapImpact >= 0 ? '+' : ''}${impact.netCapImpact.toFixed(1)}M
                    </span>
                  </div>
                  <div>
                    <span style={{ color: '#6a9a78' }}>Cap after trade: </span>
                    <span style={{ color: newCapSpace >= 0 ? '#4ade80' : '#ff4444', fontWeight: 700 }}>
                      ${newCapSpace.toFixed(1)}M
                    </span>
                  </div>
                </div>
                {impact.deadCapHit > 0 && (
                  <div style={{ color: '#fbbf24', fontSize: 11, marginTop: 4 }}>
                    Warning: ${impact.deadCapHit.toFixed(1)}M dead cap accelerates from traded players
                  </div>
                )}
              </div>
            );
          })()}

          <button
            onClick={handleTrade}
            style={{
              marginTop: 12,
              background: 'var(--bengals-orange)',
              color: '#000',
              border: 'none',
              borderRadius: 8,
              padding: '10px 24px',
              cursor: 'pointer',
              fontWeight: 800,
              fontSize: 14,
              width: '100%',
            }}
          >Propose Trade</button>
        </div>
      )}

      {/* Trade History */}
      {trades.length > 0 && (
        <div style={{ background: '#0d2a16', border: '1px solid rgba(40,200,40,0.25)', borderRadius: 10, padding: 14 }}>
          <h3 style={{ margin: '0 0 12px', color: '#fff', fontSize: 15 }}>Trade History</h3>
          {trades.map(t => (
            <div key={t.id} style={{ borderBottom: '1px solid #1a2420', paddingBottom: 8, marginBottom: 8, fontSize: 13 }}>
              <div style={{ color: '#c4d8cc' }}>{t.description}</div>
              <div style={{ color: '#4a7a58', fontSize: 11, marginTop: 2 }}>{new Date(t.timestamp).toLocaleDateString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

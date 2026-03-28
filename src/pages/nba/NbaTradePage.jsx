import React, { useState, useMemo } from 'react';
import { useNbaGame } from '../../context/NbaGameContext';
import { nbaRosters } from '../../data/nba/nbaRosters';

function getTeamPlayers(teamAbbr) {
  const teamData = nbaRosters[teamAbbr];
  if (!teamData) return [];
  return teamData.players.map((p, i) => ({ ...p, id: `${teamAbbr}-${i}` }));
}

function getPlayerValue(player) {
  const rating = player.rating || 70;
  const yearsLeft = (player.yearsRemaining || 0) + 1;
  const age = player.age || 27;
  const ageMulti = age <= 25 ? 1.3 : age <= 28 ? 1.1 : age <= 32 ? 0.9 : 0.7;
  return Math.round(rating * 1.5 * ageMulti * Math.min(yearsLeft, 4));
}

function ValueBar({ myVal, theirVal }) {
  const ratio = myVal > 0 ? theirVal / myVal : 0;
  let color, label;
  if (ratio >= 0.9 && ratio <= 1.1) { color = '#10b981'; label = 'Fair Trade'; }
  else if (ratio > 1.1 && ratio <= 1.3) { color = '#FFA500'; label = 'Slight Win'; }
  else if (ratio > 1.3) { color = '#10b981'; label = 'Great Trade'; }
  else if (ratio >= 0.7) { color = '#FFA500'; label = 'Slight Loss'; }
  else { color = '#FF2D55'; label = 'Bad Trade'; }
  return (
    <div style={{
      background: `${color}15`, border: `1px solid ${color}44`, borderRadius: 8,
      padding: '8px 16px', textAlign: 'center', color, fontWeight: 700, fontSize: 14,
    }}>
      {label}
      <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 400, marginTop: 2 }}>
        You send: {myVal} pts | You get: {theirVal} pts
      </div>
    </div>
  );
}

export default function NbaTradePage() {
  const {
    roster, myPicks, allTeams, tradePlayer, tradeHistory, currentTeamAbbr, capUsed, totalCap,
  } = useNbaGame();

  const [selectedTeam, setSelectedTeam] = useState('');
  const [myOfferPlayers, setMyOfferPlayers] = useState([]);
  const [myOfferPicks, setMyOfferPicks] = useState([]);
  const [theirOfferPlayers, setTheirOfferPlayers] = useState([]);
  const [theirOfferPicks, setTheirOfferPicks] = useState([]);
  const [feedback, setFeedback] = useState('');
  const [mySearch, setMySearch] = useState('');
  const [theirSearch, setTheirSearch] = useState('');

  const otherTeams = allTeams.filter(t => t.abbreviation !== currentTeamAbbr);
  const theirPlayers = selectedTeam ? getTeamPlayers(selectedTeam) : [];

  const myValue = useMemo(() =>
    myOfferPlayers.reduce((sum, p) => sum + getPlayerValue(p), 0),
    [myOfferPlayers]
  );
  const theirValue = useMemo(() =>
    theirOfferPlayers.reduce((sum, p) => sum + getPlayerValue(p), 0),
    [theirOfferPlayers]
  );

  function togglePlayer(arr, setArr, player) {
    const exists = arr.find(p => p.id === player.id);
    if (exists) setArr(arr.filter(p => p.id !== player.id));
    else setArr([...arr, player]);
  }

  // NBA trade rules: salary must be within 125%+$100K or $250K of traded salary (simplified for this sim)
  function checkTradeBalance() {
    const sentSalary = myOfferPlayers.reduce((s, p) => s + (p.capHit || 0), 0);
    const recvSalary = theirOfferPlayers.reduce((s, p) => s + (p.capHit || 0), 0);
    if (sentSalary === 0 && recvSalary === 0) return { ok: false, reason: 'Add players to trade.' };
    // Under cap: can take on up to 125% + $0.1M more than sent
    // Simplified rule
    const maxReceive = sentSalary * 1.25 + 0.1;
    if (recvSalary > maxReceive && capUsed > totalCap) {
      return { ok: false, reason: `Salary too imbalanced. You send $${sentSalary.toFixed(1)}M, can receive max $${maxReceive.toFixed(1)}M.` };
    }
    return { ok: true };
  }

  function evaluateTrade() {
    if (!selectedTeam) { setFeedback('Select a trade partner first.'); return; }
    if (myOfferPlayers.length === 0 && theirOfferPlayers.length === 0) { setFeedback('Add players to both sides of the trade.'); return; }

    const balance = checkTradeBalance();
    if (!balance.ok) { setFeedback(balance.reason); return; }

    const ratio = myValue > 0 ? theirValue / myValue : 0;
    const theirTeam = allTeams.find(t => t.abbreviation === selectedTeam);

    if (ratio < 0.65) {
      setFeedback(`${theirTeam?.name} GM rejects the trade — the value is too lopsided. Offer more to sweeten the deal.`);
      return;
    }

    tradePlayer(myOfferPlayers, myOfferPicks, theirOfferPlayers, theirOfferPicks, selectedTeam);
    setFeedback(`TRADE COMPLETE! Sent ${myOfferPlayers.map(p => p.name).join(', ')} to the ${theirTeam?.name}.`);
    setMyOfferPlayers([]);
    setMyOfferPicks([]);
    setTheirOfferPlayers([]);
    setTheirOfferPicks([]);
  }

  const myFilteredRoster = roster.filter(p => !mySearch || p.name.toLowerCase().includes(mySearch.toLowerCase()));
  const theirFilteredPlayers = theirPlayers.filter(p => !theirSearch || p.name.toLowerCase().includes(theirSearch.toLowerCase()));

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#FFA500', fontFamily: "'Oswald', sans-serif", letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>Trade Machine</div>
        <div style={{ fontSize: 13, color: '#64748B' }}>Build trades with any of the 29 other NBA teams. AI GM evaluates value and trade rules.</div>
      </div>

      {/* Trade partner selector */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ display: 'block', fontSize: 11, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Trade Partner</label>
        <select value={selectedTeam} onChange={e => { setSelectedTeam(e.target.value); setTheirOfferPlayers([]); setTheirOfferPicks([]); setFeedback(''); }}
          style={{ background: 'rgba(30,41,59,0.8)', border: '1px solid rgba(255,160,0,0.2)', borderRadius: 6, padding: '8px 12px', color: '#E2E8F0', fontSize: 14, outline: 'none', maxWidth: 280 }}>
          <option value="">-- Select Team --</option>
          {otherTeams.map(t => <option key={t.abbreviation} value={t.abbreviation} style={{ background: '#1e293b' }}>{t.city} {t.name}</option>)}
        </select>
      </div>

      {/* Two-column trade builder */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* My side */}
        <div style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#FFA500', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>You Send</div>
          <input value={mySearch} onChange={e => setMySearch(e.target.value)} placeholder="Search..."
            style={{ width: '100%', background: 'rgba(30,41,59,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '5px 8px', color: '#E2E8F0', fontSize: 12, outline: 'none', marginBottom: 8, boxSizing: 'border-box' }}
          />
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {myFilteredRoster.map(p => {
              const selected = myOfferPlayers.find(x => x.id === p.id);
              return (
                <div key={p.id} onClick={() => togglePlayer(myOfferPlayers, setMyOfferPlayers, p)}
                  style={{
                    padding: '6px 10px', borderRadius: 6, cursor: 'pointer', marginBottom: 4,
                    background: selected ? 'rgba(255,160,0,0.15)' : 'rgba(30,41,59,0.4)',
                    border: selected ? '1px solid rgba(255,160,0,0.4)' : '1px solid transparent',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                  <span style={{ fontSize: 12, color: selected ? '#FFA500' : '#E2E8F0', fontWeight: selected ? 700 : 400 }}>{p.name}</span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: '#64748B' }}>{p.position}</span>
                    <span style={{ fontSize: 11, color: '#FFA500' }}>${p.capHit.toFixed(1)}M</span>
                  </div>
                </div>
              );
            })}
          </div>
          {myPicks.length > 0 && (
            <div style={{ marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10 }}>
              <div style={{ fontSize: 11, color: '#64748B', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Picks</div>
              {myPicks.map(pk => {
                const key = `${pk.round}-${pk.overall}`;
                const sel = myOfferPicks.find(x => x.overall === pk.overall);
                return (
                  <div key={key} onClick={() => togglePlayer(myOfferPicks, setMyOfferPicks, pk)}
                    style={{
                      padding: '4px 8px', borderRadius: 4, cursor: 'pointer', marginBottom: 3, fontSize: 11,
                      background: sel ? 'rgba(255,160,0,0.15)' : 'rgba(30,41,59,0.4)',
                      border: sel ? '1px solid rgba(255,160,0,0.4)' : '1px solid transparent',
                      color: sel ? '#FFA500' : '#94A3B8',
                    }}>
                    R{pk.round} Pick #{pk.overall}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Their side */}
        <div style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#10b981', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            You Receive {selectedTeam && `(${selectedTeam})`}
          </div>
          {!selectedTeam ? (
            <div style={{ fontSize: 12, color: '#475569', padding: '20px 0', textAlign: 'center' }}>Select a trade partner above</div>
          ) : (
            <>
              <input value={theirSearch} onChange={e => setTheirSearch(e.target.value)} placeholder="Search..."
                style={{ width: '100%', background: 'rgba(30,41,59,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '5px 8px', color: '#E2E8F0', fontSize: 12, outline: 'none', marginBottom: 8, boxSizing: 'border-box' }}
              />
              <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                {theirFilteredPlayers.map(p => {
                  const selected = theirOfferPlayers.find(x => x.id === p.id);
                  return (
                    <div key={p.id} onClick={() => togglePlayer(theirOfferPlayers, setTheirOfferPlayers, p)}
                      style={{
                        padding: '6px 10px', borderRadius: 6, cursor: 'pointer', marginBottom: 4,
                        background: selected ? 'rgba(16,185,129,0.15)' : 'rgba(30,41,59,0.4)',
                        border: selected ? '1px solid rgba(16,185,129,0.4)' : '1px solid transparent',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      }}>
                      <span style={{ fontSize: 12, color: selected ? '#10b981' : '#E2E8F0', fontWeight: selected ? 700 : 400 }}>{p.name}</span>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: '#64748B' }}>{p.position}</span>
                        <span style={{ fontSize: 11, color: '#FFA500' }}>${p.capHit.toFixed(1)}M</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Trade summary */}
      {(myOfferPlayers.length > 0 || theirOfferPlayers.length > 0) && (
        <div style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>You Send</div>
              <div style={{ fontSize: 12, color: '#FFA500' }}>
                {myOfferPlayers.map(p => `${p.name} ($${p.capHit.toFixed(1)}M)`).join(', ') || 'Nothing'}
              </div>
              <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                Trade value: <strong style={{ color: '#FFA500' }}>{myValue} pts</strong>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>You Receive</div>
              <div style={{ fontSize: 12, color: '#10b981' }}>
                {theirOfferPlayers.map(p => `${p.name} ($${p.capHit.toFixed(1)}M)`).join(', ') || 'Nothing'}
              </div>
              <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                Trade value: <strong style={{ color: '#10b981' }}>{theirValue} pts</strong>
              </div>
            </div>
          </div>
          {myValue > 0 && theirValue > 0 && <ValueBar myVal={myValue} theirVal={theirValue} />}
        </div>
      )}

      {feedback && (
        <div style={{
          background: feedback.includes('COMPLETE') ? 'rgba(16,185,129,0.08)' : 'rgba(255,45,85,0.08)',
          border: `1px solid ${feedback.includes('COMPLETE') ? 'rgba(16,185,129,0.2)' : 'rgba(255,45,85,0.2)'}`,
          borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13,
          color: feedback.includes('COMPLETE') ? '#10b981' : '#ff8899', lineHeight: 1.6,
        }}>{feedback}</div>
      )}

      <button onClick={evaluateTrade} style={{
        width: '100%', padding: '12px 24px', background: 'linear-gradient(135deg, rgba(255,160,0,0.2), rgba(255,107,0,0.1))',
        border: '1px solid rgba(255,160,0,0.3)', borderRadius: 8, color: '#FFA500',
        fontWeight: 800, fontSize: 15, cursor: 'pointer', fontFamily: "'Oswald', sans-serif",
        letterSpacing: '0.08em', textTransform: 'uppercase',
      }}>
        Evaluate Trade
      </button>

      {/* Recent trades */}
      {tradeHistory.filter(t => t.type === 'trade').length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 12, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Recent Trades</div>
          {tradeHistory.filter(t => t.type === 'trade').slice(-5).reverse().map(t => (
            <div key={t.id} style={{ background: 'rgba(15,23,42,0.4)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: 6, padding: '8px 12px', marginBottom: 6, fontSize: 12, color: '#94A3B8' }}>
              {t.description}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

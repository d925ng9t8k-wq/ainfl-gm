import React, { useState } from 'react';
import { useGame } from '../context/GameContext';
import PredictionMarkets from '../components/PredictionMarkets';

const POSITIONS = ['All', 'QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB', 'ST'];
const OL_POSITIONS = ['LT', 'RT', 'LG', 'RG', 'C', 'OT', 'OG', 'IOL'];
const DL_POSITIONS = ['DE', 'DT', 'NT', 'DL', 'EDGE'];
const DB_POSITIONS = ['CB', 'S', 'FS', 'SS'];
const ST_POSITIONS = ['K', 'P', 'LS'];
const LB_POSITIONS = ['LB', 'MLB', 'OLB'];

const POS_GROUP_COLORS = {
  QB: '#FB4F14',
  RB: '#f59e0b',
  WR: '#10b981',
  TE: '#3b82f6',
  OL: '#8b5cf6',
  DL: '#ec4899',
  LB: '#06b6d4',
  DB: '#84cc16',
  ST: '#94a3b8',
};

function posGroup(pos) {
  if (OL_POSITIONS.includes(pos)) return 'OL';
  if (DL_POSITIONS.includes(pos)) return 'DL';
  if (DB_POSITIONS.includes(pos)) return 'DB';
  if (ST_POSITIONS.includes(pos)) return 'ST';
  if (LB_POSITIONS.includes(pos)) return 'LB';
  return pos;
}

export default function RosterPage() {
  const { roster, cutPlayer, restructureContract, extendPlayer, capUsed, totalCap, capAvailable, tradeHistory, cutPlayers } = useGame();
  const [filterPos, setFilterPos] = useState('All');
  const [sortKey, setSortKey] = useState('capHit');
  const [sortDir, setSortDir] = useState('desc');
  const [confirmCut, setConfirmCut] = useState(null);
  const [confirmRestructure, setConfirmRestructure] = useState(null);
  const [extendingPlayer, setExtendingPlayer] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [hoveredRow, setHoveredRow] = useState(null);

  // Roster moves counts from tradeHistory
  const cutCount = (tradeHistory || []).filter(t => t.type === 'cut').length;
  const restructureCount = (tradeHistory || []).filter(t => t.type === 'restructure').length;
  const extensionCount = (tradeHistory || []).filter(t => t.type === 'extension').length;
  const totalMoves = cutCount + restructureCount + extensionCount;

  // Dead cap from cut players
  const deadCapTotal = (cutPlayers || []).reduce((sum, p) => sum + (p.deadCap || 0), 0);

  function isExtensionEligible(player) {
    // Player must be on the roster (has a cap hit)
    if (player.capHit <= 0) return false;
    // Block rookie-deal players who haven't completed their 3rd NFL season
    // NFL rule: extensions allowed after 3rd season
    // Age 22 or younger = drafted 2025, in year 1 — NOT eligible
    // Age 23 = drafted 2024, in year 2 — NOT eligible
    // Age 24 = drafted 2023, in year 3 — eligible after season (allow)
    // Age 25+ = year 4+ — eligible
    // Use capHit < $15M to distinguish rookies from veterans who happen to be young
    if (player.age <= 23 && player.capHit < 15) return false;
    // Everyone else is eligible — including players in their final year
    return true;
  }

  const filteredRoster = roster.filter(p => !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()));

  const filtered = filteredRoster.filter(p => {
    if (filterPos === 'All') return true;
    return posGroup(p.position) === filterPos;
  });

  const sorted = [...filtered].sort((a, b) => {
    let av = a[sortKey], bv = b[sortKey];
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function SortIndicator({ col }) {
    if (sortKey !== col) return <span style={{ color: '#64748b' }}> ⇅</span>;
    return <span style={{ color: 'var(--bengals-orange)' }}>{sortDir === 'asc' ? ' ↑' : ' ↓'}</span>;
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <h1 style={{ margin: 0, fontSize: 22, color: 'var(--bengals-orange)' }}>Roster Management</h1>
          {totalMoves > 0 && (
            <span style={{
              background: 'var(--bengals-orange)',
              color: '#000',
              fontSize: 11,
              fontWeight: 800,
              padding: '3px 10px',
              borderRadius: 12,
              letterSpacing: '0.02em',
            }}>
              {totalMoves} move{totalMoves !== 1 ? 's' : ''}
              {cutCount > 0 && ` · ${cutCount} cut${cutCount !== 1 ? 's' : ''}`}
              {restructureCount > 0 && ` · ${restructureCount} restructure${restructureCount !== 1 ? 's' : ''}`}
              {extensionCount > 0 && ` · ${extensionCount} ext${extensionCount !== 1 ? 's' : ''}`}
            </span>
          )}
        </div>

        {/* Summary Stat Cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 10,
          marginBottom: 4,
        }}>
          {[
            { label: 'Players', value: roster.length, color: '#CBD5E1' },
            { label: 'Cap Used', value: `$${capUsed.toFixed(1)}M`, color: capUsed / totalCap > 0.92 ? '#facc15' : '#4ade80' },
            { label: 'Cap Available', value: `$${(capAvailable != null ? capAvailable : totalCap - capUsed).toFixed(1)}M`, color: (capAvailable != null ? capAvailable : totalCap - capUsed) < 0 ? '#ff4444' : '#4ade80' },
            { label: 'Dead Cap', value: `$${deadCapTotal.toFixed(1)}M`, color: deadCapTotal > 0 ? '#facc15' : '#64748b' },
          ].map(stat => (
            <div key={stat.label} style={{
              background: 'rgba(15,23,42,0.8)',
              border: '1px solid rgba(0,240,255,0.10)',
              borderRadius: 10,
              padding: '10px 14px',
              textAlign: 'center',
            }}>
              <div style={{ color: '#64748b', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                {stat.label}
              </div>
              <div style={{ color: stat.color, fontSize: 18, fontWeight: 800 }}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Position Filter */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {POSITIONS.map(pos => (
          <button
            key={pos}
            onClick={() => setFilterPos(pos)}
            style={{
              padding: '5px 12px',
              borderRadius: 20,
              border: 'none',
              cursor: 'pointer',
              background: filterPos === pos ? 'var(--bengals-orange)' : '#1e293b',
              color: filterPos === pos ? '#000' : '#CBD5E1',
              fontSize: 12,
              fontWeight: filterPos === pos ? 700 : 400,
              transition: 'all 0.15s',
            }}
          >
            {pos}
          </button>
        ))}
      </div>

      {/* Search */}
      <input
        type="text"
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
        placeholder="Search players..."
        style={{
          width: '100%',
          maxWidth: 300,
          background: 'rgba(30,41,59,0.6)',
          color: '#E2E8F0',
          border: '1px solid rgba(0,240,255,0.15)',
          borderRadius: 8,
          padding: '8px 12px',
          fontSize: 13,
          fontFamily: "'Inter', system-ui, sans-serif",
          outline: 'none',
          marginBottom: 12,
        }}
      />

      {/* Table */}
      <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid rgba(0,240,255,0.12)', maxWidth: '100%', WebkitOverflowScrolling: 'touch' }}>
        <table style={{ width: '100%', minWidth: 480, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#0f172a', borderBottom: '2px solid var(--bengals-orange)' }}>
              {[
                { key: 'name', label: 'Player' },
                { key: 'position', label: 'Pos' },
                { key: 'age', label: 'Age' },
                { key: 'capHit', label: 'Cap Hit' },
                { key: 'yearsRemaining', label: 'Contract' },
              ].map(col => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  style={{
                    padding: '10px 12px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    color: '#CBD5E1',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    userSelect: 'none',
                  }}
                >
                  {col.label}<SortIndicator col={col.key} />
                </th>
              ))}
              <th style={{ padding: '10px 12px', color: '#CBD5E1', fontWeight: 600, whiteSpace: 'nowrap' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((player, idx) => (
              <tr
                key={player.id}
                onMouseEnter={() => setHoveredRow(player.id)}
                onMouseLeave={() => setHoveredRow(null)}
                style={{
                  background: hoveredRow === player.id
                    ? 'rgba(0,240,255,0.06)'
                    : player.isFranchise ? 'rgba(251,79,20,0.1)' : idx % 2 === 0 ? '#0a0f1e' : '#141414',
                  borderBottom: '1px solid #1a2420',
                  transition: 'background 0.12s ease',
                }}
              >
                <td style={{ padding: '9px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {player.isFranchise && (
                      <span style={{
                        background: 'var(--bengals-orange)',
                        color: '#000',
                        fontSize: 9,
                        fontWeight: 800,
                        padding: '1px 4px',
                        borderRadius: 3,
                      }}>FR</span>
                    )}
                    <span style={{ color: '#fff', fontWeight: 500 }}>{player.name}</span>
                  </div>
                </td>
                <td style={{ padding: '9px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: POS_GROUP_COLORS[posGroup(player.position)] || '#64748b',
                      flexShrink: 0,
                    }} />
                    <span style={{
                      background: '#2a2a2a',
                      color: 'var(--bengals-orange)',
                      padding: '2px 6px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 700,
                    }}>{player.position}</span>
                  </div>
                </td>
                <td style={{ padding: '9px 12px', color: '#CBD5E1' }}>{player.age}</td>
                <td style={{ padding: '9px 12px', color: '#fff', fontWeight: 600 }}>
                  ${player.capHit.toFixed(1)}M
                </td>
                <td style={{ padding: '9px 12px', color: player.capHit === 0 ? '#facc15' : '#CBD5E1' }}>
                  {player.capHit === 0 ? 'FA' : `${player.yearsRemaining + 1}yr`}
                </td>
                <td style={{ padding: '9px 12px' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {isExtensionEligible(player) && (
                      <button
                        onClick={() => setExtendingPlayer(player)}
                        style={{
                          background: '#166534',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 4,
                          padding: '6px 10px',
                          cursor: 'pointer',
                          fontSize: 11,
                          fontWeight: 600,
                          minHeight: 36,
                        }}
                      >Extend</button>
                    )}
                    <button
                      onClick={() => setConfirmRestructure(player)}
                      style={{
                        background: '#1e40af',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 4,
                        padding: '6px 10px',
                        cursor: 'pointer',
                        fontSize: 11,
                        fontWeight: 600,
                        minHeight: 36,
                      }}
                    >Restructure</button>
                    <button
                      onClick={() => setConfirmCut(player)}
                      style={{
                        background: '#7f1d1d',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 4,
                        padding: '6px 10px',
                        cursor: 'pointer',
                        fontSize: 11,
                        fontWeight: 600,
                        minHeight: 36,
                      }}
                    >Cut</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sorted.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>No players at this position</div>
      )}

      <PredictionMarkets maxMarkets={3} />

      {/* Cut Confirmation Modal */}
      {confirmCut && (
        <Modal onClose={() => setConfirmCut(null)}>
          <h3 style={{ color: '#ff4444', margin: '0 0 12px' }}>Cut Player</h3>
          <p style={{ color: '#CBD5E1' }}>
            Are you sure you want to cut <strong style={{ color: '#fff' }}>{confirmCut.name}</strong>?
          </p>
          <p style={{ color: '#94A3B8', fontSize: 13 }}>
            Dead cap: ${(confirmCut.deadMoney != null ? confirmCut.deadMoney : confirmCut.capHit * 0.3).toFixed(1)}M<br />
            Cap savings: <span style={{ color: (confirmCut.capSavings != null ? confirmCut.capSavings : confirmCut.capHit * 0.7) > 0 ? '#4ade80' : '#ff4444' }}>
              ${(confirmCut.capSavings != null ? confirmCut.capSavings : confirmCut.capHit * 0.7).toFixed(1)}M
            </span>
            {(confirmCut.capSavings != null ? confirmCut.capSavings : confirmCut.capHit * 0.7) < 0 && (
              <span style={{ color: '#ff4444', fontSize: 12 }}> (cutting costs MORE cap space!)</span>
            )}
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button
              onClick={() => { cutPlayer(confirmCut.id); setConfirmCut(null); }}
              style={{ background: '#7f1d1d', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontWeight: 700, flex: 1 }}
            >Confirm Cut</button>
            <button
              onClick={() => setConfirmCut(null)}
              style={{ background: 'rgba(0,240,255,0.12)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', flex: 1 }}
            >Cancel</button>
          </div>
        </Modal>
      )}

      {/* Restructure Confirmation Modal */}
      {confirmRestructure && (
        <Modal onClose={() => setConfirmRestructure(null)}>
          <h3 style={{ color: '#1e40af', margin: '0 0 12px' }}>Restructure Contract</h3>
          <p style={{ color: '#CBD5E1' }}>
            Restructure <strong style={{ color: '#fff' }}>{confirmRestructure.name}</strong>'s contract?
          </p>
          {(() => {
            const base = confirmRestructure.baseSalary || confirmRestructure.capHit * 0.5;
            const convertible = Math.max(base - 1.1, 0);
            const remainingYrs = Math.max(confirmRestructure.yearsRemaining, 1) + 1;
            const proratedPerYear = convertible / remainingYrs;
            const savings = convertible - proratedPerYear;
            const newCapHit = confirmRestructure.capHit - savings;
            const canRestructure = convertible > 0 && confirmRestructure.yearsRemaining > 0;
            return (
              <div style={{ color: '#94A3B8', fontSize: 13 }}>
                {canRestructure ? (
                  <>
                    <p>Current cap hit: <strong style={{ color: '#fff' }}>${confirmRestructure.capHit.toFixed(1)}M</strong></p>
                    <p>Base salary to convert: ${convertible.toFixed(1)}M → prorated over {remainingYrs} years</p>
                    <p>New cap hit: <strong style={{ color: '#4ade80' }}>${Math.max(newCapHit, 0).toFixed(1)}M</strong> this year</p>
                    <p>Cap savings: <strong style={{ color: '#4ade80' }}>${savings.toFixed(1)}M</strong> (adds 1yr to contract)</p>
                  </>
                ) : (
                  <p style={{ color: '#facc15' }}>
                    {confirmRestructure.yearsRemaining === 0
                      ? 'Cannot restructure — player is in final contract year.'
                      : 'Not enough base salary to restructure.'}
                  </p>
                )}
              </div>
            );
          })()}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button
              onClick={() => {
                const base = confirmRestructure.baseSalary || confirmRestructure.capHit * 0.5;
                const convertible = Math.max(base - 1.1, 0);
                if (convertible > 0 && confirmRestructure.yearsRemaining > 0) {
                  restructureContract(confirmRestructure.id);
                  setConfirmRestructure(null);
                }
              }}
              disabled={(() => {
                const base = confirmRestructure.baseSalary || confirmRestructure.capHit * 0.5;
                const convertible = Math.max(base - 1.1, 0);
                return convertible <= 0 || confirmRestructure.yearsRemaining === 0;
              })()}
              style={{ background: '#1e40af', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontWeight: 700, flex: 1, opacity: (() => { const b = confirmRestructure.baseSalary || confirmRestructure.capHit * 0.5; return (Math.max(b - 1.1, 0) <= 0 || confirmRestructure.yearsRemaining === 0) ? 0.4 : 1; })() }}
            >Confirm</button>
            <button
              onClick={() => setConfirmRestructure(null)}
              style={{ background: 'rgba(0,240,255,0.12)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', flex: 1 }}
            >Cancel</button>
          </div>
        </Modal>
      )}
      {/* Extension Modal */}
      {extendingPlayer && (
        <ExtensionModal
          player={extendingPlayer}
          onExtend={(additionalYears, newAAV, signingBonus, guaranteedPct) => {
            extendPlayer(extendingPlayer.id, additionalYears, newAAV, signingBonus, guaranteedPct);
            setExtendingPlayer(null);
          }}
          onClose={() => setExtendingPlayer(null)}
        />
      )}
    </div>
  );
}

function ExtensionModal({ player, onExtend, onClose }) {
  const [additionalYears, setAdditionalYears] = useState(2);
  const [newAAV, setNewAAV] = useState(parseFloat((player.capHit * 1.1).toFixed(1)));
  const [signingBonus, setSigningBonus] = useState(parseFloat((player.capHit * 1.1 * (player.yearsRemaining + 2) * 0.3).toFixed(1)));
  const [guaranteedPct, setGuaranteedPct] = useState(50);

  const totalYears = player.yearsRemaining + additionalYears;
  const totalValue = parseFloat((newAAV * totalYears).toFixed(1));
  const guaranteed = parseFloat((totalValue * guaranteedPct / 100).toFixed(1));
  const maxSigningBonus = Math.min(totalValue * 0.6, totalValue);
  const actualSigningBonus = Math.min(signingBonus, maxSigningBonus);
  const proratedBonus = totalYears > 0 ? parseFloat((actualSigningBonus / totalYears).toFixed(2)) : 0;
  const baseSalaryY1 = Math.max(1.1, newAAV - proratedBonus);
  const year1CapHit = parseFloat((baseSalaryY1 + proratedBonus).toFixed(1));

  // Player acceptance: must meet minimum AAV based on current capHit * 0.9
  const minimumAAV = parseFloat((player.capHit * 0.9).toFixed(1));
  const willAccept = newAAV >= minimumAAV && guaranteedPct >= 30;
  const isGreatDeal = newAAV >= player.capHit * 1.15 && guaranteedPct >= 55;

  let acceptLabel = '';
  let acceptColor = '#4ade80';
  if (isGreatDeal) { acceptLabel = 'Player loves this extension!'; acceptColor = '#4ade80'; }
  else if (willAccept) { acceptLabel = 'Player willing to extend'; acceptColor = '#facc15'; }
  else if (newAAV < minimumAAV) { acceptLabel = `Below minimum — needs at least $${minimumAAV.toFixed(1)}M AAV`; acceptColor = '#ff4444'; }
  else { acceptLabel = 'Needs more guaranteed money (30%+ of total)'; acceptColor = '#ff4444'; }

  const capDiff = year1CapHit - player.capHit;

  const handleYearsChange = (v) => { setAdditionalYears(v); setSigningBonus(parseFloat((newAAV * (player.yearsRemaining + v) * 0.3).toFixed(1))); };
  const handleAavChange = (v) => { setNewAAV(v); setSigningBonus(parseFloat((v * totalYears * 0.3).toFixed(1))); };

  const row = (label, value, color = '#CBD5E1') => (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
      <span style={{ color: '#94A3B8' }}>{label}</span>
      <span style={{ color, fontWeight: 700 }}>{value}</span>
    </div>
  );

  return (
    <Modal onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: '0 0 2px', color: '#4ade80', fontSize: 18 }}>Extend Contract</h3>
          <p style={{ margin: 0, color: '#94A3B8', fontSize: 13 }}>{player.name} · {player.position} · {player.yearsRemaining + 1}yr remaining</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: '#facc15', fontSize: 12, fontWeight: 700 }}>Current: ${player.capHit.toFixed(1)}M/yr</div>
        </div>
      </div>

      {/* Additional Years */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'flex', justifyContent: 'space-between', color: '#94A3B8', fontSize: 12, marginBottom: 6 }}>
          <span>Additional Years</span>
          <strong style={{ color: '#fff' }}>{additionalYears} year{additionalYears > 1 ? 's' : ''} ({totalYears} total)</strong>
        </label>
        <input type="range" min={1} max={4} value={additionalYears} onChange={e => handleYearsChange(Number(e.target.value))}
          style={{ width: '100%', accentColor: 'var(--bengals-orange)' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(0,240,255,0.18)' }}>
          <span>1yr</span><span>2yr</span><span>3yr</span><span>4yr</span>
        </div>
      </div>

      {/* New AAV */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'flex', justifyContent: 'space-between', color: '#94A3B8', fontSize: 12, marginBottom: 6 }}>
          <span>New AAV</span>
          <strong style={{ color: '#fff' }}>${newAAV.toFixed(1)}M</strong>
        </label>
        <input type="range" min={Math.max(0.5, player.capHit * 0.5)} max={player.capHit * 2.5} step={0.1}
          value={newAAV} onChange={e => handleAavChange(Number(e.target.value))}
          style={{ width: '100%', accentColor: 'var(--bengals-orange)' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(0,240,255,0.18)' }}>
          <span>${(player.capHit * 0.5).toFixed(0)}M</span><span>${(player.capHit * 2.5).toFixed(0)}M</span>
        </div>
      </div>

      {/* Signing Bonus */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'flex', justifyContent: 'space-between', color: '#94A3B8', fontSize: 12, marginBottom: 6 }}>
          <span>Signing Bonus</span>
          <strong style={{ color: '#fff' }}>${actualSigningBonus.toFixed(1)}M</strong>
        </label>
        <input type="range" min={0} max={maxSigningBonus} step={0.5} value={signingBonus}
          onChange={e => setSigningBonus(Number(e.target.value))}
          style={{ width: '100%', accentColor: 'var(--bengals-orange)' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(0,240,255,0.18)' }}>
          <span>$0</span><span>${maxSigningBonus.toFixed(0)}M</span>
        </div>
      </div>

      {/* Guaranteed % */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'flex', justifyContent: 'space-between', color: '#94A3B8', fontSize: 12, marginBottom: 6 }}>
          <span>Guaranteed Money</span>
          <strong style={{ color: '#fff' }}>${guaranteed.toFixed(1)}M ({guaranteedPct}%)</strong>
        </label>
        <input type="range" min={0} max={100} step={5} value={guaranteedPct}
          onChange={e => setGuaranteedPct(Number(e.target.value))}
          style={{ width: '100%', accentColor: 'var(--bengals-orange)' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(0,240,255,0.18)' }}>
          <span>0%</span><span>50%</span><span>100%</span>
        </div>
      </div>

      {/* Contract Breakdown */}
      <div style={{ background: '#0a0f1e', borderRadius: 10, padding: 14, marginBottom: 12 }}>
        <div style={{ color: '#CBD5E1', fontSize: 11, fontWeight: 700, marginBottom: 8, letterSpacing: '0.04em' }}>NEW CONTRACT</div>
        {row('Total value', `$${totalValue.toFixed(1)}M / ${totalYears}yr`)}
        {row('New AAV', `$${newAAV.toFixed(1)}M`)}
        {row('Signing bonus', `$${actualSigningBonus.toFixed(1)}M (prorated $${proratedBonus.toFixed(1)}M/yr)`)}
        {row('Guaranteed', `$${guaranteed.toFixed(1)}M (${guaranteedPct}%)`)}
        <div style={{ borderTop: '1px solid rgba(0,240,255,0.12)', margin: '8px 0', paddingTop: 8 }} />
        <div style={{ color: '#CBD5E1', fontSize: 11, fontWeight: 700, marginBottom: 8, letterSpacing: '0.04em' }}>CAP IMPACT</div>
        {row('New Year 1 cap hit', `$${year1CapHit.toFixed(1)}M`, year1CapHit <= player.capHit ? '#4ade80' : '#facc15')}
        {row('Cap impact vs current', `${capDiff >= 0 ? '+' : ''}$${capDiff.toFixed(1)}M`, capDiff <= 0 ? '#4ade80' : '#ff4444')}
      </div>

      {/* Player Acceptance Indicator */}
      <div style={{
        background: willAccept ? 'rgba(74,222,128,0.1)' : 'rgba(255,68,68,0.1)',
        border: `1px solid ${acceptColor}`,
        borderRadius: 8, padding: 10, marginBottom: 12, textAlign: 'center',
      }}>
        <div style={{ color: acceptColor, fontSize: 13, fontWeight: 700 }}>{acceptLabel}</div>
        {!willAccept && (
          <div style={{ color: '#94A3B8', fontSize: 11, marginTop: 4 }}>
            Adjust terms to meet player expectations
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => onExtend(additionalYears, newAAV, actualSigningBonus, guaranteedPct)}
          disabled={!willAccept}
          style={{
            background: willAccept ? '#166534' : 'rgba(0,240,255,0.12)',
            color: willAccept ? '#fff' : '#475569',
            border: 'none', borderRadius: 8, padding: '12px 0',
            cursor: willAccept ? 'pointer' : 'not-allowed',
            fontWeight: 800, flex: 1, fontSize: 14,
            opacity: willAccept ? 1 : 0.5,
          }}
        >
          {willAccept ? 'Extend Player' : 'Player Declines'}
        </button>
        <button onClick={onClose}
          style={{ background: 'rgba(0,240,255,0.12)', color: '#fff', border: 'none', borderRadius: 8, padding: '12px 0', cursor: 'pointer', flex: 0.6, fontSize: 13 }}
        >Cancel</button>
      </div>
    </Modal>
  );
}

function Modal({ children, onClose }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,8,20,0.90)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 16,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#0f172a',
        border: '1px solid rgba(0,240,255,0.12)',
        borderRadius: 12,
        padding: 24,
        maxWidth: 'min(400px, 95vw)',
        width: '100%',
      }}>
        {children}
      </div>
    </div>
  );
}

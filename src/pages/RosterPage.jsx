import React, { useState } from 'react';
import { useGame } from '../context/GameContext';

const POSITIONS = ['All', 'QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB', 'ST'];
const OL_POSITIONS = ['LT', 'RT', 'LG', 'RG', 'C', 'OT', 'OG', 'IOL'];
const DL_POSITIONS = ['DE', 'DT', 'NT', 'DL', 'EDGE'];
const DB_POSITIONS = ['CB', 'S', 'FS', 'SS'];
const ST_POSITIONS = ['K', 'P', 'LS'];
const LB_POSITIONS = ['LB', 'MLB', 'OLB'];

function posGroup(pos) {
  if (OL_POSITIONS.includes(pos)) return 'OL';
  if (DL_POSITIONS.includes(pos)) return 'DL';
  if (DB_POSITIONS.includes(pos)) return 'DB';
  if (ST_POSITIONS.includes(pos)) return 'ST';
  if (LB_POSITIONS.includes(pos)) return 'LB';
  return pos;
}

export default function RosterPage() {
  const { roster, cutPlayer, restructureContract, capUsed, totalCap } = useGame();
  const [filterPos, setFilterPos] = useState('All');
  const [sortKey, setSortKey] = useState('capHit');
  const [sortDir, setSortDir] = useState('desc');
  const [confirmCut, setConfirmCut] = useState(null);
  const [confirmRestructure, setConfirmRestructure] = useState(null);

  const filtered = roster.filter(p => {
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
    if (sortKey !== col) return <span style={{ color: '#4a7a58' }}> ⇅</span>;
    return <span style={{ color: 'var(--bengals-orange)' }}>{sortDir === 'asc' ? ' ↑' : ' ↓'}</span>;
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22, color: 'var(--bengals-orange)' }}>Roster Management</h1>
        <p style={{ margin: '4px 0 0', color: '#6a9a78', fontSize: 14 }}>
          {roster.length} players · ${capUsed.toFixed(1)}M / ${totalCap}M cap used
        </p>
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
              background: filterPos === pos ? 'var(--bengals-orange)' : '#1a3a22',
              color: filterPos === pos ? '#000' : '#c4d8cc',
              fontSize: 12,
              fontWeight: filterPos === pos ? 700 : 400,
              transition: 'all 0.15s',
            }}
          >
            {pos}
          </button>
        ))}
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid rgba(40,200,40,0.25)', maxWidth: '100%', WebkitOverflowScrolling: 'touch' }}>
        <table style={{ width: '100%', minWidth: 520, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#0d2a16', borderBottom: '2px solid var(--bengals-orange)' }}>
              {[
                { key: 'name', label: 'Player' },
                { key: 'position', label: 'Pos' },
                { key: 'age', label: 'Age' },
                { key: 'capHit', label: 'Cap Hit' },
                { key: 'yearsRemaining', label: 'Yrs Left' },
              ].map(col => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  style={{
                    padding: '10px 12px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    color: '#c4d8cc',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    userSelect: 'none',
                  }}
                >
                  {col.label}<SortIndicator col={col.key} />
                </th>
              ))}
              <th style={{ padding: '10px 12px', color: '#c4d8cc', fontWeight: 600, whiteSpace: 'nowrap' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((player, idx) => (
              <tr
                key={player.id}
                style={{
                  background: player.isFranchise ? 'rgba(251,79,20,0.1)' : idx % 2 === 0 ? '#081f0e' : '#141414',
                  borderBottom: '1px solid #1a2420',
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
                  <span style={{
                    background: '#2a2a2a',
                    color: 'var(--bengals-orange)',
                    padding: '2px 6px',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 700,
                  }}>{player.position}</span>
                </td>
                <td style={{ padding: '9px 12px', color: '#c4d8cc' }}>{player.age}</td>
                <td style={{ padding: '9px 12px', color: '#fff', fontWeight: 600 }}>
                  ${player.capHit.toFixed(1)}M
                </td>
                <td style={{ padding: '9px 12px', color: player.yearsRemaining === 0 ? '#facc15' : '#c4d8cc' }}>
                  {player.yearsRemaining === 0 ? 'FA' : `${player.yearsRemaining}yr`}
                </td>
                <td style={{ padding: '9px 12px' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
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
                        minHeight: 32,
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
                        minHeight: 32,
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
        <div style={{ textAlign: 'center', padding: 40, color: '#4a7a58' }}>No players at this position</div>
      )}

      {/* Cut Confirmation Modal */}
      {confirmCut && (
        <Modal onClose={() => setConfirmCut(null)}>
          <h3 style={{ color: '#ff4444', margin: '0 0 12px' }}>Cut Player</h3>
          <p style={{ color: '#c4d8cc' }}>
            Are you sure you want to cut <strong style={{ color: '#fff' }}>{confirmCut.name}</strong>?
          </p>
          <p style={{ color: '#6a9a78', fontSize: 13 }}>
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
              style={{ background: 'rgba(40,200,40,0.25)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', flex: 1 }}
            >Cancel</button>
          </div>
        </Modal>
      )}

      {/* Restructure Confirmation Modal */}
      {confirmRestructure && (
        <Modal onClose={() => setConfirmRestructure(null)}>
          <h3 style={{ color: '#1e40af', margin: '0 0 12px' }}>Restructure Contract</h3>
          <p style={{ color: '#c4d8cc' }}>
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
              <div style={{ color: '#6a9a78', fontSize: 13 }}>
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
              style={{ background: 'rgba(40,200,40,0.25)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', flex: 1 }}
            >Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ children, onClose }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(5,10,8,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 16,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#0d2a16',
        border: '1px solid rgba(40,200,40,0.25)',
        borderRadius: 12,
        padding: 24,
        maxWidth: 400,
        width: '100%',
      }}>
        {children}
      </div>
    </div>
  );
}

import React, { useState, useEffect } from 'react';

const STORAGE_KEY = 'ainfl_leaderboard';
const MAX_ENTRIES = 50;

const GRADE_SCORES = {
  'A+': 97, 'A': 92, 'A-': 87,
  'B+': 82, 'B': 77, 'B-': 72,
  'C+': 67, 'C': 62, 'C-': 57,
  'D+': 52, 'D': 47, 'D-': 42,
  'F': 35,
};

function gradeToScore(grade) {
  return GRADE_SCORES[grade] || 50;
}

function rankColor(rank) {
  if (rank === 1) return '#FFD700';
  if (rank === 2) return '#C0C0C0';
  if (rank === 3) return '#CD7F32';
  return '#94A3B8';
}

function gradeColor(grade) {
  if (!grade) return '#94A3B8';
  if (grade.startsWith('A')) return '#4ade80';
  if (grade.startsWith('B')) return '#60a5fa';
  if (grade.startsWith('C')) return '#facc15';
  if (grade.startsWith('D')) return '#fb923c';
  return '#ef4444';
}

function getLeaderboard() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveLeaderboard(entries) {
  const sorted = entries
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ENTRIES);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted));
  return sorted;
}

function getUserId() {
  let id = localStorage.getItem('ainfl_user_id');
  if (!id) {
    id = 'user_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem('ainfl_user_id', id);
  }
  return id;
}

export function submitToLeaderboard({ username, team, overallGrade, draftGrade, faGrade }) {
  const userId = getUserId();
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    userId,
    username: username || 'Anonymous GM',
    team,
    overallGrade,
    draftGrade,
    faGrade,
    score: gradeToScore(overallGrade),
    draftScore: gradeToScore(draftGrade),
    faScore: gradeToScore(faGrade),
    date: new Date().toISOString(),
  };

  const existing = getLeaderboard();
  existing.push(entry);
  saveLeaderboard(existing);

  // Send to ntfy.sh for owner visibility
  const body = [
    `New Leaderboard Submission`,
    `Username: ${entry.username}`,
    `Team: ${team}`,
    `Overall: ${overallGrade} | Draft: ${draftGrade} | FA: ${faGrade}`,
    `Time: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`,
  ].join('\n');

  fetch('https://ntfy.sh/ainfl-gm-visitors-jf2026', {
    method: 'POST',
    headers: {
      'Title': `Leaderboard: ${entry.username} - ${team} - ${overallGrade}`,
      'Priority': '3',
      'Tags': 'trophy',
    },
    body,
  }).catch(() => {});

  return entry;
}

export default function Leaderboard({ onClose, accentColor = '#FB4F14' }) {
  const [entries, setEntries] = useState([]);
  const userId = getUserId();

  useEffect(() => {
    setEntries(getLeaderboard());
  }, []);

  function handleClearMine() {
    if (!window.confirm('Remove all your entries from the leaderboard?')) return;
    const filtered = entries.filter(e => e.userId !== userId);
    const saved = saveLeaderboard(filtered);
    setEntries(saved);
  }

  // Find user's best entry
  const userEntries = entries.filter(e => e.userId === userId);
  const bestEntry = userEntries.length > 0
    ? userEntries.reduce((best, e) => e.score > best.score ? e : best, userEntries[0])
    : null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.85)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: '#0a0f1e', border: '1px solid rgba(0,240,255,0.2)',
        borderRadius: 16, width: '100%', maxWidth: 800, maxHeight: '90vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px 16px', borderBottom: '1px solid rgba(0,240,255,0.12)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexWrap: 'wrap', gap: 8,
        }}>
          <div>
            <h2 style={{ margin: 0, color: '#fff', fontSize: 20, fontWeight: 800 }}>
              Community Leaderboard
            </h2>
            <div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>
              {entries.length} submission{entries.length !== 1 ? 's' : ''} · Top {MAX_ENTRIES} shown
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {userEntries.length > 0 && (
              <button onClick={handleClearMine} style={{
                background: '#7f1d1d', color: '#fff', border: 'none', borderRadius: 8,
                padding: '8px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 12,
              }}>Clear My Entries</button>
            )}
            <button onClick={onClose} style={{
              background: '#1e293b', color: '#fff', border: '1px solid #334155',
              borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 12,
            }}>Close</button>
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowY: 'auto', overflowX: 'auto', flex: 1, padding: '0 8px 16px' }}>
          {entries.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: 48, color: '#64748b', fontSize: 14,
            }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>No submissions yet</div>
              <div>Be the first to submit your offseason grade!</div>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${accentColor}` }}>
                  {['#', 'Username', 'Team', 'Overall', 'Draft', 'FA', 'Date'].map(col => (
                    <th key={col} style={{
                      padding: '8px 10px', textAlign: col === '#' ? 'center' : 'left',
                      color: '#94A3B8', fontWeight: 700, fontSize: 11, textTransform: 'uppercase',
                      letterSpacing: 0.5, whiteSpace: 'nowrap', position: 'sticky', top: 0,
                      background: '#0a0f1e',
                    }}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, i) => {
                  const rank = i + 1;
                  const isOwn = entry.userId === userId;
                  const isBest = bestEntry && entry.id === bestEntry.id;
                  const rowBg = isOwn
                    ? (i % 2 === 0 ? 'rgba(0,240,255,0.08)' : 'rgba(0,240,255,0.04)')
                    : (i % 2 === 0 ? '#0f172a' : 'transparent');

                  return (
                    <tr key={entry.id} style={{
                      background: rowBg,
                      borderBottom: '1px solid #1a2420',
                      borderLeft: isOwn ? '3px solid #00f0ff' : '3px solid transparent',
                    }}>
                      <td style={{
                        padding: '10px', textAlign: 'center',
                        color: rankColor(rank), fontWeight: 900, fontSize: rank <= 3 ? 18 : 14,
                      }}>
                        {rank <= 3 ? ['', '\u{1F947}', '\u{1F948}', '\u{1F949}'][rank] : rank}
                      </td>
                      <td style={{ padding: '10px', color: isOwn ? '#00f0ff' : '#fff', fontWeight: isOwn ? 700 : 400 }}>
                        {entry.username}
                        {isBest && (
                          <span style={{
                            marginLeft: 8, background: '#fbbf2422', color: '#fbbf24',
                            border: '1px solid #fbbf24', borderRadius: 4,
                            padding: '1px 6px', fontSize: 9, fontWeight: 800,
                            verticalAlign: 'middle',
                          }}>YOUR BEST</span>
                        )}
                        {isOwn && !isBest && (
                          <span style={{
                            marginLeft: 8, background: 'rgba(0,240,255,0.1)', color: '#00f0ff',
                            borderRadius: 4, padding: '1px 6px', fontSize: 9, fontWeight: 700,
                            verticalAlign: 'middle',
                          }}>YOU</span>
                        )}
                      </td>
                      <td style={{ padding: '10px', color: accentColor, fontWeight: 700 }}>
                        {entry.team}
                      </td>
                      <td style={{ padding: '10px' }}>
                        <span style={{
                          background: gradeColor(entry.overallGrade) + '22',
                          color: gradeColor(entry.overallGrade),
                          border: `1px solid ${gradeColor(entry.overallGrade)}`,
                          borderRadius: 6, padding: '2px 10px', fontWeight: 900, fontSize: 15,
                        }}>{entry.overallGrade}</span>
                      </td>
                      <td style={{ padding: '10px', color: gradeColor(entry.draftGrade), fontWeight: 700 }}>
                        {entry.draftGrade}
                      </td>
                      <td style={{ padding: '10px', color: gradeColor(entry.faGrade), fontWeight: 700 }}>
                        {entry.faGrade}
                      </td>
                      <td style={{ padding: '10px', color: '#64748b', fontSize: 11, whiteSpace: 'nowrap' }}>
                        {new Date(entry.date).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 24px', borderTop: '1px solid rgba(0,240,255,0.12)',
          color: '#475569', fontSize: 11, textAlign: 'center',
        }}>
          Leaderboard data is stored locally in your browser. Submissions are also sent to the developer for community tracking.
        </div>
      </div>
    </div>
  );
}

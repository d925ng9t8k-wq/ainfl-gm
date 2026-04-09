import React, { useRef, useState } from 'react';
import { toPng } from 'html-to-image';

function gradeLetterColor(letter) {
  if (!letter) return '#94a3b8';
  if (letter.startsWith('A')) return '#4ade80';
  if (letter.startsWith('B')) return '#60a5fa';
  if (letter.startsWith('C')) return '#fbbf24';
  if (letter.startsWith('D')) return '#fb923c';
  return '#ef4444';
}

function gradeNumColor(grade) {
  if (grade >= 90) return '#fbbf24';
  if (grade >= 80) return '#4ade80';
  if (grade >= 70) return '#60a5fa';
  if (grade >= 60) return '#fb923c';
  return '#94a3b8';
}

function getRoundForPick(pickNumber) {
  if (pickNumber <= 32) return 1;
  if (pickNumber <= 64) return 2;
  if (pickNumber <= 96) return 3;
  if (pickNumber <= 128) return 4;
  if (pickNumber <= 160) return 5;
  if (pickNumber <= 192) return 6;
  return 7;
}

export default function ShareCard({ teamAbbr, teamName, draftGrade, avgGrade, picks, accentColor, onClose }) {
  const cardRef = useRef(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);

  const accent = accentColor || '#FB4F14';

  // Convert hex to rgba helper
  function hexToRgba(hex, alpha) {
    if (!hex || !hex.startsWith('#')) return `rgba(251,79,20,${alpha})`;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  const accentDim = hexToRgba(accent, 0.15);
  const accentGlow = hexToRgba(accent, 0.3);
  const gradeColor = gradeLetterColor(draftGrade);

  async function handleDownload() {
    if (!cardRef.current) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const dataUrl = await toPng(cardRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#0f172a',
      });
      const link = document.createElement('a');
      link.download = `${teamAbbr || 'draft'}-2026-mock-draft.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('ShareCard download failed:', err);
      setDownloadError('Download failed. Try screenshotting instead.');
    } finally {
      setDownloading(false);
    }
  }

  function handleShareX() {
    const topPicks = picks.slice(0, 3).map(p => `${p.name} (${p.position})`).join(', ');
    const text =
      `My ${teamName || teamAbbr} 2026 NFL Mock Draft: ${draftGrade} grade\n` +
      `Top picks: ${topPicks}\n` +
      `Think you can draft better?\n` +
      `ainflgm.com`;
    window.open(
      `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`,
      '_blank',
      'width=550,height=420'
    );
  }

  // Show up to 10 picks on card, indicate if more exist
  const visiblePicks = picks.slice(0, 10);
  const hiddenCount = picks.length - visiblePicks.length;

  return (
    /* Overlay */
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      }}
    >
      {/* Inner wrapper — stops click propagation */}
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 640 }}>

        {/* Action buttons above card */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 12, gap: 8, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleDownload}
              disabled={downloading}
              style={{
                background: accent, color: '#000', border: 'none', borderRadius: 8,
                padding: '10px 20px', cursor: downloading ? 'not-allowed' : 'pointer',
                fontWeight: 800, fontSize: 14, opacity: downloading ? 0.7 : 1,
                fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
                letterSpacing: '0.04em', textTransform: 'uppercase',
              }}
            >
              {downloading ? 'Saving...' : 'Download Image'}
            </button>
            <button
              onClick={handleShareX}
              style={{
                background: '#000', color: '#fff',
                border: '1px solid #333', borderRadius: 8,
                padding: '10px 20px', cursor: 'pointer',
                fontWeight: 800, fontSize: 14,
                fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
                letterSpacing: '0.04em', textTransform: 'uppercase',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {/* X icon */}
              <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
              Share on X
            </button>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.08)', color: '#94A3B8',
              border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8,
              padding: '10px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 13,
            }}
          >
            Close
          </button>
        </div>

        {downloadError && (
          <div style={{
            color: '#ef4444', fontSize: 12, marginBottom: 8,
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 6, padding: '6px 12px',
          }}>
            {downloadError}
          </div>
        )}

        {/* THE CARD — this is what gets captured */}
        <div
          ref={cardRef}
          style={{
            background: '#0f172a',
            borderRadius: 16,
            overflow: 'hidden',
            border: `2px solid ${accentGlow}`,
            fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
            position: 'relative',
          }}
        >
          {/* Top accent bar */}
          <div style={{ height: 5, background: accent, width: '100%' }} />

          {/* Header */}
          <div style={{
            padding: '24px 28px 0',
            background: `linear-gradient(135deg, ${hexToRgba(accent, 0.14)} 0%, transparent 60%)`,
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
              flexWrap: 'wrap', gap: 8,
            }}>
              <div>
                <div style={{
                  color: accent, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
                  textTransform: 'uppercase', marginBottom: 4,
                }}>
                  2026 NFL Mock Draft Results
                </div>
                <div style={{
                  color: '#fff', fontSize: 26, fontWeight: 900, lineHeight: 1.1,
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>
                  {teamName || teamAbbr}
                </div>
                <div style={{ color: '#64748b', fontSize: 12, marginTop: 2, letterSpacing: '0.06em' }}>
                  {picks.length} picks &nbsp;|&nbsp; Avg grade {avgGrade}
                </div>
              </div>

              {/* Grade block */}
              <div style={{
                background: hexToRgba(gradeColor, 0.1),
                border: `2px solid ${hexToRgba(gradeColor, 0.4)}`,
                borderRadius: 12, padding: '8px 20px',
                textAlign: 'center', minWidth: 80,
              }}>
                <div style={{ color: '#64748b', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>
                  Grade
                </div>
                <div style={{
                  color: gradeColor, fontSize: 52, fontWeight: 900,
                  lineHeight: 1, letterSpacing: '-0.02em',
                }}>
                  {draftGrade || '?'}
                </div>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div style={{
            height: 1, margin: '20px 28px 0',
            background: `linear-gradient(90deg, ${accent}, transparent)`,
          }} />

          {/* Picks list */}
          <div style={{ padding: '16px 28px' }}>
            {visiblePicks.map((pick, i) => {
              const round = getRoundForPick(pick.pickNumber || 0);
              const numColor = gradeNumColor(pick.grade);
              return (
                <div
                  key={pick.pickNumber || i}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '7px 0',
                    borderBottom: i < visiblePicks.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                    gap: 8,
                  }}
                >
                  {/* Pick number badge */}
                  <div style={{
                    background: accentDim,
                    border: `1px solid ${hexToRgba(accent, 0.25)}`,
                    borderRadius: 6, padding: '2px 8px',
                    color: accent, fontSize: 11, fontWeight: 700,
                    minWidth: 28, textAlign: 'center', flexShrink: 0,
                    letterSpacing: '0.02em',
                  }}>
                    #{pick.pickNumber || '—'}
                  </div>

                  {/* Round label */}
                  <div style={{
                    color: '#475569', fontSize: 10, fontWeight: 700,
                    letterSpacing: '0.06em', textTransform: 'uppercase',
                    minWidth: 38, flexShrink: 0,
                  }}>
                    Rd {round}
                  </div>

                  {/* Name + position */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{
                      color: '#e2e8f0', fontWeight: 700, fontSize: 14,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      display: 'block',
                    }}>
                      {pick.name}
                    </span>
                  </div>

                  {/* Position badge */}
                  <div style={{
                    color: '#94a3b8', fontSize: 11, fontWeight: 700,
                    letterSpacing: '0.04em', flexShrink: 0,
                  }}>
                    {pick.position}
                  </div>

                  {/* Grade pill */}
                  <div style={{
                    background: hexToRgba(numColor, 0.1),
                    border: `1px solid ${hexToRgba(numColor, 0.4)}`,
                    borderRadius: 6, padding: '2px 8px',
                    color: numColor, fontSize: 12, fontWeight: 800,
                    minWidth: 34, textAlign: 'center', flexShrink: 0,
                  }}>
                    {pick.grade}
                  </div>
                </div>
              );
            })}

            {hiddenCount > 0 && (
              <div style={{
                color: '#475569', fontSize: 12, textAlign: 'center',
                paddingTop: 10, letterSpacing: '0.04em',
              }}>
                + {hiddenCount} more pick{hiddenCount !== 1 ? 's' : ''}
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{
            background: hexToRgba(accent, 0.06),
            borderTop: `1px solid ${hexToRgba(accent, 0.15)}`,
            padding: '14px 28px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            flexWrap: 'wrap', gap: 8,
          }}>
            <div style={{
              color: accent, fontWeight: 900, fontSize: 15,
              letterSpacing: '0.06em', textTransform: 'uppercase',
            }}>
              ainflgm.com
            </div>
            <div style={{
              color: '#64748b', fontSize: 12, fontWeight: 600,
              letterSpacing: '0.04em',
            }}>
              Think you can draft better?
            </div>
          </div>

          {/* Bottom accent bar */}
          <div style={{ height: 4, background: `linear-gradient(90deg, ${accent}, transparent)` }} />
        </div>

      </div>
    </div>
  );
}

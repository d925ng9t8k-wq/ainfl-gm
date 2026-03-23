import React from 'react';
import { NavLink } from 'react-router-dom';
import { useGame } from '../context/GameContext';
import FloatingMenu from './FloatingMenu';
import ScenarioManager from './ScenarioManager';
import ShareButtons from './ShareButtons';
import EmailCapture from './EmailCapture';

const navItems = [
  { path: '/', label: 'Roster', iconType: 'roster' },
  { path: '/cap', label: 'Cap', iconType: 'cap' },
  { path: '/fa', label: 'Free Agency', iconType: 'fa' },
  { path: '/trades', label: 'Trades', iconType: 'trades' },
  { path: '/draft', label: 'Draft', iconType: 'draft' },
  { path: '/summary', label: 'Summary', iconType: 'summary' },
  { path: '/season', label: 'Season', iconType: 'season' },
  { path: '/markets', label: 'Markets', iconType: 'markets' },
];

function NavIcon({ type }) {
  const props = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 };
  switch (type) {
    case 'roster':
      return (<svg {...props}><path d="M12 2C7 2 3 6 3 11c0 3 1.5 5.5 4 7l1 3h8l1-3c2.5-1.5 4-4 4-7 0-5-4-9-9-9z"/><path d="M9 21h6M8 11h8"/></svg>);
    case 'cap':
      return (<svg {...props}><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 7v10M9 9.5c0-1.1.9-2 2-2h2c1.1 0 2 .9 2 2s-.9 2-2 2h-2c-1.1 0-2 .9-2 2s.9 2 2 2h2c1.1 0 2-.9 2-2"/></svg>);
    case 'fa':
      return (<svg {...props}><path d="M17 3l4 4-10 10H7v-4L17 3z"/><path d="M3 21h18"/></svg>);
    case 'trades':
      return (<svg {...props}><path d="M7 16l-4-4 4-4"/><path d="M3 12h14"/><path d="M17 8l4 4-4 4"/><path d="M21 12H7"/></svg>);
    case 'draft':
      return (<svg {...props}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>);
    case 'summary':
      return (<svg {...props}><path d="M4 20h16"/><path d="M4 20V10l4-4 4 6 4-8 4 6v10"/></svg>);
    case 'season':
      return (<svg {...props}><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 22V10"/><path d="M14 22V10"/><path d="M5 9h14l-1 7H6L5 9z"/></svg>);
    case 'markets':
      return (<svg {...props}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>);
    default:
      return null;
  }
}

// Ensure a color has sufficient contrast against a dark background
// Returns the color if bright enough, otherwise returns a lightened version or white
function ensureContrast(hexColor) {
  if (!hexColor) return '#FFFFFF';
  const hex = hexColor.replace('#', '');
  if (hex.length !== 6) return '#FFFFFF';
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  // Relative luminance (perceived brightness)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (luminance >= 0.35) return hexColor; // bright enough
  if (luminance >= 0.15) {
    // Lighten the color by blending with white
    const factor = 0.5;
    const lr = Math.round(r + (255 - r) * factor);
    const lg = Math.round(g + (255 - g) * factor);
    const lb = Math.round(b + (255 - b) * factor);
    return `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`;
  }
  return '#FFFFFF'; // too dark, use white
}

export default function Layout({ children }) {
  const { capUsed, totalCap, capAvailable, allTeams, currentTeamAbbr, selectedTeamColors, selectTeam } = useGame();
  const capPct = Math.min((capUsed / totalCap) * 100, 100);
  const isOverCap = capUsed > totalCap;

  const currentTeamObj = allTeams.find(t => t.abbreviation === currentTeamAbbr) || allTeams[0];
  const teamLabel = `${currentTeamObj.city} ${currentTeamObj.name}`;
  const primaryColor = selectedTeamColors?.primaryColor || '#FB4F14';
  const secondaryColor = selectedTeamColors?.secondaryColor || '#000000';

  // Use team's primary color as accent, ensuring good contrast against dark backgrounds
  const rawAccent = primaryColor === '#000000' ? (secondaryColor !== '#000000' ? secondaryColor : '#FB4F14') : primaryColor;
  const accentColor = ensureContrast(rawAccent);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>

      {/* Top Nav */}
      <header style={{
        background: 'linear-gradient(135deg, #000814 0%, #0A1628 50%, #000814 100%)',
        borderBottom: '1px solid rgba(0,240,255,0.3)',
        boxShadow: '0 1px 20px rgba(0,240,255,0.15), 0 2px 20px rgba(0,0,0,0.5)',
        padding: '0 16px',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}>
        {/* Robot accent - right side of header */}
        <div className="robot-accent" style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: 200,
          overflow: 'hidden',
          backgroundImage: 'url(/robot-small.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center top',
          opacity: 0.6,
          maskImage: 'linear-gradient(to left, black 20%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to left, black 20%, transparent 100%)',
          pointerEvents: 'none',
          zIndex: 0,
        }} />

        <div style={{
          maxWidth: 1200,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          minHeight: 60,
          padding: '4px 0',
          position: 'relative',
          zIndex: 1,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Branding */}
            <div style={{
              marginRight: 4,
              position: 'relative',
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 0, lineHeight: 1.1, position: 'relative' }}>
                <span style={{
                  fontWeight: 900,
                  fontSize: 20,
                  fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
                  letterSpacing: '0.04em',
                  background: 'linear-gradient(135deg, #00F0FF 0%, #80F8FF 40%, #E2E8F0 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                  textShadow: 'none',
                  filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6)) drop-shadow(0 0 12px rgba(0,240,255,0.5))',
                }}>AiNFL</span>
                <span style={{
                  fontWeight: 900,
                  fontSize: 20,
                  fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: accentColor,
                  marginLeft: 3,
                  textShadow: `0 1px 2px rgba(0,0,0,0.5), 0 0 18px ${accentColor}66`,
                }}>GM</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 1 }}>
                <span style={{ color: 'rgba(0,240,255,0.4)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', position: 'relative', fontFamily: "'Oswald', 'Inter', system-ui, sans-serif" }}>AI-Powered</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#39FF14', boxShadow: '0 0 8px rgba(57,255,20,0.5)', animation: 'neonPulse 2s ease-in-out infinite' }} />
                  <span style={{ color: 'rgba(57,255,20,0.6)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase' }}>ONLINE</span>
                </div>
              </div>
            </div>
            {/* Thin neon divider between branding and team selector */}
            <div style={{
              width: 1,
              height: 36,
              marginRight: 2,
              background: 'linear-gradient(180deg, transparent 0%, rgba(0,240,255,0.3) 20%, rgba(0,240,255,0.15) 80%, transparent 100%)',
              borderRadius: 1,
            }} />
            <div style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              backgroundImage: 'url(/robot-small.jpg)',
              backgroundSize: 'cover',
              backgroundPosition: 'center 20%',
              border: '2px solid rgba(0,240,255,0.5)',
              boxShadow: '0 0 12px rgba(0,240,255,0.3)',
              flexShrink: 0,
            }} />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <select
                  value={currentTeamAbbr}
                  onChange={e => selectTeam(e.target.value)}
                  style={{
                    background: 'rgba(30,41,59,0.9)',
                    color: accentColor,
                    border: '1px solid rgba(0,240,255,0.15)',
                    borderRadius: 6,
                    padding: '2px 6px',
                    fontWeight: 800,
                    fontSize: 14,
                    cursor: 'pointer',
                    lineHeight: 1.2,
                    maxWidth: 160,
                    backdropFilter: 'blur(4px)',
                  }}
                >
                  {allTeams.map(t => (
                    <option key={t.abbreviation} value={t.abbreviation} style={{ background: '#1e293b', color: '#E2E8F0' }}>{t.city} {t.name}</option>
                  ))}
                </select>
              </div>
              <div style={{ color: '#94A3B8', fontSize: 11, fontFamily: "'Oswald', 'Inter', system-ui, sans-serif", letterSpacing: '0.06em', textTransform: 'uppercase' }}>2026 Offseason Simulator</div>
            </div>
            <div className="scenario-manager-wrapper"><ScenarioManager /></div>
          </div>
          <div className="cap-bar-section" style={{ textAlign: 'right' }}>
            <div style={{ color: isOverCap ? '#FF2D55' : '#39FF14', fontSize: 13, fontWeight: 700, textShadow: isOverCap ? '0 0 8px rgba(255,45,85,0.3)' : '0 0 8px rgba(57,255,20,0.2)' }}>
              {isOverCap ? '\u26A0\uFE0F OVER CAP' : `$${capAvailable.toFixed(1)}M available`}
            </div>
            <div className="cap-progress-bar" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 'clamp(80px, 25vw, 200px)',
                height: 7,
                background: 'rgba(0,240,255,0.06)',
                borderRadius: 4,
                overflow: 'hidden',
                boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.4)',
              }}>
                <div style={{
                  width: `${capPct}%`,
                  height: '100%',
                  background: isOverCap
                    ? 'linear-gradient(90deg, #FF2D55, #ff5577)'
                    : capPct > 85
                      ? 'linear-gradient(90deg, #facc15, #fbbf24)'
                      : 'linear-gradient(90deg, #00D4FF, #00A0CC)',
                  borderRadius: 4,
                  transition: 'width 0.3s ease',
                  boxShadow: isOverCap ? '0 0 8px rgba(255,45,85,0.4)' : '0 0 8px rgba(0,240,255,0.3)',
                }} />
              </div>
              <span style={{ color: '#94A3B8', fontSize: 11 }}>{capPct.toFixed(0)}%</span>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Banner */}
      <div className="hero-banner" style={{
        position: 'relative',
        width: '100%',
        maxWidth: 1200,
        margin: '0 auto',
        height: 280,
        overflow: 'hidden',
        borderBottom: '2px solid rgba(0,240,255,0.25)',
        borderRadius: '0 0 12px 12px',
      }}>
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'url(/nfl-hero.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center 25%',
          filter: 'brightness(0.7) saturate(0.9)',
          imageRendering: 'auto',
        }} />
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(180deg, rgba(0,8,20,0.3) 0%, rgba(0,8,20,0.1) 40%, rgba(0,8,20,0.6) 100%)',
        }} />
        <div style={{
          position: 'relative',
          height: '100%',
          maxWidth: 1200,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
          padding: '0 16px 14px',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              fontSize: 'clamp(20px, 4vw, 30px)',
              fontWeight: 900,
              fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: '#fff',
              textShadow: '0 2px 8px rgba(0,0,0,0.9), 0 0 30px rgba(0,240,255,0.3)',
            }}>
              Be The GM
            </div>
            <div style={{
              fontSize: 'clamp(10px, 2vw, 12px)',
              color: 'rgba(148,163,184,0.9)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginTop: 4,
              fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
            }}>
              Manage Any Team &bull; Real Cap Data &bull; Full Mock Draft
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main style={{
        flex: 1,
        padding: '16px 16px 16px 24px',
        maxWidth: 1200,
        margin: '0 auto',
        width: '100%',
        boxSizing: 'border-box',
        position: 'relative',
      }}>
        {/* Robot sentinel - visible on the left side, overlapping content edge */}
        <div className="robot-watermark" style={{
          position: 'fixed',
          top: 60,
          left: 0,
          width: 350,
          height: 'calc(100vh - 120px)',
          backgroundImage: 'url(/robot-hero.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center 20%',
          backgroundRepeat: 'no-repeat',
          opacity: 0.35,
          pointerEvents: 'none',
          filter: 'brightness(1.6) contrast(1.3) saturate(0.3) hue-rotate(200deg)',
          zIndex: 1,
          maskImage: 'linear-gradient(to right, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.4) 50%, transparent 85%)',
          WebkitMaskImage: 'linear-gradient(to right, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.4) 50%, transparent 85%)',
        }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          {children}
        </div>

        {/* Email Capture */}
        <div style={{
          marginTop: 24, display: 'flex', justifyContent: 'center', position: 'relative', zIndex: 1,
          padding: '0 16px',
        }}>
          <div style={{ width: '100%', maxWidth: 600 }}>
            <EmailCapture />
          </div>
        </div>

        {/* Support Banner */}
        <div style={{
          marginTop: 16, display: 'flex', justifyContent: 'center', position: 'relative', zIndex: 1,
          padding: '0 16px',
        }}>
          <a href="https://buymeacoffee.com/ainflgm" target="_blank" rel="noopener noreferrer" style={{
            width: '100%', maxWidth: 600, padding: '14px 20px',
            background: 'linear-gradient(135deg, rgba(251,79,20,0.18), rgba(251,79,20,0.06))',
            border: '1px solid rgba(251,79,20,0.35)', borderRadius: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
            textDecoration: 'none', color: '#E2E8F0', fontSize: 13,
            transition: 'all 0.2s',
            boxShadow: '0 2px 12px rgba(251,79,20,0.08)',
          }}>
            <span style={{ fontSize: 22, lineHeight: 1 }}>&#9749;</span>
            <div>
              <div style={{ fontWeight: 700, fontFamily: "'Oswald', sans-serif", letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: 14, color: '#FB4F14' }}>
                Support AiNFL GM
              </div>
              <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
                Every dollar fuels new features and better data
              </div>
            </div>
          </a>
        </div>

        {/* Ad Slot: Ready for AdSense — replace inner content with ad code when approved */}
        <div id="ad-slot-footer" style={{
          marginTop: 16, display: 'flex', justifyContent: 'center', position: 'relative', zIndex: 1,
          padding: '0 16px',
        }}>
          <div style={{
            width: '100%', maxWidth: 728, minHeight: 90, background: 'rgba(15,23,42,0.5)',
            border: '1px solid rgba(0,240,255,0.08)', borderRadius: 6, display: 'flex',
            alignItems: 'center', justifyContent: 'center', color: '#334155', fontSize: 10,
            overflow: 'hidden',
          }}>
            {/* AdSense code will go here once approved */}
          </div>
        </div>

        {/* Share + Footer */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
          padding: '12px 16px 4px', position: 'relative', zIndex: 1,
        }}>
          <ShareButtons title="AiNFL GM - Free AI-powered NFL offseason simulator. Be the GM of any team!" />
          <div style={{
            display: 'flex', justifyContent: 'center', gap: 16,
            fontSize: 11, color: '#475569',
          }}>
            <a href="/privacy" style={{ color: '#475569', textDecoration: 'none' }}>Privacy Policy</a>
            <span>|</span>
            <a href="https://buymeacoffee.com/ainflgm" target="_blank" rel="noopener noreferrer" style={{ color: '#475569', textDecoration: 'none' }}>Support Us</a>
            <span>|</span>
            <span>ainflgm.com</span>
          </div>
        </div>
      </main>

      {/* Bottom Tab Nav */}
      <nav style={{
        background: 'linear-gradient(135deg, #000814 0%, #0A1628 100%)',
        borderTop: '1px solid rgba(0,240,255,0.3)',
        boxShadow: '0 -1px 20px rgba(0,240,255,0.15), 0 -2px 20px rgba(0,0,0,0.5)',
        position: 'sticky',
        bottom: 0,
        zIndex: 100,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        overflow: 'hidden',
      }}>
        {/* Robot accent - left side of bottom nav (mirrored) */}
        <div className="robot-accent" style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 200,
          backgroundImage: 'url(/robot-small.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center top',
          opacity: 0.5,
          maskImage: 'linear-gradient(to right, black 20%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to right, black 20%, transparent 100%)',
          pointerEvents: 'none',
          zIndex: 0,
          transform: 'scaleX(-1)',
        }} />

        <div style={{
          display: 'flex',
          justifyContent: 'space-around',
          maxWidth: 1200,
          margin: '0 auto',
          position: 'relative',
          zIndex: 1,
        }}>
          {navItems.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) => isActive ? 'nav-active' : 'nav-inactive'}
              style={({ isActive }) => ({
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '8px 4px',
                textDecoration: 'none',
                color: isActive ? accentColor : '#94A3B8',
                fontSize: 10,
                fontWeight: isActive ? 700 : 400,
                fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                minWidth: 52,
                borderTop: isActive ? `2px solid ${accentColor}` : '2px solid transparent',
                marginTop: -2,
                transition: 'color 0.2s ease, text-shadow 0.2s ease',
                textShadow: isActive ? `0 0 10px ${accentColor}44` : 'none',
                position: 'relative',
              })}
            >
              <span style={{
                fontSize: 22,
                lineHeight: 1.2,
                transition: 'filter 0.2s ease',
              }}><NavIcon type={item.iconType} /></span>
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <FloatingMenu />
    </div>
  );
}

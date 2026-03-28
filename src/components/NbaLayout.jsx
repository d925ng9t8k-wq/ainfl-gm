import React from 'react';
import { NavLink, Link } from 'react-router-dom';
import { useNbaGame } from '../context/NbaGameContext';
import NbaScenarioManager from './NbaScenarioManager';

const navItems = [
  { path: '/nba', label: 'Roster', iconType: 'roster' },
  { path: '/nba/cap', label: 'Cap', iconType: 'cap' },
  { path: '/nba/fa', label: 'Free Agency', iconType: 'fa' },
  { path: '/nba/trades', label: 'Trades', iconType: 'trades' },
  { path: '/nba/draft', label: 'Draft', iconType: 'draft' },
  { path: '/nba/season', label: 'Season', iconType: 'season' },
  { path: '/nba/summary', label: 'Summary', iconType: 'summary' },
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
    default: return null;
  }
}

function ensureContrast(hexColor) {
  if (!hexColor) return '#FFFFFF';
  const hex = hexColor.replace('#', '');
  if (hex.length !== 6) return '#FFFFFF';
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (luminance >= 0.35) return hexColor;
  if (luminance >= 0.15) {
    const f = 0.5;
    const lr = Math.round(r + (255 - r) * f);
    const lg = Math.round(g + (255 - g) * f);
    const lb = Math.round(b + (255 - b) * f);
    return `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`;
  }
  return '#FFFFFF';
}

export default function NbaLayout({ children }) {
  const {
    capAvailable, totalCap, capUsed, overLuxuryTax, overFirstApron,
    allTeams, currentTeamAbbr, selectedTeamColors, selectTeam,
    luxuryTax, firstApron,
  } = useNbaGame();

  const currentTeamObj = allTeams.find(t => t.abbreviation === currentTeamAbbr) || allTeams[0];
  const teamLabel = `${currentTeamObj.city} ${currentTeamObj.name}`;

  const primaryColor = selectedTeamColors?.primaryColor || '#1D428A';
  const secondaryColor = selectedTeamColors?.secondaryColor || '#FFC72C';
  const rawAccent = primaryColor === '#000000' ? (secondaryColor !== '#000000' ? secondaryColor : '#1D428A') : primaryColor;
  const accentColor = ensureContrast(rawAccent);

  const capPct = Math.min((capUsed / totalCap) * 100, 100);
  const taxPct = Math.min((capUsed / luxuryTax) * 100, 100);
  const isOverCap = capAvailable < 0;
  const isOverTax = overLuxuryTax;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>

      {/* Sport Selector Bar */}
      <div style={{
        background: '#0a0a0a',
        borderBottom: '1px solid rgba(251,79,20,0.2)',
        padding: '6px 16px',
        position: 'sticky',
        top: 0,
        zIndex: 101,
        display: 'flex',
        justifyContent: 'center',
        gap: 4,
      }}>
        {[
          { label: 'NFL', to: '/', active: false },
          { label: 'NBA', to: '/nba', active: true },
          { label: 'MLB', to: '/mlb', active: false },
        ].map(s => (
          <Link key={s.label} to={s.to} style={{
            padding: '4px 16px',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 800,
            fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            textDecoration: 'none',
            background: s.active ? '#FB4F14' : 'transparent',
            color: s.active ? '#fff' : 'rgba(251,79,20,0.5)',
            border: s.active ? '1px solid #FB4F14' : '1px solid rgba(251,79,20,0.2)',
            transition: 'all 0.15s ease',
          }}>{s.label}</Link>
        ))}
      </div>

      {/* Top Nav */}
      <header style={{
        background: 'linear-gradient(135deg, #0a0a0a 0%, #111111 50%, #0a0a0a 100%)',
        borderBottom: '1px solid rgba(251,79,20,0.3)',
        boxShadow: '0 1px 20px rgba(251,79,20,0.12), 0 2px 20px rgba(0,0,0,0.5)',
        padding: '0 16px',
        position: 'sticky',
        top: 33,
        zIndex: 100,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}>
        <div style={{
          maxWidth: 1200,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          minHeight: 60,
          padding: '4px 0',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Branding */}
            <div style={{ marginRight: 4 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 0, lineHeight: 1.1 }}>
                <span style={{
                  fontWeight: 900, fontSize: 20,
                  fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
                  letterSpacing: '0.04em',
                  background: 'linear-gradient(135deg, #FB4F14 0%, #FF8C5A 40%, #E2E8F0 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                  filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6)) drop-shadow(0 0 12px rgba(251,79,20,0.5))',
                }}>AiNBA</span>
                <span style={{
                  fontWeight: 900, fontSize: 20,
                  fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
                  letterSpacing: '0.04em', textTransform: 'uppercase',
                  color: accentColor, marginLeft: 3,
                  textShadow: `0 1px 2px rgba(0,0,0,0.5), 0 0 18px ${accentColor}66`,
                }}>GM</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 1 }}>
                <span style={{ color: 'rgba(251,79,20,0.6)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: "'Oswald', 'Inter', system-ui, sans-serif" }}>AI-Powered</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#39FF14', boxShadow: '0 0 8px rgba(57,255,20,0.5)', animation: 'neonPulse 2s ease-in-out infinite' }} />
                  <span style={{ color: 'rgba(57,255,20,0.6)', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase' }}>ONLINE</span>
                </div>
              </div>
            </div>

            <div style={{ width: 1, height: 36, marginRight: 2, background: 'linear-gradient(180deg, transparent 0%, rgba(251,79,20,0.4) 20%, rgba(251,79,20,0.2) 80%, transparent 100%)', borderRadius: 1 }} />

            {/* Basketball icon */}
            <div style={{
              width: 38, height: 38, borderRadius: '50%',
              background: 'radial-gradient(circle at 35% 35%, #E87722, #C45A00)',
              border: `2px solid ${accentColor}88`,
              boxShadow: `0 0 12px ${accentColor}44`,
              flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 20,
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.7)" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2C12 2 8 7 8 12s4 10 4 10" />
                <path d="M12 2C12 2 16 7 16 12s-4 10-4 10" />
                <path d="M2 12h20" />
                <path d="M3.5 7C5.5 8.5 8.5 9 12 9s6.5-.5 8.5-2" />
                <path d="M3.5 17C5.5 15.5 8.5 15 12 15s6.5.5 8.5 2" />
              </svg>
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <select
                  value={currentTeamAbbr}
                  onChange={e => selectTeam(e.target.value)}
                  style={{
                    background: 'rgba(26,26,26,0.9)', color: accentColor,
                    border: '1px solid rgba(251,79,20,0.15)', borderRadius: 6,
                    padding: '2px 6px', fontWeight: 800, fontSize: 14,
                    cursor: 'pointer', lineHeight: 1.2, maxWidth: 180,
                    backdropFilter: 'blur(4px)',
                  }}
                >
                  {allTeams.map(t => (
                    <option key={t.abbreviation} value={t.abbreviation} style={{ background: '#1e293b', color: '#E2E8F0' }}>
                      {t.city} {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ color: '#94A3B8', fontSize: 11, fontFamily: "'Oswald', 'Inter', system-ui, sans-serif", letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                2025-26 GM Simulator
              </div>
            </div>
            <div className="scenario-manager-wrapper"><NbaScenarioManager /></div>
          </div>

          {/* Cap status */}
          <div className="cap-bar-section" style={{ textAlign: 'right' }}>
            <div style={{
              color: isOverTax ? '#FF6B00' : isOverCap ? '#FF2D55' : '#39FF14',
              fontSize: 13, fontWeight: 700,
              textShadow: isOverTax ? '0 0 8px rgba(255,107,0,0.3)' : '0 0 8px rgba(57,255,20,0.2)',
            }}>
              {isOverTax ? 'OVER LUX TAX' : isOverCap ? 'OVER CAP' : `$${capAvailable.toFixed(1)}M cap space`}
            </div>
            <div className="cap-progress-bar" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 'clamp(80px, 25vw, 200px)', height: 7,
                background: 'rgba(251,79,20,0.08)', borderRadius: 4, overflow: 'hidden',
                boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.4)',
              }}>
                <div style={{
                  width: `${taxPct}%`, height: '100%',
                  background: isOverTax
                    ? 'linear-gradient(90deg, #FF6B00, #FF9500)'
                    : taxPct > 85
                      ? 'linear-gradient(90deg, #facc15, #fbbf24)'
                      : 'linear-gradient(90deg, #FB4F14, #FF7A45)',
                  borderRadius: 4, transition: 'width 0.3s ease',
                  boxShadow: '0 0 8px rgba(251,79,20,0.3)',
                }} />
              </div>
              <span style={{ color: '#94A3B8', fontSize: 11 }}>{taxPct.toFixed(0)}%</span>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Banner */}
      <div className="hero-banner" style={{
        position: 'relative', width: '100%', maxWidth: 1200, margin: '0 auto',
        height: 200, overflow: 'hidden',
        borderBottom: '2px solid rgba(251,79,20,0.25)',
        borderRadius: '0 0 12px 12px',
        background: 'linear-gradient(135deg, #0a0a0a 0%, #1a0800 50%, #0a0a0a 100%)',
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse at 30% 50%, rgba(251,79,20,0.18) 0%, transparent 70%)',
        }} />
        <div style={{
          position: 'relative', height: '100%', maxWidth: 1200, margin: '0 auto',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              fontSize: 'clamp(20px, 4vw, 32px)', fontWeight: 900,
              fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
              letterSpacing: '0.14em', textTransform: 'uppercase', color: '#fff',
              textShadow: '0 2px 8px rgba(0,0,0,0.9), 0 0 30px rgba(251,79,20,0.3)',
            }}>
              Be The GM
            </div>
            <div style={{
              fontSize: 'clamp(10px, 2vw, 13px)', color: 'rgba(148,163,184,0.9)',
              letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 8,
              fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
            }}>
              All 30 NBA Teams &bull; 2025-26 Real Salary Data &bull; Free Draft Simulator
            </div>
            <div style={{
              display: 'flex', gap: 16, justifyContent: 'center', marginTop: 10, flexWrap: 'wrap',
            }}>
              <div style={{ fontSize: 11, color: '#FB4F14', background: 'rgba(251,79,20,0.1)', border: '1px solid rgba(251,79,20,0.25)', borderRadius: 4, padding: '3px 8px' }}>
                Salary Cap: $154.6M
              </div>
              <div style={{ fontSize: 11, color: '#FF7A45', background: 'rgba(255,122,69,0.1)', border: '1px solid rgba(255,122,69,0.25)', borderRadius: 4, padding: '3px 8px' }}>
                Luxury Tax: $187.9M
              </div>
              <div style={{ fontSize: 11, color: '#FFB07A', background: 'rgba(255,176,122,0.08)', border: '1px solid rgba(255,176,122,0.2)', borderRadius: 4, padding: '3px 8px' }}>
                First Apron: $195.9M
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main style={{
        flex: 1, padding: '16px', maxWidth: 1200, margin: '0 auto',
        width: '100%', boxSizing: 'border-box', position: 'relative',
      }}>
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
          {/* Ad sidebar */}
          <aside id="ad-slot-sidebar" className="ad-sidebar" style={{
            width: 160, flexShrink: 0, position: 'sticky', top: 80, alignSelf: 'flex-start',
          }}>
            <div style={{
              width: 160, minHeight: 600,
              background: 'rgba(15,15,15,0.5)', border: '1px solid rgba(251,79,20,0.08)',
              borderRadius: 6, overflow: 'hidden',
            }}>
              <ins className="adsbygoogle" style={{ display: 'block' }}
                data-ad-client="ca-pub-4928127931521131" data-ad-slot="auto"
                data-ad-format="vertical" data-full-width-responsive="false" />
            </div>
          </aside>
        </div>

        {/* Footer ad + share */}
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center', position: 'relative', zIndex: 1, padding: '0 16px' }}>
          <div style={{ width: '100%', maxWidth: 728, minHeight: 90, background: 'rgba(15,15,15,0.5)', border: '1px solid rgba(251,79,20,0.08)', borderRadius: 6, overflow: 'hidden' }}>
            <ins className="adsbygoogle" style={{ display: 'block' }}
              data-ad-client="ca-pub-4928127931521131" data-ad-slot="auto"
              data-ad-format="auto" data-full-width-responsive="true" />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '12px 16px 4px', position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 16, fontSize: 11, color: '#475569' }}>
            <a href="/nba/about" style={{ color: '#475569', textDecoration: 'none' }}>About</a>
            <span>|</span>
            <a href="/privacy" style={{ color: '#475569', textDecoration: 'none' }}>Privacy</a>
            <span>|</span>
            <a href="/" style={{ color: '#475569', textDecoration: 'none' }}>AiNFL GM</a>
          </div>
          <div style={{ maxWidth: 600, textAlign: 'center', fontSize: 10, color: '#334155', lineHeight: 1.5, marginTop: 8, padding: '0 8px' }}>
            This site may contain affiliate links. If you sign up for a service through our links, we may earn a commission at no extra cost to you.
          </div>
        </div>
      </main>

      {/* Bottom Tab Nav */}
      <nav style={{
        background: 'linear-gradient(135deg, #0a0a0a 0%, #111111 100%)',
        borderTop: '1px solid rgba(251,79,20,0.3)',
        boxShadow: '0 -1px 20px rgba(251,79,20,0.12), 0 -2px 20px rgba(0,0,0,0.5)',
        position: 'sticky', bottom: 0, zIndex: 100,
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-around', maxWidth: 1200, margin: '0 auto' }}>
          {navItems.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/nba'}
              className={({ isActive }) => isActive ? 'nav-active' : 'nav-inactive'}
              style={({ isActive }) => ({
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                padding: '8px 4px', textDecoration: 'none',
                color: isActive ? accentColor : '#94A3B8',
                fontSize: 10, fontWeight: isActive ? 700 : 400,
                fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
                letterSpacing: '0.04em', textTransform: 'uppercase', minWidth: 48,
                borderTop: isActive ? `2px solid ${accentColor}` : '2px solid transparent',
                marginTop: -2, transition: 'color 0.2s ease',
                textShadow: isActive ? `0 0 10px ${accentColor}44` : 'none',
              })}
            >
              <span style={{ fontSize: 22, lineHeight: 1.2 }}><NavIcon type={item.iconType} /></span>
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

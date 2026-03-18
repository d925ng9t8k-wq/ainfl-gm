import React from 'react';
import { NavLink } from 'react-router-dom';
import { useGame } from '../context/GameContext';
import AiSuggest from './AiSuggest';
import ScenarioManager from './ScenarioManager';

const navItems = [
  { path: '/', label: 'Roster', iconType: 'roster' },
  { path: '/cap', label: 'Cap', iconType: 'cap' },
  { path: '/fa', label: 'Free Agency', iconType: 'fa' },
  { path: '/trades', label: 'Trades', iconType: 'trades' },
  { path: '/draft', label: 'Draft', iconType: 'draft' },
  { path: '/summary', label: 'Summary', iconType: 'summary' },
  { path: '/season', label: 'Season', iconType: 'season' },
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
    default:
      return null;
  }
}

function FeedbackWidget() {
  const [isOpen, setIsOpen] = React.useState(false);
  const [feedbackType, setFeedbackType] = React.useState('feature');
  const [message, setMessage] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [submitted, setSubmitted] = React.useState(false);
  const [sending, setSending] = React.useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    const body = [
      `Type: ${feedbackType}`,
      `Message: ${message}`,
      email ? `Email: ${email}` : 'Email: (anonymous)',
      `Page: ${window.location.pathname}`,
      `Device: ${/Mobile|iPhone|Android/.test(navigator.userAgent) ? 'Mobile' : 'Desktop'}`,
      `Time: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`,
    ].join('\n');
    fetch('https://ntfy.sh/ainfl-gm-visitors-jf2026', {
      method: 'POST',
      headers: { 'Title': `AiNFL GM Feedback: ${feedbackType}`, 'Priority': '4', 'Tags': 'memo', 'Email': 'emailfishback@gmail.com' },
      body: body,
    }).then(() => {
      setSubmitted(true);
      setSending(false);
      setTimeout(() => { setSubmitted(false); setIsOpen(false); setMessage(''); setEmail(''); }, 3000);
    }).catch(() => setSending(false));
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        style={{
          position: 'fixed',
          bottom: 70,
          right: 12,
          zIndex: 999,
          background: 'linear-gradient(135deg, #00D4FF, #00A0CC)',
          color: '#000',
          border: 'none',
          borderRadius: 24,
          padding: '8px 14px',
          cursor: 'pointer',
          fontWeight: 700,
          fontSize: 12,
          fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          boxShadow: '0 2px 16px rgba(0,240,255,0.3)',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        <span style={{ fontSize: 16 }}>💬</span> Feedback
      </button>
    );
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: 70,
      right: 12,
      zIndex: 999,
      width: 300,
      maxWidth: 'calc(100vw - 24px)',
      background: 'rgba(10, 22, 40, 0.97)',
      border: '1px solid rgba(0,240,255,0.25)',
      borderRadius: 14,
      boxShadow: '0 4px 30px rgba(0,0,0,0.6), 0 0 20px rgba(0,240,255,0.1)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      overflow: 'hidden',
    }}>
      <div style={{
        background: 'linear-gradient(135deg, rgba(0,240,255,0.12), rgba(195,0,255,0.08))',
        padding: '12px 14px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <div style={{ color: '#00F0FF', fontWeight: 700, fontSize: 13, fontFamily: "'Oswald', 'Inter', system-ui, sans-serif", letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Help Us Improve
          </div>
          <div style={{ color: '#94A3B8', fontSize: 10, marginTop: 1 }}>Built for the community, by the community</div>
        </div>
        <button onClick={() => setIsOpen(false)} style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: 18, cursor: 'pointer', padding: 4 }}>✕</button>
      </div>

      {submitted ? (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🙏</div>
          <div style={{ color: '#39FF14', fontWeight: 700, fontSize: 14 }}>Thank you!</div>
          <div style={{ color: '#94A3B8', fontSize: 12, marginTop: 4 }}>Your feedback helps shape AiNFL GM</div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ padding: 14 }}>
          <div style={{ marginBottom: 10 }}>
            <div style={{ color: '#94A3B8', fontSize: 11, marginBottom: 4 }}>What type of feedback?</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {[
                { value: 'feature', label: '💡 Feature' },
                { value: 'bug', label: '🐛 Bug' },
                { value: 'data', label: '📊 Data Fix' },
                { value: 'other', label: '💬 Other' },
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFeedbackType(opt.value)}
                  style={{
                    background: feedbackType === opt.value ? 'rgba(0,240,255,0.2)' : 'rgba(30,41,59,0.6)',
                    color: feedbackType === opt.value ? '#00F0FF' : '#94A3B8',
                    border: feedbackType === opt.value ? '1px solid rgba(0,240,255,0.4)' : '1px solid rgba(0,240,255,0.1)',
                    borderRadius: 6,
                    padding: '5px 8px',
                    fontSize: 11,
                    cursor: 'pointer',
                    flex: 1,
                    minHeight: 32,
                  }}
                >{opt.label}</button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Tell us what you'd like to see improved, report a bug, or suggest a feature..."
              rows={4}
              style={{
                width: '100%',
                background: 'rgba(30,41,59,0.6)',
                color: '#E2E8F0',
                border: '1px solid rgba(0,240,255,0.15)',
                borderRadius: 8,
                padding: 10,
                fontSize: 13,
                resize: 'vertical',
                fontFamily: "'Inter', system-ui, sans-serif",
                outline: 'none',
              }}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Email (optional — for follow-up)"
              style={{
                width: '100%',
                background: 'rgba(30,41,59,0.6)',
                color: '#E2E8F0',
                border: '1px solid rgba(0,240,255,0.15)',
                borderRadius: 8,
                padding: '8px 10px',
                fontSize: 12,
                fontFamily: "'Inter', system-ui, sans-serif",
                outline: 'none',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={!message.trim() || sending}
            style={{
              width: '100%',
              background: message.trim() ? 'linear-gradient(135deg, #00D4FF, #00A0CC)' : 'rgba(30,41,59,0.6)',
              color: message.trim() ? '#000' : '#64748b',
              border: 'none',
              borderRadius: 8,
              padding: '10px 0',
              fontWeight: 700,
              fontSize: 13,
              fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              cursor: message.trim() ? 'pointer' : 'not-allowed',
              boxShadow: message.trim() ? '0 2px 12px rgba(0,240,255,0.3)' : 'none',
            }}
          >
            {sending ? 'Sending...' : 'Submit Feedback'}
          </button>

          <div style={{ textAlign: 'center', marginTop: 8 }}>
            <a
              href="https://github.com/d925ng9t8k-wq/ainfl-gm/issues"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#64748b', fontSize: 10, textDecoration: 'none' }}
            >
              Or submit detailed requests on GitHub →
            </a>
          </div>
        </form>
      )}
    </div>
  );
}

export default function Layout({ children }) {
  const { capUsed, totalCap, capAvailable, allTeams, currentTeamAbbr, selectedTeamColors, selectTeam } = useGame();
  const capPct = Math.min((capUsed / totalCap) * 100, 100);
  const isOverCap = capUsed > totalCap;

  const currentTeamObj = allTeams.find(t => t.abbreviation === currentTeamAbbr) || allTeams[0];
  const teamLabel = `${currentTeamObj.city} ${currentTeamObj.name}`;
  const primaryColor = selectedTeamColors?.primaryColor || '#FB4F14';
  const secondaryColor = selectedTeamColors?.secondaryColor || '#000000';

  // Use team's primary color as accent, falling back for very dark colors
  const accentColor = primaryColor === '#000000' ? (secondaryColor !== '#000000' ? secondaryColor : '#FB4F14') : primaryColor;

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
        overflow: 'hidden',
      }}>
        {/* Robot accent - right side of header */}
        <div className="robot-accent" style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: 200,
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
                    background: 'rgba(30,41,59,0.6)',
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
                    <option key={t.abbreviation} value={t.abbreviation}>{t.city} {t.name}</option>
                  ))}
                </select>
              </div>
              <div style={{ color: '#94A3B8', fontSize: 11, fontFamily: "'Oswald', 'Inter', system-ui, sans-serif", letterSpacing: '0.06em', textTransform: 'uppercase' }}>2026 Offseason Simulator</div>
            </div>
            <ScenarioManager />
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: isOverCap ? '#FF2D55' : '#39FF14', fontSize: 13, fontWeight: 700, textShadow: isOverCap ? '0 0 8px rgba(255,45,85,0.3)' : '0 0 8px rgba(57,255,20,0.2)' }}>
              {isOverCap ? '\u26A0\uFE0F OVER CAP' : `$${capAvailable.toFixed(1)}M available`}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 200,
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

      {/* Main Content */}
      <main style={{
        flex: 1,
        padding: '16px',
        paddingLeft: '24px',
        maxWidth: 1200,
        margin: '0 auto',
        width: '100%',
        boxSizing: 'border-box',
        position: 'relative',
        borderLeft: '1px solid rgba(0,240,255,0.08)',
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

      <AiSuggest />
      <FeedbackWidget />
    </div>
  );
}

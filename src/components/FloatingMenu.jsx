import React, { useState, useRef, useEffect } from 'react';
import AiSuggest from './AiSuggest';

function FeedbackPanel({ onClose }) {
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
      headers: { 'Title': `AiNFL GM Feedback: ${feedbackType}`, 'Priority': '4', 'Tags': 'memo', 'Email': 'captain@ainflgm.com' },
      body: body,
    }).then(() => {
      setSubmitted(true);
      setSending(false);
      setTimeout(() => { setSubmitted(false); onClose(); setMessage(''); setEmail(''); }, 3000);
    }).catch(() => setSending(false));
  }

  return (
    <div style={{
      position: 'absolute',
      bottom: 52,
      right: 0,
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
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: 18, cursor: 'pointer', padding: 4 }}>{'\u2715'}</button>
      </div>

      {submitted ? (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>{'\uD83D\uDE4F'}</div>
          <div style={{ color: '#39FF14', fontWeight: 700, fontSize: 14 }}>Thank you!</div>
          <div style={{ color: '#94A3B8', fontSize: 12, marginTop: 4 }}>Your feedback helps shape AiNFL GM</div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ padding: 14 }}>
          <div style={{ marginBottom: 10 }}>
            <div style={{ color: '#94A3B8', fontSize: 11, marginBottom: 4 }}>What type of feedback?</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {[
                { value: 'feature', label: 'Feature' },
                { value: 'bug', label: 'Bug' },
                { value: 'data', label: 'Data Fix' },
                { value: 'other', label: 'Other' },
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
                    padding: '6px 8px',
                    fontSize: 11,
                    cursor: 'pointer',
                    flex: 1,
                    minHeight: 36,
                  }}
                >{opt.label}</button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Tell us what you'd like to see improved..."
              rows={3}
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
              placeholder="Email (optional)"
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
            }}
          >
            {sending ? 'Sending...' : 'Submit Feedback'}
          </button>
        </form>
      )}
    </div>
  );
}

export default function FloatingMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activePanel, setActivePanel] = useState(null); // 'ai' | 'feedback' | null
  const menuRef = useRef(null);

  // Close everything on outside click
  useEffect(() => {
    if (!menuOpen && !activePanel) return;
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
        setActivePanel(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen, activePanel]);

  return (
    <div ref={menuRef} style={{ position: 'fixed', bottom: 64, right: 12, zIndex: 998 }}>

      {/* Expanded menu options */}
      {menuOpen && !activePanel && (
        <div style={{
          position: 'absolute',
          bottom: 52,
          right: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          alignItems: 'flex-end',
        }}>
          <button
            onClick={() => { setActivePanel('ai'); setMenuOpen(false); }}
            style={{
              background: 'rgba(10,22,40,0.95)',
              border: '1px solid rgba(0,240,255,0.25)',
              borderRadius: 10,
              padding: '10px 14px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: '#00F0FF',
              fontSize: 12,
              fontWeight: 700,
              fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 16px rgba(0,0,0,0.4)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
          >
            <span style={{ fontSize: 15 }}>{'\uD83E\uDD16'}</span> AI Suggest
          </button>

          <button
            onClick={() => { setActivePanel('feedback'); setMenuOpen(false); }}
            style={{
              background: 'rgba(10,22,40,0.95)',
              border: '1px solid rgba(0,240,255,0.25)',
              borderRadius: 10,
              padding: '10px 14px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: '#94A3B8',
              fontSize: 12,
              fontWeight: 700,
              fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 16px rgba(0,0,0,0.4)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
          >
            <span style={{ fontSize: 15 }}>{'\uD83D\uDCAC'}</span> Feedback
          </button>

          <a
            href="https://buymeacoffee.com/ainflgm"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMenuOpen(false)}
            style={{
              background: 'rgba(10,22,40,0.95)',
              border: '1px solid rgba(251,79,20,0.3)',
              borderRadius: 10,
              padding: '10px 14px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: '#FB4F14',
              fontSize: 12,
              fontWeight: 700,
              fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 16px rgba(0,0,0,0.4)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
          >
            <span style={{ fontSize: 15 }}>{'\u2615'}</span> Support
          </a>
        </div>
      )}

      {/* AI Suggest panel */}
      {activePanel === 'ai' && (
        <AiSuggest embedded onClose={() => setActivePanel(null)} />
      )}

      {/* Feedback panel */}
      {activePanel === 'feedback' && (
        <FeedbackPanel onClose={() => setActivePanel(null)} />
      )}

      {/* FAB button — hidden when a panel is open */}
      {!activePanel && (
        <button
          onClick={() => setMenuOpen(prev => !prev)}
          aria-label="Menu"
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: menuOpen
              ? 'linear-gradient(135deg, #FF2D55, #CC1144)'
              : 'linear-gradient(135deg, #00F0FF, #00A0CC)',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: menuOpen
              ? '0 2px 16px rgba(255,45,85,0.4)'
              : '0 2px 16px rgba(0,240,255,0.35)',
            transition: 'transform 0.2s ease, background 0.2s ease, box-shadow 0.2s ease',
            transform: menuOpen ? 'rotate(45deg)' : 'rotate(0deg)',
          }}
        >
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth={2.5} strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      )}
    </div>
  );
}

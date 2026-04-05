import React, { useState } from 'react';

export default function EmailCapture() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle'); // idle | sending | success | error

  function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim() || !email.includes('@')) return;
    setStatus('sending');

    // Send to ntfy.sh for notification, same pattern as feedback
    const body = [
      `New email signup: ${email}`,
      `Page: ${window.location.pathname}`,
      `Device: ${/Mobile|iPhone|Android/.test(navigator.userAgent) ? 'Mobile' : 'Desktop'}`,
      `Time: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`,
    ].join('\n');

    fetch('https://ntfy.sh/ainfl-gm-visitors-jf2026', {
      method: 'POST',
      headers: {
        'Title': 'AiNFL GM - Email Signup',
        'Priority': '4',
        'Tags': 'email,football',
        'Email': 'captain@ainflgm.com',
      },
      body: body,
    })
      .then(() => {
        setStatus('success');
        setEmail('');
        // Also store locally as backup
        try {
          const existing = JSON.parse(localStorage.getItem('ainfl_emails') || '[]');
          existing.push({ email: email.trim(), date: new Date().toISOString() });
          localStorage.setItem('ainfl_emails', JSON.stringify(existing));
        } catch (_) {}
      })
      .catch(() => setStatus('error'));
  }

  if (status === 'success') {
    return (
      <div style={{
        background: 'linear-gradient(135deg, rgba(57,255,20,0.08), rgba(57,255,20,0.02))',
        border: '1px solid rgba(57,255,20,0.2)',
        borderRadius: 10,
        padding: '14px 18px',
        textAlign: 'center',
      }}>
        <div style={{ color: '#39FF14', fontWeight: 700, fontSize: 14, fontFamily: "'Oswald', sans-serif" }}>You're in!</div>
        <div style={{ color: '#94A3B8', fontSize: 12, marginTop: 4 }}>NFL Draft coverage drops April 23. You're on the list.</div>
      </div>
    );
  }

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(0,240,255,0.06), rgba(0,240,255,0.02))',
      border: '1px solid rgba(0,240,255,0.15)',
      borderRadius: 10,
      padding: '14px 18px',
    }}>
      <div style={{
        color: '#00F0FF',
        fontWeight: 700,
        fontSize: 13,
        fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        marginBottom: 4,
      }}>
        NFL Draft Starts April 23 — Get the Analysis
      </div>
      <div style={{ color: '#94A3B8', fontSize: 12, marginBottom: 10 }}>
        Round-by-round breakdowns, cap impact, and grade every pick as it happens.
      </div>
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8 }}>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="your@email.com"
          required
          style={{
            flex: 1,
            background: 'rgba(30,41,59,0.7)',
            color: '#E2E8F0',
            border: '1px solid rgba(0,240,255,0.15)',
            borderRadius: 8,
            padding: '9px 12px',
            fontSize: 13,
            fontFamily: "'Inter', system-ui, sans-serif",
            outline: 'none',
            minWidth: 0,
          }}
        />
        <button
          type="submit"
          disabled={status === 'sending'}
          style={{
            background: 'linear-gradient(135deg, #00D4FF, #00A0CC)',
            color: '#000',
            border: 'none',
            borderRadius: 8,
            padding: '9px 16px',
            fontWeight: 700,
            fontSize: 12,
            fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            cursor: status === 'sending' ? 'wait' : 'pointer',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {status === 'sending' ? '...' : 'Subscribe'}
        </button>
      </form>
      {status === 'error' && (
        <div style={{ color: '#FF2D55', fontSize: 11, marginTop: 6 }}>Something went wrong. Try again.</div>
      )}
    </div>
  );
}

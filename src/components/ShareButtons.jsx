import React, { useState } from 'react';

function ShareIcon({ type }) {
  const props = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'currentColor' };
  switch (type) {
    case 'x':
      return (
        <svg {...props}>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
      );
    case 'reddit':
      return (
        <svg {...props}>
          <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/>
        </svg>
      );
    case 'copy':
      return (
        <svg {...props} fill="none" stroke="currentColor" strokeWidth={2}>
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      );
    default:
      return null;
  }
}

export default function ShareButtons({ title, compact = false }) {
  const [copied, setCopied] = useState(false);
  const url = window.location.href;
  const text = title || 'Check out AiNFL GM - free AI-powered NFL offseason simulator';

  const shareToX = () => {
    window.open(
      `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
      '_blank',
      'width=550,height=420'
    );
  };

  const shareToReddit = () => {
    window.open(
      `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(text)}`,
      '_blank'
    );
  };

  const copyLink = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const btnStyle = {
    background: 'rgba(30,41,59,0.7)',
    border: '1px solid rgba(0,240,255,0.12)',
    borderRadius: 6,
    padding: compact ? '5px 8px' : '6px 10px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    color: '#94A3B8',
    fontSize: 11,
    fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
    letterSpacing: '0.03em',
    textTransform: 'uppercase',
    transition: 'all 0.2s',
  };

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {!compact && (
        <span style={{ color: '#475569', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: "'Oswald', sans-serif" }}>
          Share
        </span>
      )}
      <button onClick={shareToX} style={btnStyle} title="Share on X">
        <ShareIcon type="x" />
        {!compact && <span>X</span>}
      </button>
      <button onClick={shareToReddit} style={btnStyle} title="Share on Reddit">
        <ShareIcon type="reddit" />
        {!compact && <span>Reddit</span>}
      </button>
      <button onClick={copyLink} style={{ ...btnStyle, color: copied ? '#39FF14' : '#94A3B8', borderColor: copied ? 'rgba(57,255,20,0.3)' : 'rgba(0,240,255,0.12)' }} title="Copy link">
        <ShareIcon type="copy" />
        <span>{copied ? 'Copied!' : compact ? '' : 'Link'}</span>
      </button>
    </div>
  );
}

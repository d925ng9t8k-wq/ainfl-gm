/**
 * AffiliateBanner — AiNFLGM affiliate partner CTA
 *
 * Usage:
 *   <AffiliateBanner partner="fanduel" placement="draft-page" />
 *   <AffiliateBanner partner="betmgm" placement="footer" />
 *   <AffiliateBanner partner="draftkings" placement="markets" />
 *
 * URL structure uses UTM params for CTR tracking in GA:
 *   ?utm_source=ainflgm&utm_medium=affiliate&utm_campaign={placement}&utm_content={partner}
 *
 * To activate a partner:
 *   1. Complete affiliate signup (see docs/affiliate-applications.md)
 *   2. Replace the AFFILIATE_URLS entry with your real affiliate link
 *   3. Set active: true in src/config/affiliates.js
 *
 * FTC: Disclosure text is always rendered adjacent to the banner (required).
 */

import React, { useCallback } from 'react';

/**
 * Affiliate URLs — replace with real tracking links after signup.
 * Format: base URL only, UTM params are appended automatically.
 *
 * OWNER ACTION REQUIRED: fill in real affiliate URLs after completing signup at:
 *   FanDuel  → affiliates.fanduel.com  (FanDuel Affiliate Program, 730-day cookie, $100-400 CPA)
 *   BetMGM   → betmgm.com/affiliates   (MGM Rewards Affiliate / CJ Affiliate)
 *   DraftKings → draftkings.com/affiliates
 */
const AFFILIATE_URLS = {
  fanduel: {
    baseUrl: 'https://www.fanduel.com/join',
    name: 'FanDuel Sportsbook',
    tagline: 'NFL Draft props + futures — bet $5, get $200 in bonus bets',
    cta: 'Claim Offer',
    accentColor: '#1493FF',
    requiresClickId: false,
  },
  betmgm: {
    baseUrl: 'https://sports.betmgm.com/en/sports',
    name: 'BetMGM',
    tagline: 'NFL Draft props — first bet up to $1,500',
    cta: 'Bet Now',
    accentColor: '#FFB800',
    requiresClickId: false,
  },
  draftkings: {
    baseUrl: 'https://www.draftkings.com/lobby',
    name: 'DraftKings Sportsbook',
    tagline: 'NFL Draft contest — bet $5, get $150 in bonus bets',
    cta: 'Play Now',
    accentColor: '#53D338',
    requiresClickId: false,
  },
};

/**
 * Build a UTM-tracked affiliate URL.
 * GA event: 'affiliate_click' with partner + placement dimensions.
 */
function buildAffiliateUrl(partner, placement) {
  const cfg = AFFILIATE_URLS[partner];
  if (!cfg) return '#';
  const url = new URL(cfg.baseUrl);
  url.searchParams.set('utm_source', 'ainflgm');
  url.searchParams.set('utm_medium', 'affiliate');
  url.searchParams.set('utm_campaign', placement || 'site');
  url.searchParams.set('utm_content', partner);
  return url.toString();
}

/**
 * Fire a GA4 event for affiliate link click.
 * Allows CTR measurement per partner + placement in Google Analytics.
 */
function trackAffiliateClick(partner, placement) {
  try {
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'affiliate_click', {
        event_category: 'monetization',
        event_label: `${partner}_${placement}`,
        partner: partner,
        placement: placement,
      });
    }
  } catch (_) {}
}

export default function AffiliateBanner({ partner = 'fanduel', placement = 'site', compact = false }) {
  const cfg = AFFILIATE_URLS[partner];
  if (!cfg) return null;

  const href = buildAffiliateUrl(partner, placement);

  const handleClick = useCallback(() => {
    trackAffiliateClick(partner, placement);
  }, [partner, placement]);

  if (compact) {
    // Inline text link — use inside body copy near relevant content
    return (
      <span style={{ display: 'inline' }}>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer sponsored"
          onClick={handleClick}
          style={{
            color: cfg.accentColor,
            fontWeight: 700,
            textDecoration: 'underline',
            fontSize: 'inherit',
          }}
        >
          {cfg.name}
        </a>
        <span style={{ fontSize: '0.75em', color: '#475569', marginLeft: 4 }}>(ad)</span>
      </span>
    );
  }

  return (
    <div style={{ width: '100%' }}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer sponsored"
        onClick={handleClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '14px 18px',
          background: `linear-gradient(135deg, rgba(${hexToRgb(cfg.accentColor)},0.10), rgba(${hexToRgb(cfg.accentColor)},0.04))`,
          border: `1px solid rgba(${hexToRgb(cfg.accentColor)},0.25)`,
          borderRadius: 10,
          textDecoration: 'none',
          color: '#E2E8F0',
          cursor: 'pointer',
          transition: 'all 0.2s',
          boxSizing: 'border-box',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = `rgba(${hexToRgb(cfg.accentColor)},0.5)`;
          e.currentTarget.style.background = `linear-gradient(135deg, rgba(${hexToRgb(cfg.accentColor)},0.16), rgba(${hexToRgb(cfg.accentColor)},0.06))`;
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = `rgba(${hexToRgb(cfg.accentColor)},0.25)`;
          e.currentTarget.style.background = `linear-gradient(135deg, rgba(${hexToRgb(cfg.accentColor)},0.10), rgba(${hexToRgb(cfg.accentColor)},0.04))`;
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontWeight: 700,
            fontFamily: "'Oswald', sans-serif",
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            fontSize: 14,
            color: cfg.accentColor,
          }}>
            {cfg.name}
          </div>
          <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>
            {cfg.tagline}
          </div>
        </div>
        <div style={{
          background: cfg.accentColor,
          color: '#000',
          fontWeight: 700,
          fontFamily: "'Oswald', sans-serif",
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          fontSize: 12,
          padding: '8px 14px',
          borderRadius: 6,
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}>
          {cfg.cta}
        </div>
      </a>
      {/* FTC disclosure — required on every affiliate link */}
      <div style={{ fontSize: 10, color: '#334155', marginTop: 4, paddingLeft: 2 }}>
        Paid partner link — we may earn a commission. 21+, gambling problem? Call 1-800-GAMBLER.
      </div>
    </div>
  );
}

/** Hex color to "r,g,b" string for rgba() usage */
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `${r},${g},${b}`;
}

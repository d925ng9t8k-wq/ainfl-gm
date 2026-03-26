/**
 * Affiliate Links Configuration
 *
 * Update these with real affiliate URLs and tracking codes when partnerships are established.
 * Set `active: true` to display the link on the site.
 *
 * FTC DISCLOSURE (required under 16 CFR Part 255):
 * AiNFL GM participates in affiliate programs with sportsbooks and prediction markets.
 * When a user signs up or makes a deposit through a link on this site, we may receive
 * a commission. This comes at no additional cost to the user. All affiliate relationships
 * are disclosed in the site footer and on the /about page as required by the FTC.
 */

/**
 * Standard FTC disclosure text for use anywhere affiliate links appear.
 * Include this near any rendered affiliate link on the UI.
 */
export const FTC_DISCLOSURE = 'Affiliate link — we may earn a commission if you sign up through this link, at no extra cost to you.';

export const SPORTSBOOK_PARTNERS = [
  {
    id: 'draftkings',
    name: 'DraftKings',
    url: '', // Add affiliate URL when ready
    logo: null, // Add logo path when ready
    tagline: 'Play Daily Fantasy',
    category: 'sportsbook',
    active: false,
  },
  {
    id: 'fanduel',
    name: 'FanDuel',
    url: '',
    logo: null,
    tagline: 'Bet on NFL Futures',
    category: 'sportsbook',
    active: false,
  },
  {
    id: 'betmgm',
    name: 'BetMGM',
    url: '',
    logo: null,
    tagline: 'NFL Odds & Lines',
    category: 'sportsbook',
    active: false,
  },
];

export const PREDICTION_MARKET_PARTNERS = [
  {
    id: 'polymarket',
    name: 'Polymarket',
    url: '', // Add affiliate URL when ready
    logo: null,
    tagline: 'Trade NFL prediction markets',
    category: 'prediction',
    active: false,
  },
  {
    id: 'kalshi',
    name: 'Kalshi',
    url: '',
    logo: null,
    tagline: 'Bet on NFL outcomes',
    category: 'prediction',
    active: false,
  },
];

/** Returns only partners that have been activated with real URLs */
export function getActivePartners() {
  return [...SPORTSBOOK_PARTNERS, ...PREDICTION_MARKET_PARTNERS].filter(p => p.active && p.url);
}

/** Returns active sportsbook partners */
export function getActiveSportsbooks() {
  return SPORTSBOOK_PARTNERS.filter(p => p.active && p.url);
}

/** Returns active prediction market partners */
export function getActivePredictionMarkets() {
  return PREDICTION_MARKET_PARTNERS.filter(p => p.active && p.url);
}

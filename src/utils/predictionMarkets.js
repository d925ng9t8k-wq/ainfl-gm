/**
 * Polymarket Prediction Markets Integration
 * Fetches NFL-related prediction market data from Polymarket's public API.
 *
 * API: https://gamma-api.polymarket.com/markets
 * No authentication required for read-only access.
 */

const GAMMA_API = 'https://gamma-api.polymarket.com/markets';
const POLYMARKET_BASE = 'https://polymarket.com'; // TODO: Add referral code when available
const CACHE_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// NFL search terms to find relevant markets
const NFL_SEARCH_TERMS = [
  'NFL', 'Super Bowl', 'AFC', 'NFC',
  'Chiefs', 'Eagles', 'Bengals', 'Cowboys', 'Packers', 'Lions',
  'Bills', '49ers', 'Ravens', 'Dolphins', 'Jets', 'Bears',
  'Rams', 'Chargers', 'Broncos', 'Raiders', 'Steelers', 'Browns',
  'Texans', 'Colts', 'Jaguars', 'Titans', 'Vikings', 'Saints',
  'Falcons', 'Buccaneers', 'Panthers', 'Cardinals', 'Seahawks',
  'Commanders', 'Giants', 'Patriots',
  'Patrick Mahomes', 'Josh Allen', 'Lamar Jackson', 'Joe Burrow',
  'Jalen Hurts', 'Saquon Barkley', 'CeeDee Lamb',
];

// In-memory cache
let cache = {
  data: null,
  timestamp: 0,
};

/**
 * Parse outcomes and prices from Polymarket's string format.
 * outcomes: '["Yes", "No"]'
 * outcomePrices: '["0.65", "0.35"]'
 */
function parseOutcomes(outcomes, outcomePrices) {
  try {
    const names = typeof outcomes === 'string' ? JSON.parse(outcomes) : outcomes;
    const prices = typeof outcomePrices === 'string' ? JSON.parse(outcomePrices) : outcomePrices;
    return names.map((name, i) => ({
      name,
      probability: Math.round(parseFloat(prices[i] || 0) * 100),
    }));
  } catch {
    return [];
  }
}

/**
 * Format volume into a readable string.
 */
function formatVolume(volume) {
  const v = parseFloat(volume) || 0;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

/**
 * Fetch NFL-related markets from Polymarket.
 * Tries multiple search terms and deduplicates results.
 */
async function fetchLiveMarkets() {
  const seenIds = new Set();
  const markets = [];

  // Search with a few high-signal terms to find NFL markets
  const searchTerms = ['NFL', 'Super Bowl', 'AFC championship', 'NFC championship'];

  for (const term of searchTerms) {
    try {
      const params = new URLSearchParams({
        _q: term,
        active: 'true',
        closed: 'false',
        limit: '20',
      });
      const res = await fetch(`${GAMMA_API}?${params}`);
      if (!res.ok) continue;
      const data = await res.json();

      for (const m of data) {
        if (seenIds.has(m.id)) continue;
        // Check if this market is actually NFL-related
        const text = `${m.question} ${m.description || ''}`.toLowerCase();
        const isNfl = NFL_SEARCH_TERMS.some(t => text.includes(t.toLowerCase()));
        if (!isNfl) continue;

        seenIds.add(m.id);
        const outcomes = parseOutcomes(m.outcomes, m.outcomePrices);
        if (outcomes.length === 0) continue;

        markets.push({
          id: m.id,
          question: m.question,
          outcomes,
          volume: formatVolume(m.volume),
          volumeRaw: parseFloat(m.volume) || 0,
          link: `${POLYMARKET_BASE}/event/${m.slug}`,
          endDate: m.endDate,
          image: m.icon || m.image,
        });
      }
    } catch {
      // Silently skip failed searches
    }

    if (markets.length >= 10) break;
  }

  // Sort by volume (most liquid markets first)
  markets.sort((a, b) => b.volumeRaw - a.volumeRaw);
  return markets.slice(0, 8);
}

/**
 * TODO: Replace mock data with live data once Polymarket has active NFL markets.
 * These are realistic sample markets for development/demo purposes.
 * The component will try live data first and fall back to these if none found.
 */
const MOCK_NFL_MARKETS = [
  {
    id: 'mock-1',
    question: 'Who will win Super Bowl LXI?',
    outcomes: [
      { name: 'Kansas City Chiefs', probability: 18 },
      { name: 'Detroit Lions', probability: 12 },
      { name: 'Philadelphia Eagles', probability: 11 },
      { name: 'Buffalo Bills', probability: 9 },
      { name: 'Baltimore Ravens', probability: 8 },
    ],
    volume: '$4.2M',
    volumeRaw: 4200000,
    link: `${POLYMARKET_BASE}`,
    endDate: '2027-02-15T00:00:00Z',
    image: null,
  },
  {
    id: 'mock-2',
    question: 'NFL MVP 2026-27 Season?',
    outcomes: [
      { name: 'Patrick Mahomes', probability: 22 },
      { name: 'Josh Allen', probability: 18 },
      { name: 'Lamar Jackson', probability: 15 },
      { name: 'Joe Burrow', probability: 12 },
    ],
    volume: '$1.8M',
    volumeRaw: 1800000,
    link: `${POLYMARKET_BASE}`,
    endDate: '2027-02-10T00:00:00Z',
    image: null,
  },
  {
    id: 'mock-3',
    question: 'Will the Cincinnati Bengals make the playoffs in 2026?',
    outcomes: [
      { name: 'Yes', probability: 58 },
      { name: 'No', probability: 42 },
    ],
    volume: '$890K',
    volumeRaw: 890000,
    link: `${POLYMARKET_BASE}`,
    endDate: '2027-01-15T00:00:00Z',
    image: null,
  },
  {
    id: 'mock-4',
    question: 'Saquon Barkley rushing yards 2026 season over 1,400.5?',
    outcomes: [
      { name: 'Over', probability: 45 },
      { name: 'Under', probability: 55 },
    ],
    volume: '$520K',
    volumeRaw: 520000,
    link: `${POLYMARKET_BASE}`,
    endDate: '2027-01-12T00:00:00Z',
    image: null,
  },
  {
    id: 'mock-5',
    question: 'Which team will draft first overall in 2027 NFL Draft?',
    outcomes: [
      { name: 'Cleveland Browns', probability: 14 },
      { name: 'New York Giants', probability: 12 },
      { name: 'Carolina Panthers', probability: 11 },
      { name: 'New England Patriots', probability: 10 },
    ],
    volume: '$340K',
    volumeRaw: 340000,
    link: `${POLYMARKET_BASE}`,
    endDate: '2027-04-25T00:00:00Z',
    image: null,
  },
];

/**
 * Main export: Get NFL prediction markets.
 * Uses 15-minute cache. Falls back to mock data if no live NFL markets found.
 * Returns empty array silently on errors (never breaks the app).
 */
export async function getNFLMarkets() {
  try {
    const now = Date.now();

    // Return cached data if still fresh
    if (cache.data && (now - cache.timestamp) < CACHE_DURATION_MS) {
      return cache.data;
    }

    // Try live data
    const liveMarkets = await fetchLiveMarkets();

    if (liveMarkets.length > 0) {
      cache.data = { markets: liveMarkets, isLive: true };
      cache.timestamp = now;
      return cache.data;
    }

    // Fall back to mock data
    // TODO: Remove mock fallback once Polymarket consistently has NFL markets
    cache.data = { markets: MOCK_NFL_MARKETS, isLive: false };
    cache.timestamp = now;
    return cache.data;
  } catch {
    // If everything fails, return mock data so the component still renders
    return { markets: MOCK_NFL_MARKETS, isLive: false };
  }
}

/**
 * Clear the cache (useful for testing or manual refresh).
 */
export function clearMarketCache() {
  cache = { data: null, timestamp: 0 };
}

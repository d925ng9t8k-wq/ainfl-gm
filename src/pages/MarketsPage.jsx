import React, { useState, useEffect } from 'react';
import { getNFLMarkets, clearMarketCache } from '../utils/predictionMarkets';
import ShareButtons from '../components/ShareButtons';

function ProbabilityBar({ name, probability, isTop }) {
  const barColor = isTop ? '#00f0ff' : 'rgba(0, 240, 255, 0.4)';
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
        <span style={{ color: '#CBD5E1', maxWidth: '75%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </span>
        <span style={{ color: isTop ? '#00f0ff' : '#94A3B8', fontWeight: 700, fontFamily: "'Oswald', sans-serif" }}>
          {probability}%
        </span>
      </div>
      <div style={{ height: 6, background: 'rgba(0, 240, 255, 0.08)', borderRadius: 3, overflow: 'hidden' }}>
        <div
          style={{
            width: `${probability}%`,
            height: '100%',
            background: isTop
              ? 'linear-gradient(90deg, #00f0ff, #00d4ff)'
              : 'linear-gradient(90deg, rgba(0, 240, 255, 0.5), rgba(0, 240, 255, 0.3))',
            borderRadius: 3,
            transition: 'width 0.6s ease',
            boxShadow: isTop ? '0 0 8px rgba(0, 240, 255, 0.3)' : 'none',
          }}
        />
      </div>
    </div>
  );
}

function FullMarketCard({ market }) {
  return (
    <div style={{
      background: 'rgba(15, 23, 42, 0.85)',
      border: '1px solid rgba(0, 240, 255, 0.12)',
      borderRadius: 12,
      padding: 20,
      transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
    }}
      onMouseOver={e => {
        e.currentTarget.style.borderColor = 'rgba(0, 240, 255, 0.3)';
        e.currentTarget.style.boxShadow = '0 4px 20px rgba(0, 240, 255, 0.08)';
      }}
      onMouseOut={e => {
        e.currentTarget.style.borderColor = 'rgba(0, 240, 255, 0.12)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      <div style={{
        color: '#E2E8F0',
        fontSize: 15,
        fontWeight: 700,
        marginBottom: 14,
        lineHeight: 1.4,
        fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
        letterSpacing: '0.02em',
      }}>
        {market.question}
      </div>

      <div style={{ marginBottom: 10 }}>
        {market.outcomes.map((outcome, i) => (
          <ProbabilityBar
            key={outcome.name}
            name={outcome.name}
            probability={outcome.probability}
            isTop={i === 0}
          />
        ))}
      </div>

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 10,
        borderTop: '1px solid rgba(0, 240, 255, 0.06)',
      }}>
        <span style={{ color: '#64748b', fontSize: 12, fontFamily: "'Inter', system-ui, sans-serif" }}>
          Volume: {market.volume}
        </span>
        <a
          href={market.link}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            color: '#000',
            background: 'linear-gradient(135deg, #00f0ff, #00d4ff)',
            fontSize: 12,
            fontWeight: 700,
            textDecoration: 'none',
            padding: '5px 14px',
            borderRadius: 6,
            fontFamily: "'Oswald', sans-serif",
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            transition: 'box-shadow 0.2s ease, transform 0.2s ease',
            boxShadow: '0 2px 8px rgba(0, 240, 255, 0.2)',
          }}
          onMouseOver={e => {
            e.target.style.boxShadow = '0 4px 16px rgba(0, 240, 255, 0.4)';
            e.target.style.transform = 'translateY(-1px)';
          }}
          onMouseOut={e => {
            e.target.style.boxShadow = '0 2px 8px rgba(0, 240, 255, 0.2)';
            e.target.style.transform = 'translateY(0)';
          }}
        >
          Trade on Polymarket
        </a>
      </div>
    </div>
  );
}

export default function MarketsPage() {
  const [marketData, setMarketData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await getNFLMarkets(12);
        if (!cancelled) {
          setMarketData(data);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const handleRefresh = () => {
    clearMarketCache();
    setLoading(true);
    getNFLMarkets(12).then(data => {
      setMarketData(data);
      setLoading(false);
    });
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Page Header */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(10, 18, 37, 0.95), rgba(15, 23, 42, 0.95))',
        border: '1px solid rgba(0, 240, 255, 0.15)',
        borderRadius: 12,
        padding: '24px 28px',
        marginBottom: 20,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <h1 style={{
              color: '#00f0ff',
              fontSize: 28,
              fontWeight: 900,
              fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              margin: 0,
              lineHeight: 1.2,
              textShadow: '0 0 20px rgba(0, 240, 255, 0.3)',
            }}>
              NFL Prediction Markets
            </h1>
            <p style={{
              color: '#94A3B8',
              fontSize: 14,
              lineHeight: 1.6,
              marginTop: 10,
              marginBottom: 0,
              fontFamily: "'Inter', system-ui, sans-serif",
            }}>
              Prediction markets aggregate the wisdom of the crowd into real-time probabilities.
              Traders put real money behind their forecasts, making these odds among the most
              accurate indicators available. Data powered by{' '}
              <a
                href="https://polymarket.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#00f0ff', textDecoration: 'none', fontWeight: 600 }}
              >
                Polymarket
              </a>
              , the world's largest prediction market platform.
            </p>
          </div>
          <a
            href="https://polymarket.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              color: '#000',
              background: 'linear-gradient(135deg, #00f0ff, #00d4ff)',
              fontSize: 14,
              fontWeight: 800,
              textDecoration: 'none',
              padding: '10px 22px',
              borderRadius: 8,
              fontFamily: "'Oswald', sans-serif",
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              boxShadow: '0 4px 16px rgba(0, 240, 255, 0.25)',
              transition: 'box-shadow 0.2s ease, transform 0.2s ease',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
            onMouseOver={e => {
              e.currentTarget.style.boxShadow = '0 6px 24px rgba(0, 240, 255, 0.4)';
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseOut={e => {
              e.currentTarget.style.boxShadow = '0 4px 16px rgba(0, 240, 255, 0.25)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            Start Trading on Polymarket
          </a>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <ShareButtons title="NFL Prediction Markets - live odds on Super Bowl, MVP, and more at AiNFL GM" compact />
        </div>
      </div>

      {/* Status Bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
        padding: '0 4px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {marketData && (
            <>
              <div style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: marketData.isLive ? '#4ade80' : '#facc15',
                boxShadow: marketData.isLive ? '0 0 8px #4ade80' : '0 0 8px #facc15',
              }} />
              <span style={{
                color: '#94A3B8',
                fontSize: 12,
                fontFamily: "'Oswald', sans-serif",
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}>
                {marketData.isLive ? 'Live Data' : 'Sample Data'} — {marketData.markets.length} Markets
              </span>
            </>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          style={{
            background: 'rgba(0, 240, 255, 0.08)',
            border: '1px solid rgba(0, 240, 255, 0.2)',
            borderRadius: 6,
            color: '#00f0ff',
            fontSize: 12,
            fontWeight: 600,
            padding: '6px 14px',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontFamily: "'Oswald', sans-serif",
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            transition: 'background 0.2s ease',
            opacity: loading ? 0.5 : 1,
          }}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Loading State */}
      {loading && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 60,
          color: '#64748b',
          fontSize: 14,
          fontFamily: "'Oswald', sans-serif",
          letterSpacing: '0.04em',
        }}>
          <div style={{
            width: 24,
            height: 24,
            border: '2px solid rgba(0, 240, 255, 0.2)',
            borderTop: '2px solid #00f0ff',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            marginRight: 12,
          }} />
          Loading markets...
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Markets Grid */}
      {!loading && marketData && marketData.markets.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(380, 1fr))',
          gap: 16,
        }}>
          {/* Use CSS media query approach via style for responsive grid */}
          <style>{`
            .markets-grid {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 16px;
            }
            @media (max-width: 800px) {
              .markets-grid {
                grid-template-columns: 1fr;
              }
            }
          `}</style>
        </div>
      )}

      {!loading && marketData && marketData.markets.length > 0 && (
        <div className="markets-grid">
          {marketData.markets.map(market => (
            <FullMarketCard key={market.id} market={market} />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && (!marketData || marketData.markets.length === 0) && (
        <div style={{
          textAlign: 'center',
          padding: 60,
          color: '#64748b',
          fontSize: 14,
        }}>
          No NFL markets available right now. Check back later.
        </div>
      )}

      {/* Footer CTA */}
      {!loading && marketData && marketData.markets.length > 0 && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(0, 240, 255, 0.06), rgba(0, 212, 255, 0.03))',
          border: '1px solid rgba(0, 240, 255, 0.12)',
          borderRadius: 12,
          padding: '20px 24px',
          marginTop: 24,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}>
          <div>
            <div style={{
              color: '#E2E8F0',
              fontSize: 15,
              fontWeight: 700,
              fontFamily: "'Oswald', sans-serif",
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}>
              Want to trade NFL predictions?
            </div>
            <div style={{
              color: '#64748b',
              fontSize: 12,
              marginTop: 4,
              fontFamily: "'Inter', system-ui, sans-serif",
            }}>
              Join thousands of traders on Polymarket and put your NFL knowledge to work.
            </div>
          </div>
          <a
            href="https://polymarket.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: '#000',
              background: 'linear-gradient(135deg, #00f0ff, #00d4ff)',
              fontSize: 13,
              fontWeight: 700,
              textDecoration: 'none',
              padding: '8px 20px',
              borderRadius: 6,
              fontFamily: "'Oswald', sans-serif",
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              boxShadow: '0 2px 12px rgba(0, 240, 255, 0.2)',
              whiteSpace: 'nowrap',
            }}
          >
            Trade on Polymarket
          </a>
        </div>
      )}

      {/* Sportsbook Section — Affiliate Links */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(10, 18, 37, 0.95))',
        border: '1px solid rgba(0, 240, 255, 0.1)',
        borderRadius: 12,
        padding: '20px 24px',
        marginTop: 20,
      }}>
        <div style={{
          color: '#E2E8F0', fontSize: 16, fontWeight: 700,
          fontFamily: "'Oswald', sans-serif", letterSpacing: '0.04em',
          textTransform: 'uppercase', marginBottom: 12,
        }}>
          Put Your GM Knowledge to Work
        </div>
        <p style={{ color: '#94A3B8', fontSize: 13, lineHeight: 1.6, margin: '0 0 16px', fontFamily: "'Inter', sans-serif" }}>
          Think you know which teams will win? Take your analysis from the simulator to the sportsbooks.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {/* TODO: Replace URLs with actual affiliate tracking links once approved */}
          {[
            { name: 'Bet on DraftKings', url: 'https://www.draftkings.com/?ref=AINFLGM_AFFILIATE', color: '#53D337' },
            { name: 'Bet on FanDuel', url: 'https://www.fanduel.com/?ref=AINFLGM_AFFILIATE', color: '#1493FF' },
            { name: 'Bet on PrizePicks', url: 'https://www.prizepicks.com/?ref=AINFLGM_AFFILIATE', color: '#7C3AED' },
          ].map(book => (
            <a key={book.name} href={book.url} target="_blank" rel="noopener noreferrer" style={{
              padding: '8px 18px', borderRadius: 6, fontSize: 13, fontWeight: 700,
              fontFamily: "'Oswald', sans-serif", letterSpacing: '0.04em', textTransform: 'uppercase',
              textDecoration: 'none', color: '#fff', background: book.color,
              boxShadow: `0 2px 8px ${book.color}40`, transition: 'transform 0.2s, box-shadow 0.2s',
            }}
              onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onMouseOut={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
            >
              {book.name} →
            </a>
          ))}
        </div>
        <p style={{ color: '#64748b', fontSize: 11, marginTop: 12, marginBottom: 0, fontFamily: "'Inter', sans-serif" }}>
          Must be 21+. T&Cs apply. Gambling problem? Call 1-800-GAMBLER.
        </p>
      </div>

      {/* Responsible Gambling Disclosure */}
      <div style={{
        background: 'rgba(15, 23, 42, 0.9)',
        border: '1px solid rgba(250, 204, 21, 0.25)',
        borderRadius: 10,
        padding: '16px 20px',
        marginTop: 20,
      }}>
        <div style={{
          color: '#facc15',
          fontSize: 13,
          fontWeight: 700,
          fontFamily: "'Oswald', sans-serif",
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          marginBottom: 8,
        }}>
          Responsible Gambling
        </div>
        <p style={{
          color: '#94A3B8',
          fontSize: 12,
          lineHeight: 1.7,
          margin: '0 0 8px',
          fontFamily: "'Inter', system-ui, sans-serif",
        }}>
          Gambling problem? Call <strong style={{ color: '#E2E8F0' }}>1-800-GAMBLER</strong> (1-800-426-2537).
          If you or someone you know has a gambling problem and wants help, call the
          Council on Compulsive Gambling at 1-800-GAMBLER. Must be 21+ and present in a
          state where sports betting is legal to place wagers. Please gamble responsibly.
        </p>
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          fontSize: 11,
          color: '#64748b',
          fontFamily: "'Inter', system-ui, sans-serif",
        }}>
          <a href="https://www.ncpgambling.org" target="_blank" rel="noopener noreferrer"
            style={{ color: '#94A3B8', textDecoration: 'underline' }}>
            National Council on Problem Gambling
          </a>
          <a href="https://www.fanduel.com/responsible-gaming" target="_blank" rel="noopener noreferrer"
            style={{ color: '#94A3B8', textDecoration: 'underline' }}>
            FanDuel Responsible Gaming
          </a>
          <a href="https://www.draftkings.com/about/responsible-gaming" target="_blank" rel="noopener noreferrer"
            style={{ color: '#94A3B8', textDecoration: 'underline' }}>
            DraftKings Responsible Gaming
          </a>
        </div>
      </div>

      {/* Attribution */}
      <div style={{
        textAlign: 'center',
        padding: '16px 0 8px',
        color: '#475569',
        fontSize: 11,
        fontFamily: "'Inter', system-ui, sans-serif",
      }}>
        Market data from{' '}
        <a
          href="https://polymarket.com"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#64748b', textDecoration: 'none' }}
        >
          Polymarket
        </a>
        . Prices reflect real-money trading activity and update automatically.
      </div>
    </div>
  );
}

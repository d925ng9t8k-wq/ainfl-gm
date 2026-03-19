import React, { useState, useEffect } from 'react';
import { getNFLMarkets, clearMarketCache } from '../utils/predictionMarkets';

function ProbabilityBar({ name, probability, isTop }) {
  const barColor = isTop ? '#00f0ff' : 'rgba(0, 240, 255, 0.4)';
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
        <span style={{ color: '#CBD5E1', maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </span>
        <span style={{ color: isTop ? '#00f0ff' : '#94A3B8', fontWeight: 700, fontFamily: "'Oswald', sans-serif" }}>
          {probability}%
        </span>
      </div>
      <div style={{ height: 4, background: 'rgba(0, 240, 255, 0.08)', borderRadius: 2, overflow: 'hidden' }}>
        <div
          style={{
            width: `${probability}%`,
            height: '100%',
            background: barColor,
            borderRadius: 2,
            transition: 'width 0.6s ease',
          }}
        />
      </div>
    </div>
  );
}

function MarketCard({ market }) {
  // Show top 3 outcomes max to keep it compact
  const displayOutcomes = market.outcomes.slice(0, 3);
  const hasMore = market.outcomes.length > 3;

  return (
    <div style={{
      background: 'rgba(15, 23, 42, 0.8)',
      border: '1px solid rgba(0, 240, 255, 0.1)',
      borderRadius: 8,
      padding: 12,
      marginBottom: 8,
    }}>
      <div style={{
        color: '#E2E8F0',
        fontSize: 12,
        fontWeight: 600,
        marginBottom: 8,
        lineHeight: 1.3,
        fontFamily: "'Inter', system-ui, sans-serif",
      }}>
        {market.question}
      </div>

      <div style={{ marginBottom: 6 }}>
        {displayOutcomes.map((outcome, i) => (
          <ProbabilityBar
            key={outcome.name}
            name={outcome.name}
            probability={outcome.probability}
            isTop={i === 0}
          />
        ))}
        {hasMore && (
          <div style={{ color: '#64748b', fontSize: 10, marginTop: 2 }}>
            +{market.outcomes.length - 3} more outcomes
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#64748b', fontSize: 10 }}>
          Vol: {market.volume}
        </span>
        <a
          href={market.link}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: '#00f0ff',
            fontSize: 10,
            textDecoration: 'none',
            fontWeight: 600,
            opacity: 0.8,
          }}
          onMouseOver={e => e.target.style.opacity = '1'}
          onMouseOut={e => e.target.style.opacity = '0.8'}
        >
          Trade on Polymarket &rarr;
        </a>
      </div>
    </div>
  );
}

export default function PredictionMarkets({ maxMarkets = 4 }) {
  const [marketData, setMarketData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await getNFLMarkets();
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

  // Don't render anything if loading or no data
  if (loading) return null;
  if (!marketData || marketData.markets.length === 0) return null;

  const displayMarkets = marketData.markets.slice(0, maxMarkets);

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(10, 18, 37, 0.95), rgba(15, 23, 42, 0.95))',
      border: '1px solid rgba(0, 240, 255, 0.15)',
      borderRadius: 12,
      padding: 16,
      marginTop: 20,
    }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: collapsed ? 0 : 12,
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => setCollapsed(c => !c)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: marketData.isLive ? '#4ade80' : '#facc15',
            boxShadow: marketData.isLive ? '0 0 6px #4ade80' : '0 0 6px #facc15',
          }} />
          <span style={{
            color: '#00f0ff',
            fontSize: 13,
            fontWeight: 700,
            fontFamily: "'Oswald', sans-serif",
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}>
            {marketData.isLive ? 'Live Markets' : 'NFL Markets'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!marketData.isLive && (
            <span style={{ color: '#64748b', fontSize: 9, fontStyle: 'italic' }}>Sample data</span>
          )}
          <span style={{ color: '#64748b', fontSize: 14, transform: collapsed ? 'rotate(-90deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>
            &#9660;
          </span>
        </div>
      </div>

      {/* Markets list */}
      {!collapsed && (
        <>
          {displayMarkets.map(market => (
            <MarketCard key={market.id} market={market} />
          ))}

          {/* Footer */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 8,
            paddingTop: 8,
            borderTop: '1px solid rgba(0, 240, 255, 0.08)',
          }}>
            <a
              href="https://polymarket.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: '#64748b',
                fontSize: 10,
                textDecoration: 'none',
                fontFamily: "'Inter', system-ui, sans-serif",
              }}
            >
              Powered by Polymarket
            </a>
            <button
              onClick={(e) => {
                e.stopPropagation();
                clearMarketCache();
                setLoading(true);
                getNFLMarkets().then(data => {
                  setMarketData(data);
                  setLoading(false);
                });
              }}
              style={{
                background: 'none',
                border: '1px solid rgba(0, 240, 255, 0.15)',
                borderRadius: 4,
                color: '#64748b',
                fontSize: 10,
                padding: '3px 8px',
                cursor: 'pointer',
                fontFamily: "'Inter', system-ui, sans-serif",
              }}
            >
              Refresh
            </button>
          </div>
        </>
      )}
    </div>
  );
}

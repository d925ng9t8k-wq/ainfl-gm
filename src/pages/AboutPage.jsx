import React from 'react';

export default function AboutPage() {
  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '0 16px' }}>
      <h1 style={{ color: '#00f0ff', fontSize: 24, fontFamily: "'Oswald', sans-serif", margin: '0 0 20px' }}>
        About AiNFL GM
      </h1>
      <div style={{ color: '#CBD5E1', fontSize: 14, lineHeight: 1.8, fontFamily: "'Inter', sans-serif" }}>

        <p>
          AiNFL GM is a free, fan-made NFL offseason simulator. Build your dream roster, manage the salary cap,
          work the free agent market, make trades, and run a full mock draft — for any of the 32 NFL teams.
        </p>

        <h2 style={{ color: '#E2E8F0', fontSize: 18, margin: '24px 0 8px' }}>What You Can Do</h2>
        <ul style={{ paddingLeft: 20 }}>
          <li><strong>Roster Management</strong> — View your team's full roster with real 2026 cap data. Cut players, re-sign veterans, and build depth.</li>
          <li><strong>Cap Tracker</strong> — See exactly where your cap space is committed. The Top 51 rule is applied automatically for offseason calculations.</li>
          <li><strong>Free Agency</strong> — Sign available free agents to custom contracts. The AI suggests realistic deal structures based on player grade and market.</li>
          <li><strong>Trades</strong> — Propose and accept trades with any of the 31 other teams. Balance rosters, move picks, and reshape your window.</li>
          <li><strong>Mock Draft</strong> — Run a full 7-round mock draft. The AI picks for every other team. Your picks are yours to make.</li>
          <li><strong>Season Sim</strong> — Simulate the upcoming season with your rebuilt roster and see projected standings.</li>
          <li><strong>Prediction Markets</strong> — Track real-money prediction market odds on NFL outcomes.</li>
        </ul>

        <h2 style={{ color: '#E2E8F0', fontSize: 18, margin: '24px 0 8px' }}>The Data</h2>
        <p>
          All salary cap figures and contract data are sourced from{' '}
          <a href="https://overthecap.com" target="_blank" rel="noopener noreferrer" style={{ color: '#00f0ff', textDecoration: 'none' }}>
            Over The Cap
          </a>{' '}
          and{' '}
          <a href="https://www.espn.com/nfl/" target="_blank" rel="noopener noreferrer" style={{ color: '#00f0ff', textDecoration: 'none' }}>
            ESPN
          </a>.
          {' '}Data reflects the 2026 NFL offseason. The 2026 salary cap is $301.2M per team (official, per NFL.com).
        </p>
        <p>
          Your simulation — roster moves, trades, draft selections, and saved scenarios — is stored locally in your browser.
          Nothing is sent to a server. Your GM sessions are yours.
        </p>

        <h2 style={{ color: '#E2E8F0', fontSize: 18, margin: '24px 0 8px' }}>Affiliate Disclosure</h2>
        <p>
          This site contains affiliate links to third-party services including sportsbooks and prediction markets.
          If you sign up through one of our links, we may earn a commission at no extra cost to you.
          We only link to services we believe are reputable, but we encourage you to do your own research
          before signing up for any paid service.
        </p>
        <p>
          Responsible gaming resources: <a href="tel:18004262537" style={{ color: '#00f0ff', textDecoration: 'none' }}>1-800-GAMBLER</a>{' '}
          | <a href="https://www.ncpgambling.org" target="_blank" rel="noopener noreferrer" style={{ color: '#00f0ff', textDecoration: 'none' }}>ncpgambling.org</a>
        </p>

        <h2 style={{ color: '#E2E8F0', fontSize: 18, margin: '24px 0 8px' }}>Support the Project</h2>
        <p>
          AiNFL GM is free and will stay free. If you enjoy it, consider{' '}
          <a href="https://buymeacoffee.com/ainflgm" target="_blank" rel="noopener noreferrer" style={{ color: '#00f0ff', textDecoration: 'none' }}>
            buying us a coffee
          </a>
          . It keeps the servers running and the data fresh.
        </p>

        <h2 style={{ color: '#E2E8F0', fontSize: 18, margin: '24px 0 8px' }}>Contact</h2>
        <p>
          Questions, feedback, or data corrections?{' '}
          <a href="mailto:captain@ainflgm.com" style={{ color: '#00f0ff', textDecoration: 'none' }}>captain@ainflgm.com</a>
        </p>

        <div style={{ marginTop: 32, padding: '16px 20px', background: 'rgba(0,240,255,0.06)', borderRadius: 8, border: '1px solid rgba(0,240,255,0.1)' }}>
          <div style={{ color: '#94A3B8', fontSize: 12 }}>
            AiNFL GM is a fan-made project and is not affiliated with the NFL, any NFL team, any sportsbook,
            or any official league data provider. All team names, logos, and player data are property of their
            respective owners and are used for informational and entertainment purposes only.
          </div>
        </div>

      </div>
    </div>
  );
}

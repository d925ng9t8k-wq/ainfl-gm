import React from 'react';

export default function PrivacyPage() {
  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '0 16px' }}>
      <h1 style={{ color: '#00f0ff', fontSize: 24, fontFamily: "'Oswald', sans-serif", margin: '0 0 20px' }}>
        Privacy Policy
      </h1>
      <div style={{ color: '#CBD5E1', fontSize: 14, lineHeight: 1.8, fontFamily: "'Inter', sans-serif" }}>
        <p><strong>Last updated:</strong> March 21, 2026</p>

        <h2 style={{ color: '#E2E8F0', fontSize: 18, margin: '24px 0 8px' }}>What We Collect</h2>
        <p>AiNFL GM collects minimal data to improve your experience:</p>
        <ul style={{ paddingLeft: 20 }}>
          <li><strong>Analytics:</strong> We use Google Analytics to understand how visitors use the site (pages viewed, device type, referral source). This data is aggregated and anonymous.</li>
          <li><strong>Feedback:</strong> If you submit feedback through the app, we collect your message and optional email address.</li>
          <li><strong>Local Storage:</strong> Your simulation data (roster changes, draft picks, scenarios) is stored locally on your device. We do not collect or store this data on our servers.</li>
        </ul>

        <h2 style={{ color: '#E2E8F0', fontSize: 18, margin: '24px 0 8px' }}>Cookies & Advertising</h2>
        <p>We may use cookies for analytics and advertising purposes. Third-party advertising partners (such as Google AdSense) may use cookies to serve ads based on your browsing activity. You can manage cookie preferences in your browser settings.</p>

        <h2 style={{ color: '#E2E8F0', fontSize: 18, margin: '24px 0 8px' }}>Third-Party Services</h2>
        <ul style={{ paddingLeft: 20 }}>
          <li><strong>Google Analytics</strong> — Website traffic analysis</li>
          <li><strong>Google AdSense</strong> — Advertising (when enabled)</li>
          <li><strong>Polymarket</strong> — Prediction market data display</li>
          <li><strong>Buy Me a Coffee</strong> — Supporter donations</li>
        </ul>

        <h2 style={{ color: '#E2E8F0', fontSize: 18, margin: '24px 0 8px' }}>Data Security</h2>
        <p>Your simulation data stays on your device. We do not have servers that store personal user data. All interactions with the simulator happen locally in your browser.</p>

        <h2 style={{ color: '#E2E8F0', fontSize: 18, margin: '24px 0 8px' }}>Contact</h2>
        <p>Questions about this policy? Reach us at <a href="mailto:captain@ainflgm.com" style={{ color: '#00f0ff', textDecoration: 'none' }}>captain@ainflgm.com</a></p>

        <div style={{ marginTop: 32, padding: '16px 20px', background: 'rgba(0,240,255,0.06)', borderRadius: 8, border: '1px solid rgba(0,240,255,0.1)' }}>
          <div style={{ color: '#94A3B8', fontSize: 12 }}>
            AiNFL GM is a free, fan-made NFL offseason simulator. We are not affiliated with the NFL, any NFL team, or any sportsbook. All team names, logos, and player data are property of their respective owners.
          </div>
        </div>
      </div>
    </div>
  );
}

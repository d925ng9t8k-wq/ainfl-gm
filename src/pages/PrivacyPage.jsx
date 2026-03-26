import React from 'react';

const cardStyle = {
  background: 'rgba(0,240,255,0.04)',
  border: '1px solid rgba(0,240,255,0.1)',
  borderRadius: 8,
  padding: '16px 20px',
  margin: '12px 0',
};

const h2Style = { color: '#E2E8F0', fontSize: 18, margin: '28px 0 8px', fontFamily: "'Oswald', sans-serif" };
const h3Style = { color: '#CBD5E1', fontSize: 15, margin: '16px 0 6px', fontWeight: 600 };
const pStyle = { color: '#94A3B8', fontSize: 14, lineHeight: 1.8, margin: '0 0 12px' };
const ulStyle = { paddingLeft: 20, color: '#94A3B8', fontSize: 14, lineHeight: 1.8 };
const linkStyle = { color: '#00f0ff', textDecoration: 'none' };

export default function PrivacyPage() {
  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '0 16px 40px' }}>
      <h1 style={{ color: '#00f0ff', fontSize: 24, fontFamily: "'Oswald', sans-serif", margin: '0 0 6px' }}>
        Privacy Policy
      </h1>
      <div style={{ color: '#94A3B8', fontSize: 13, marginBottom: 24 }}>
        Effective Date: March 26, 2026 &bull; Last Updated: March 26, 2026
      </div>

      <div style={{ ...pStyle }}>
        This privacy policy describes how <strong style={{ color: '#E2E8F0' }}>AiNFL GM</strong> ("we," "us," or "our"),
        operated by <strong style={{ color: '#E2E8F0' }}>9 Enterprises LLC</strong>, collects, uses, and shares
        information when you visit <strong style={{ color: '#E2E8F0' }}>ainflgm.com</strong> (the "Site").
      </div>

      <h2 style={h2Style}>Information We Collect</h2>

      <div style={cardStyle}>
        <h3 style={h3Style}>Analytics Data</h3>
        <p style={pStyle}>We use Google Analytics to understand how visitors use the Site. This service collects anonymous usage data including:</p>
        <ul style={ulStyle}>
          <li>Pages visited and time spent on each page</li>
          <li>Referring website or source</li>
          <li>Browser type and device information</li>
          <li>General geographic location (city/region level)</li>
          <li>Interactions with site features (simulations run, teams selected)</li>
        </ul>
        <p style={{ ...pStyle, marginTop: 10, marginBottom: 0 }}>Google Analytics uses cookies to collect this data. No personally identifiable information (PII) is collected through analytics.</p>
      </div>

      <div style={cardStyle}>
        <h3 style={h3Style}>Information We Do Not Collect</h3>
        <p style={pStyle}>AiNFL GM does not require account creation and does not collect:</p>
        <ul style={ulStyle}>
          <li>Names, email addresses, or contact information (unless you contact us voluntarily)</li>
          <li>Payment information (processed by third-party providers when applicable)</li>
          <li>Social media account data</li>
          <li>Location data beyond what Google Analytics provides</li>
        </ul>
      </div>

      <h2 style={h2Style}>Cookies</h2>
      <p style={pStyle}>The Site uses cookies for the following purposes:</p>
      <ul style={ulStyle}>
        <li><strong style={{ color: '#CBD5E1' }}>Analytics cookies</strong> — Google Analytics cookies (_ga, _gid) to measure site traffic and usage patterns. These expire after 2 years and 24 hours, respectively.</li>
        <li><strong style={{ color: '#CBD5E1' }}>Advertising cookies</strong> — When ads are displayed, our advertising partners (including Google AdSense) may place cookies to serve relevant ads and measure ad performance.</li>
        <li><strong style={{ color: '#CBD5E1' }}>Functional cookies</strong> — The Site stores your team selection and simulation preferences in your browser (localStorage). This data never leaves your device.</li>
      </ul>
      <p style={{ ...pStyle, marginTop: 10 }}>You can control cookies through your browser settings. Disabling cookies may affect some site functionality.</p>

      <h2 style={h2Style}>Third-Party Advertising</h2>
      <p style={pStyle}>We use <strong style={{ color: '#CBD5E1' }}>Google AdSense</strong> and may use other advertising networks to display ads on the Site. These services may:</p>
      <ul style={ulStyle}>
        <li>Use cookies and web beacons to serve ads based on your prior visits to this Site or other websites</li>
        <li>Collect anonymous data about your interactions with ads</li>
        <li>Use the DoubleClick cookie to enable interest-based advertising</li>
      </ul>
      <p style={{ ...pStyle, marginTop: 10 }}>
        You can opt out of personalized advertising by visiting{' '}
        <a href="https://www.google.com/settings/ads" target="_blank" rel="noopener noreferrer" style={linkStyle}>Google Ads Settings</a>
        {' '}or{' '}
        <a href="https://optout.aboutads.info/" target="_blank" rel="noopener noreferrer" style={linkStyle}>aboutads.info</a>.
      </p>

      <h2 style={h2Style}>Affiliate Links</h2>
      <p style={pStyle}>
        The Site may contain affiliate links to third-party services including sports betting platforms (DraftKings, FanDuel)
        and prediction markets (Polymarket, Kalshi). When you click these links and take qualifying actions, we may earn
        a commission. These third-party sites have their own privacy policies.
      </p>
      <div style={{ ...cardStyle, borderColor: 'rgba(251,79,20,0.2)', background: 'rgba(251,79,20,0.04)' }}>
        <p style={{ ...pStyle, margin: 0, color: '#CBD5E1' }}>
          <strong>FTC Disclosure:</strong> Some links on this site are affiliate links. We may earn a commission if you
          sign up through these links, at no additional cost to you.
        </p>
      </div>

      <h2 style={h2Style}>How We Use Information</h2>
      <p style={pStyle}>The anonymous analytics data we collect is used to:</p>
      <ul style={ulStyle}>
        <li>Understand which features are most popular</li>
        <li>Improve site performance and user experience</li>
        <li>Make decisions about new features and content</li>
        <li>Measure the effectiveness of marketing efforts</li>
      </ul>
      <p style={{ ...pStyle, marginTop: 10 }}>We do not sell, trade, or transfer your information to third parties, except as described in this policy.</p>

      <h2 style={h2Style}>Data Security</h2>
      <p style={pStyle}>We implement reasonable security measures to protect the limited data we collect. Your simulation data stays on your device — we have no servers storing personal user data. However, no method of electronic transmission or storage is 100% secure.</p>

      <h2 style={h2Style}>Children's Privacy</h2>
      <p style={pStyle}>AiNFL GM is not directed at children under 13. We do not knowingly collect information from children under 13. If you believe a child has provided us with personal information, please contact us so we can delete it.</p>

      <h2 style={h2Style}>Changes to This Policy</h2>
      <p style={pStyle}>We may update this privacy policy from time to time. Changes will be posted on this page with an updated "Last Updated" date. Your continued use of the Site after changes constitutes acceptance of the updated policy.</p>

      <h2 style={h2Style}>Contact Us</h2>
      <div style={cardStyle}>
        <p style={{ ...pStyle, margin: '0 0 6px' }}><strong style={{ color: '#CBD5E1' }}>Email:</strong> <a href="mailto:privacy@ainflgm.com" style={linkStyle}>privacy@ainflgm.com</a></p>
        <p style={{ ...pStyle, margin: '0 0 6px' }}><strong style={{ color: '#CBD5E1' }}>General:</strong> <a href="mailto:captain@ainflgm.com" style={linkStyle}>captain@ainflgm.com</a></p>
        <p style={{ ...pStyle, margin: 0 }}><strong style={{ color: '#CBD5E1' }}>Company:</strong> 9 Enterprises LLC &bull; Cincinnati, OH</p>
      </div>

      <div style={{ marginTop: 32, ...cardStyle }}>
        <div style={{ color: '#475569', fontSize: 12 }}>
          AiNFL GM is a free, fan-made NFL offseason simulator. We are not affiliated with the NFL, any NFL team, or any sportsbook. All team names, logos, and player data are property of their respective owners.
        </div>
      </div>
    </div>
  );
}

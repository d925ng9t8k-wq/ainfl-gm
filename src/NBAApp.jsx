import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { NbaGameProvider } from './context/NbaGameContext';
import NbaLayout from './components/NbaLayout';
import NbaRosterPage from './pages/nba/NbaRosterPage';
import NbaCapTrackerPage from './pages/nba/NbaCapTrackerPage';
import NbaFreeAgencyPage from './pages/nba/NbaFreeAgencyPage';
import NbaTradePage from './pages/nba/NbaTradePage';
import NbaDraftPage from './pages/nba/NbaDraftPage';
import NbaSeasonSimPage from './pages/nba/NbaSeasonSimPage';
import NbaSummaryPage from './pages/nba/NbaSummaryPage';

class NbaErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, color: '#ff4444', fontFamily: 'monospace' }}>
          <h2>Something went wrong in AiNBA GM</h2>
          <pre style={{ color: '#888', fontSize: 12 }}>{this.state.error?.message}</pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{ background: '#FFA500', color: '#000', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', marginTop: 12 }}
          >Try Again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function NBAApp() {
  return (
    <NbaGameProvider>
      <NbaErrorBoundary>
        <NbaLayout>
          <Routes>
            <Route path="/" element={<NbaRosterPage />} />
            <Route path="/cap" element={<NbaCapTrackerPage />} />
            <Route path="/fa" element={<NbaFreeAgencyPage />} />
            <Route path="/trades" element={<NbaTradePage />} />
            <Route path="/draft" element={<NbaDraftPage />} />
            <Route path="/season" element={<NbaSeasonSimPage />} />
            <Route path="/summary" element={<NbaSummaryPage />} />
            <Route path="*" element={<Navigate to="/nba" replace />} />
          </Routes>
        </NbaLayout>
      </NbaErrorBoundary>
    </NbaGameProvider>
  );
}

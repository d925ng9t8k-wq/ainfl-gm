import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { GameProvider } from './context/GameContext';
import Layout from './components/Layout';
import RosterPage from './pages/RosterPage';
import CapTrackerPage from './pages/CapTrackerPage';
import FreeAgencyPage from './pages/FreeAgencyPage';
import TradePage from './pages/TradePage';
import DraftPage from './pages/DraftPage';
import SummaryPage from './pages/SummaryPage';

class ErrorBoundary extends React.Component {
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
          <h2>Something went wrong</h2>
          <pre style={{ color: '#888', fontSize: 12 }}>{this.state.error?.message}</pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{ background: 'var(--bengals-orange)', color: '#000', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', marginTop: 12 }}
          >Try Again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <GameProvider>
      <ErrorBoundary>
        <Layout>
          <Routes>
            <Route path="/" element={<RosterPage />} />
            <Route path="/cap" element={<CapTrackerPage />} />
            <Route path="/fa" element={<FreeAgencyPage />} />
            <Route path="/trades" element={<TradePage />} />
            <Route path="/draft" element={<DraftPage />} />
            <Route path="/summary" element={<SummaryPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </ErrorBoundary>
    </GameProvider>
  );
}

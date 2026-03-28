import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { MLBGameProvider } from './context/MLBGameContext';
import MLBLayout from './components/MLBLayout';
import MLBRosterPage from './pages/mlb/MLBRosterPage';
import MLBPayrollPage from './pages/mlb/MLBPayrollPage';
import MLBFreeAgencyPage from './pages/mlb/MLBFreeAgencyPage';
import MLBTradePage from './pages/mlb/MLBTradePage';
import MLBSeasonSimPage from './pages/mlb/MLBSeasonSimPage';
import MLBSummaryPage from './pages/mlb/MLBSummaryPage';

class MLBErrorBoundary extends React.Component {
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
          <h2>AiMLB GM error</h2>
          <pre style={{ color: '#888', fontSize: 12 }}>{this.state.error?.message}</pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{ background: '#00C853', color: '#000', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', marginTop: 12 }}
          >Try Again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function MLBApp() {
  return (
    <MLBGameProvider>
      <MLBErrorBoundary>
        <MLBLayout>
          {/* Routes here are relative — matched after /mlb prefix is consumed by parent */}
          <Routes>
            <Route index element={<MLBRosterPage />} />
            <Route path="payroll" element={<MLBPayrollPage />} />
            <Route path="fa" element={<MLBFreeAgencyPage />} />
            <Route path="trades" element={<MLBTradePage />} />
            <Route path="season" element={<MLBSeasonSimPage />} />
            <Route path="summary" element={<MLBSummaryPage />} />
            <Route path="*" element={<Navigate to="/mlb" replace />} />
          </Routes>
        </MLBLayout>
      </MLBErrorBoundary>
    </MLBGameProvider>
  );
}

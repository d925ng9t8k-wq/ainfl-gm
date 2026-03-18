import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { GameProvider, useGame } from './context/GameContext';
import Layout from './components/Layout';
import RosterPage from './pages/RosterPage';
import CapTrackerPage from './pages/CapTrackerPage';
import FreeAgencyPage from './pages/FreeAgencyPage';
import TradePage from './pages/TradePage';
import DraftPage from './pages/DraftPage';
import SummaryPage from './pages/SummaryPage';

// Team slug to abbreviation mapping
const TEAM_SLUGS = {
  cardinals: 'ARI', falcons: 'ATL', ravens: 'BAL', bills: 'BUF',
  panthers: 'CAR', bears: 'CHI', bengals: 'CIN', browns: 'CLE',
  cowboys: 'DAL', broncos: 'DEN', lions: 'DET', packers: 'GB',
  texans: 'HOU', colts: 'IND', jaguars: 'JAX', chiefs: 'KC',
  raiders: 'LV', chargers: 'LAC', rams: 'LAR', dolphins: 'MIA',
  vikings: 'MIN', patriots: 'NE', saints: 'NO', giants: 'NYG',
  jets: 'NYJ', eagles: 'PHI', steelers: 'PIT', '49ers': 'SF',
  seahawks: 'SEA', buccaneers: 'TB', titans: 'TEN', commanders: 'WSH',
  // City variants
  arizona: 'ARI', arizonacardinals: 'ARI', atlanta: 'ATL', atlantafalcons: 'ATL',
  baltimore: 'BAL', baltimoreravens: 'BAL', buffalo: 'BUF', buffalobills: 'BUF',
  carolina: 'CAR', carolinapanthers: 'CAR', chicago: 'CHI', chicagobears: 'CHI',
  cincinnati: 'CIN', cincinnatibengals: 'CIN', cleveland: 'CLE', clevelandbrowns: 'CLE',
  dallas: 'DAL', dallascowboys: 'DAL', denver: 'DEN', denverbroncos: 'DEN',
  detroit: 'DET', detroitlions: 'DET', greenbay: 'GB', greenbaypackers: 'GB',
  houston: 'HOU', houstontexans: 'HOU', indianapolis: 'IND', indianapoliscolts: 'IND',
  jacksonville: 'JAX', jacksonvillejaguars: 'JAX', kansascity: 'KC', kansascitychiefs: 'KC',
  lasvegas: 'LV', lasvegasraiders: 'LV', losangeleschargers: 'LAC', losangelesrams: 'LAR',
  miami: 'MIA', miamidolphins: 'MIA', minnesota: 'MIN', minnesotavikings: 'MIN',
  newengland: 'NE', newenglandpatriots: 'NE', neworleans: 'NO', neworleanssaints: 'NO',
  newyorkgiants: 'NYG', newyorkjets: 'NYJ', philadelphia: 'PHI', philadelphiaeagles: 'PHI',
  pittsburgh: 'PIT', pittsburghsteelers: 'PIT', sanfrancisco: 'SF', sanfrancisco49ers: 'SF',
  seattle: 'SEA', seattleseahawks: 'SEA', tampabay: 'TB', tampabaybuccaneers: 'TB',
  tennessee: 'TEN', tennesseetitans: 'TEN', washington: 'WSH', washingtoncommanders: 'WSH',
};

function TeamRedirect() {
  const { teamSlug } = useParams();
  const { selectTeam } = useGame();
  const abbr = TEAM_SLUGS[teamSlug?.toLowerCase().replace(/[\s-_]/g, '')];

  useEffect(() => {
    if (abbr) selectTeam(abbr);
  }, [abbr, selectTeam]);

  return <Navigate to="/" replace />;
}

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
            <Route path="/team/:teamSlug" element={<TeamRedirect />} />
            <Route path="/:teamSlug" element={<TeamRedirect />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </ErrorBoundary>
    </GameProvider>
  );
}

import React, { useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { GameProvider, useGame } from './context/GameContext';
import Layout from './components/Layout';
// RosterPage is the landing route — keep it eager so initial paint has zero lazy-chunk wait.
import RosterPage from './pages/RosterPage';

// Everything below is code-split. These pages only render after user navigation,
// so there is no reason to ship them in the initial JS payload. Each becomes its
// own chunk and is fetched on demand.
const CapTrackerPage = lazy(() => import('./pages/CapTrackerPage'));
const FreeAgencyPage = lazy(() => import('./pages/FreeAgencyPage'));
const TradePage = lazy(() => import('./pages/TradePage'));
const DraftPage = lazy(() => import('./pages/DraftPage'));
const SummaryPage = lazy(() => import('./pages/SummaryPage'));
const SeasonSimPage = lazy(() => import('./pages/SeasonSimPage'));
const MarketsPage = lazy(() => import('./pages/MarketsPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));
const AboutPage = lazy(() => import('./pages/AboutPage'));

// MLB and NBA apps are entirely separate sports. Most users never touch them,
// so we ship them as their own chunks — this pulls their pages, context,
// layout, and static data out of the initial bundle.
const MLBApp = lazy(() => import('./MLBApp'));
const NBAApp = lazy(() => import('./NBAApp'));

// Minimal Suspense fallback — matches page background so there is no flash.
function RouteFallback() {
  return (
    <div
      style={{
        minHeight: '40vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#888',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 14,
      }}
    >
      Loading…
    </div>
  );
}

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

// NFL app (wrapped in GameProvider + NFL Layout)
function NFLApp() {
  return (
    <GameProvider>
      <ErrorBoundary>
        <Layout>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<RosterPage />} />
              <Route path="/cap" element={<CapTrackerPage />} />
              <Route path="/fa" element={<FreeAgencyPage />} />
              <Route path="/trades" element={<TradePage />} />
              <Route path="/draft" element={<DraftPage />} />
              <Route path="/summary" element={<SummaryPage />} />
              <Route path="/season" element={<SeasonSimPage />} />
              <Route path="/markets" element={<MarketsPage />} />
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/owner" element={<Navigate to="/" replace />} />
              <Route path="/team/:teamSlug" element={<TeamRedirect />} />
              <Route path="/:teamSlug" element={<TeamRedirect />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </Layout>
      </ErrorBoundary>
    </GameProvider>
  );
}

// Root router — splits NFL vs NBA vs MLB at the top level.
// NBA/MLB are wrapped in their own Suspense so the NFL bundle stays lean.
export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* NBA routes — completely isolated from NFL state/layout */}
        <Route path="/nba/*" element={<NBAApp />} />
        {/* MLB routes — completely isolated from NFL state/layout */}
        <Route path="/mlb/*" element={<MLBApp />} />
        {/* NFL routes — everything else */}
        <Route path="/*" element={<NFLApp />} />
      </Routes>
    </Suspense>
  );
}

// MLB Teams — 2025 season
// Colors sourced from official MLB team brand guidelines
export const mlbTeams = [
  { id: 1,  name: 'D-backs',    city: 'Arizona',       abbreviation: 'ARI', primaryColor: '#A71930', secondaryColor: '#E3D4AD', division: 'NL West' },
  { id: 2,  name: 'Braves',     city: 'Atlanta',       abbreviation: 'ATL', primaryColor: '#CE1141', secondaryColor: '#13274F', division: 'NL East' },
  { id: 3,  name: 'Orioles',    city: 'Baltimore',     abbreviation: 'BAL', primaryColor: '#DF4601', secondaryColor: '#000000', division: 'AL East' },
  { id: 4,  name: 'Red Sox',    city: 'Boston',        abbreviation: 'BOS', primaryColor: '#BD3039', secondaryColor: '#0D2B56', division: 'AL East' },
  { id: 5,  name: 'Cubs',       city: 'Chicago',       abbreviation: 'CHC', primaryColor: '#0E3386', secondaryColor: '#CC3433', division: 'NL Central' },
  { id: 6,  name: 'White Sox',  city: 'Chicago',       abbreviation: 'CWS', primaryColor: '#27251F', secondaryColor: '#C4CED4', division: 'AL Central' },
  { id: 7,  name: 'Reds',       city: 'Cincinnati',    abbreviation: 'CIN', primaryColor: '#C6011F', secondaryColor: '#000000', division: 'NL Central' },
  { id: 8,  name: 'Guardians',  city: 'Cleveland',     abbreviation: 'CLE', primaryColor: '#00385D', secondaryColor: '#E31937', division: 'AL Central' },
  { id: 9,  name: 'Rockies',    city: 'Colorado',      abbreviation: 'COL', primaryColor: '#33006F', secondaryColor: '#C4CED4', division: 'NL West' },
  { id: 10, name: 'Tigers',     city: 'Detroit',       abbreviation: 'DET', primaryColor: '#0C2340', secondaryColor: '#FA4616', division: 'AL Central' },
  { id: 11, name: 'Astros',     city: 'Houston',       abbreviation: 'HOU', primaryColor: '#002D62', secondaryColor: '#EB6E1F', division: 'AL West' },
  { id: 12, name: 'Royals',     city: 'Kansas City',   abbreviation: 'KC',  primaryColor: '#004687', secondaryColor: '#BD9B60', division: 'AL Central' },
  { id: 13, name: 'Angels',     city: 'Los Angeles',   abbreviation: 'LAA', primaryColor: '#BA0021', secondaryColor: '#003263', division: 'AL West' },
  { id: 14, name: 'Dodgers',    city: 'Los Angeles',   abbreviation: 'LAD', primaryColor: '#005A9C', secondaryColor: '#EF3E42', division: 'NL West' },
  { id: 15, name: 'Marlins',    city: 'Miami',         abbreviation: 'MIA', primaryColor: '#00A3E0', secondaryColor: '#EF3340', division: 'NL East' },
  { id: 16, name: 'Brewers',    city: 'Milwaukee',     abbreviation: 'MIL', primaryColor: '#FFC52F', secondaryColor: '#12284B', division: 'NL Central' },
  { id: 17, name: 'Twins',      city: 'Minnesota',     abbreviation: 'MIN', primaryColor: '#002B5C', secondaryColor: '#D31145', division: 'AL Central' },
  { id: 18, name: 'Mets',       city: 'New York',      abbreviation: 'NYM', primaryColor: '#002D72', secondaryColor: '#FF5910', division: 'NL East' },
  { id: 19, name: 'Yankees',    city: 'New York',      abbreviation: 'NYY', primaryColor: '#003087', secondaryColor: '#C4CED4', division: 'AL East' },
  { id: 20, name: 'Athletics',  city: 'Sacramento',    abbreviation: 'OAK', primaryColor: '#003831', secondaryColor: '#EFB21E', division: 'AL West' },
  { id: 21, name: 'Phillies',   city: 'Philadelphia',  abbreviation: 'PHI', primaryColor: '#E81828', secondaryColor: '#002D72', division: 'NL East' },
  { id: 22, name: 'Pirates',    city: 'Pittsburgh',    abbreviation: 'PIT', primaryColor: '#27251F', secondaryColor: '#FDB827', division: 'NL Central' },
  { id: 23, name: 'Padres',     city: 'San Diego',     abbreviation: 'SD',  primaryColor: '#2F241D', secondaryColor: '#FFC425', division: 'NL West' },
  { id: 24, name: 'Giants',     city: 'San Francisco', abbreviation: 'SF',  primaryColor: '#FD5A1E', secondaryColor: '#27251F', division: 'NL West' },
  { id: 25, name: 'Mariners',   city: 'Seattle',       abbreviation: 'SEA', primaryColor: '#0C2C56', secondaryColor: '#005C5C', division: 'AL West' },
  { id: 26, name: 'Cardinals',  city: 'St. Louis',     abbreviation: 'STL', primaryColor: '#C41E3A', secondaryColor: '#0C2340', division: 'NL Central' },
  { id: 27, name: 'Rays',       city: 'Tampa Bay',     abbreviation: 'TB',  primaryColor: '#092C5C', secondaryColor: '#8FBCE6', division: 'AL East' },
  { id: 28, name: 'Rangers',    city: 'Texas',         abbreviation: 'TEX', primaryColor: '#003278', secondaryColor: '#C0111F', division: 'AL West' },
  { id: 29, name: 'Blue Jays',  city: 'Toronto',       abbreviation: 'TOR', primaryColor: '#134A8E', secondaryColor: '#1D2D5C', division: 'AL East' },
  { id: 30, name: 'Nationals',  city: 'Washington',    abbreviation: 'WSH', primaryColor: '#AB0003', secondaryColor: '#14225A', division: 'NL East' },
];

export const MLB_DIVISIONS = {
  'AL East':    ['BAL', 'BOS', 'NYY', 'TB', 'TOR'],
  'AL Central': ['CWS', 'CLE', 'DET', 'KC', 'MIN'],
  'AL West':    ['HOU', 'LAA', 'OAK', 'SEA', 'TEX'],
  'NL East':    ['ATL', 'MIA', 'NYM', 'PHI', 'WSH'],
  'NL Central': ['CHC', 'CIN', 'MIL', 'PIT', 'STL'],
  'NL West':    ['ARI', 'COL', 'LAD', 'SD', 'SF'],
};

// 2025 Competitive Balance Tax (CBT) thresholds
export const CBT_THRESHOLDS = {
  first:  241.0,  // 20% penalty for first-time offenders, 30% for repeat
  second: 261.0,  // 32% (first-time) / 42% (repeat)
  third:  281.0,  // 62.5% (first-time) / 110% (repeat)
  fourth: 301.0,  // 80% surcharge additional
};

export const CBT_PENALTIES = {
  firstThreshold: {
    firstTime: 0.20,
    repeat: 0.30,
  },
  secondThreshold: {
    firstTime: 0.12,  // marginal rate on amount above first threshold
    repeat: 0.12,
  },
  thirdThreshold: {
    firstTime: 0.425,
    repeat: 0.45,
  },
};

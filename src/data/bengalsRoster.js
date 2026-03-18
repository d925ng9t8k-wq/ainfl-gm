// Last updated: March 18, 2026 — sourced from Over The Cap (overthecap.com)
// Cap figures reflect 2026 OTC projections
// deadMoney = dead cap if cut pre-June 1; capSavings = cap space saved if cut pre-June 1
// yearsRemaining = years AFTER current season (0 = final year). Display adds +1 for "including current season".
export const bengalsRoster = [
  // QUARTERBACKS
  { id: 1,  name: 'Joe Burrow',             position: 'QB', age: 29, capHit: 48.0,  contractYears: 5, contractTotal: 275.0, isFranchise: false, yearsRemaining: 3, deadMoney: 91.7, capSavings: -43.7, baseSalary: 25.3 },
  { id: 2,  name: 'Sean Clifford',           position: 'QB', age: 27, capHit: 1.0,   contractYears: 2, contractTotal: 2.2,   isFranchise: false, yearsRemaining: 0, deadMoney: 0, capSavings: 1.0, baseSalary: 1.0 },
  { id: 74, name: 'Josh Johnson',            position: 'QB', age: 40, capHit: 1.0,   contractYears: 1, contractTotal: 1.0,   isFranchise: false, yearsRemaining: 0, deadMoney: 0, capSavings: 1.0, baseSalary: 1.0, note: '*Cap hit estimated' },

  // RUNNING BACKS
  { id: 4,  name: 'Chase Brown',             position: 'RB', age: 25, capHit: 3.7,   contractYears: 4, contractTotal: 5.2,   isFranchise: false, yearsRemaining: 0, deadMoney: 0.1, capSavings: 3.7, baseSalary: 3.7 },
  { id: 5,  name: 'Samaje Perine',           position: 'RB', age: 30, capHit: 2.0,   contractYears: 1, contractTotal: 2.0,   isFranchise: false, yearsRemaining: 0, deadMoney: 0.2, capSavings: 1.8, baseSalary: 1.4 },
  { id: 6,  name: 'Tahj Brooks',             position: 'RB', age: 23, capHit: 1.1,   contractYears: 3, contractTotal: 2.4,   isFranchise: false, yearsRemaining: 2, deadMoney: 0.2, capSavings: 0.9, baseSalary: 1.0 },
  { id: 7,  name: 'Kendall Milton',          position: 'RB', age: 24, capHit: 1.0,   contractYears: 3, contractTotal: 2.4,   isFranchise: false, yearsRemaining: 0, deadMoney: 0, capSavings: 1.0, baseSalary: 1.0 },
  { id: 8,  name: 'Gary Brightwell',         position: 'RB', age: 28, capHit: 1.1,   contractYears: 1, contractTotal: 1.1,   isFranchise: false, yearsRemaining: 0, deadMoney: 0, capSavings: 1.1, baseSalary: 1.1 },

  // WIDE RECEIVERS
  { id: 9,  name: "Ja'Marr Chase",           position: 'WR', age: 26, capHit: 26.2,  contractYears: 4, contractTotal: 161.0, isFranchise: false, yearsRemaining: 3, deadMoney: 50.3, capSavings: -24.2, baseSalary: 17.7 },
  { id: 10, name: 'Tee Higgins',             position: 'WR', age: 27, capHit: 26.5,  contractYears: 4, contractTotal: 115.0, isFranchise: false, yearsRemaining: 2, deadMoney: 21.3, capSavings: 5.3, baseSalary: 10.9 },
  { id: 11, name: 'Charlie Jones',           position: 'WR', age: 27, capHit: 1.3,   contractYears: 2, contractTotal: 2.4,   isFranchise: false, yearsRemaining: 0, deadMoney: 0.2, capSavings: 1.1, baseSalary: 1.1 },
  { id: 12, name: 'Andrei Iosivas',          position: 'WR', age: 26, capHit: 3.7,   contractYears: 3, contractTotal: 3.0,   isFranchise: false, yearsRemaining: 0, deadMoney: 0, capSavings: 3.7, baseSalary: 3.7 },
  { id: 13, name: 'Mitchell Tinsley',        position: 'WR', age: 26, capHit: 1.1,   contractYears: 1, contractTotal: 1.1,   isFranchise: false, yearsRemaining: 0, deadMoney: 0, capSavings: 1.1, baseSalary: 1.1 },
  { id: 14, name: "Ke'Shawn Williams",       position: 'WR', age: 24, capHit: 1.0,   contractYears: 2, contractTotal: 1.6,   isFranchise: false, yearsRemaining: 0, deadMoney: 0, capSavings: 1.0, baseSalary: 1.0 },
  { id: 15, name: 'Xavier Johnson',          position: 'WR', age: 26, capHit: 0.9,   contractYears: 1, contractTotal: 0.9,   isFranchise: false, yearsRemaining: 0, deadMoney: 0, capSavings: 0.9, baseSalary: 0.9 },
  { id: 16, name: 'Kendric Pryor',           position: 'WR', age: 28, capHit: 1.1,   contractYears: 1, contractTotal: 1.1,   isFranchise: false, yearsRemaining: 0, deadMoney: 0, capSavings: 1.1, baseSalary: 1.1 },
  { id: 17, name: 'Jordan Moore',            position: 'WR', age: 23, capHit: 0.9,   contractYears: 3, contractTotal: 2.4,   isFranchise: false, yearsRemaining: 0, deadMoney: 0, capSavings: 0.9, baseSalary: 0.9 },
  { id: 70, name: 'Dohnte Meyers',           position: 'WR', age: 24, capHit: 0.9,   contractYears: 2, contractTotal: 1.6,   isFranchise: false, yearsRemaining: 2, deadMoney: 0, capSavings: 0.9, baseSalary: 0.9 },

  // TIGHT ENDS
  { id: 18, name: 'Mike Gesicki',            position: 'TE', age: 30, capHit: 7.6,   contractYears: 2, contractTotal: 13.0,  isFranchise: false, yearsRemaining: 1, deadMoney: 4.3, capSavings: 3.3, baseSalary: 3.1 },
  { id: 19, name: 'Drew Sample',             position: 'TE', age: 29, capHit: 2.9,   contractYears: 2, contractTotal: 6.4,   isFranchise: false, yearsRemaining: 0, deadMoney: 0, capSavings: 2.9, baseSalary: 2.6 },
  { id: 20, name: 'Tanner Hudson',           position: 'TE', age: 31, capHit: 1.1,   contractYears: 1, contractTotal: 1.1,   isFranchise: false, yearsRemaining: 0, deadMoney: 0.1, capSavings: 1.1, baseSalary: 1.3 },
  { id: 21, name: 'Cam Grandy',              position: 'TE', age: 26, capHit: 1.1,   contractYears: 2, contractTotal: 1.8,   isFranchise: false, yearsRemaining: 0, deadMoney: 0, capSavings: 1.1, baseSalary: 1.1 },
  { id: 69, name: 'Erick All',               position: 'TE', age: 24, capHit: 1.3,   contractYears: 2, contractTotal: 2.5,   isFranchise: false, yearsRemaining: 1, deadMoney: 0.4, capSavings: 0.9, baseSalary: 1.1 },

  // OFFENSIVE LINE
  { id: 22, name: 'Orlando Brown Jr.',       position: 'LT', age: 29, capHit: 19.3,  contractYears: 4, contractTotal: 66.0,  isFranchise: false, yearsRemaining: 2, deadMoney: 21.8, capSavings: -2.5, baseSalary: 3.5 },
  { id: 23, name: 'Amarius Mims',            position: 'RT', age: 23, capHit: 4.2,   contractYears: 4, contractTotal: 18.0,  isFranchise: false, yearsRemaining: 1, deadMoney: 9.1, capSavings: -4.9, baseSalary: 1.1 },
  { id: 24, name: 'Ted Karras',              position: 'C',  age: 33, capHit: 4.5,   contractYears: 2, contractTotal: 13.6,  isFranchise: false, yearsRemaining: 0, deadMoney: 0.5, capSavings: 4.0, baseSalary: 3.4 },
  { id: 25, name: 'Dylan Fairchild',         position: 'LG', age: 22, capHit: 1.5,   contractYears: 4, contractTotal: 3.6,   isFranchise: false, yearsRemaining: 2, deadMoney: 1.0, capSavings: 0.5, baseSalary: 1.1 },
  { id: 26, name: 'Dalton Risner',           position: 'RG', age: 30, capHit: 3.7,   contractYears: 1, contractTotal: 3.7,   isFranchise: false, yearsRemaining: 0, deadMoney: 1.0, capSavings: 2.7, baseSalary: 1.7 },
  { id: 27, name: 'Jalen Rivers',            position: 'OG', age: 23, capHit: 1.1,   contractYears: 3, contractTotal: 2.7,   isFranchise: false, yearsRemaining: 2, deadMoney: 0.3, capSavings: 0.8, baseSalary: 1.0 },
  { id: 28, name: 'Cody Ford',               position: 'OT', age: 29, capHit: 3.4,   contractYears: 1, contractTotal: 3.4,   isFranchise: false, yearsRemaining: 0, deadMoney: 0.5, capSavings: 2.9, baseSalary: 2.3 },
  { id: 29, name: 'Javon Foster',            position: 'OT', age: 25, capHit: 1.0,   contractYears: 2, contractTotal: 1.8,   isFranchise: false, yearsRemaining: 0, deadMoney: 0, capSavings: 1.0, baseSalary: 1.0 },
  { id: 30, name: 'Andrew Coker',            position: 'OT', age: 24, capHit: 0.9,   contractYears: 2, contractTotal: 1.6,   isFranchise: false, yearsRemaining: 0, deadMoney: 0, capSavings: 0.9, baseSalary: 0.9 },
  { id: 71, name: 'Matt Lee',                position: 'C',  age: 25, capHit: 1.1,   contractYears: 2, contractTotal: 1.8,   isFranchise: false, yearsRemaining: 1, deadMoney: 0.1, capSavings: 1.0, baseSalary: 1.1 },
  { id: 72, name: 'Jacob Bayer',             position: 'C',  age: 24, capHit: 0.9,   contractYears: 2, contractTotal: 1.6,   isFranchise: false, yearsRemaining: 0, deadMoney: 0, capSavings: 0.9, baseSalary: 0.9 },

  // DEFENSIVE LINE — pass rushers
  { id: 32, name: 'Myles Murphy',            position: 'DE', age: 24, capHit: 4.0,   contractYears: 4, contractTotal: 16.8,  isFranchise: false, yearsRemaining: 0, deadMoney: 4.0, capSavings: 0, baseSalary: 2.5 },
  { id: 33, name: 'Boye Mafe',               position: 'DE', age: 27, capHit: 17.0,  contractYears: 3, contractTotal: 40.5,  isFranchise: false, yearsRemaining: 2, deadMoney: 15.0, capSavings: 2.0, baseSalary: 7.4 },
  { id: 34, name: 'Shemar Stewart',          position: 'DE', age: 22, capHit: 4.3,   contractYears: 4, contractTotal: 11.2,  isFranchise: false, yearsRemaining: 2, deadMoney: 15.5, capSavings: -11.2, baseSalary: 1.0 },
  { id: 35, name: 'Isaiah Foskey',           position: 'DE', age: 25, capHit: 1.1,   contractYears: 2, contractTotal: 3.6,   isFranchise: false, yearsRemaining: 0, deadMoney: 0, capSavings: 1.1, baseSalary: 1.1 },
  { id: 36, name: 'Cedric Johnson',          position: 'DE', age: 23, capHit: 1.1,   contractYears: 3, contractTotal: 2.7,   isFranchise: false, yearsRemaining: 1, deadMoney: 0.1, capSavings: 1.0, baseSalary: 1.1 },
  { id: 37, name: 'Antwaun Powell-Ryland Jr.', position: 'DE', age: 24, capHit: 0.9, contractYears: 2, contractTotal: 1.8,   isFranchise: false, yearsRemaining: 1, deadMoney: 0, capSavings: 0.9, baseSalary: 0.9 },

  // DEFENSIVE TACKLES
  { id: 40, name: 'B.J. Hill',               position: 'DT', age: 30, capHit: 12.1,  contractYears: 2, contractTotal: 16.0,  isFranchise: false, yearsRemaining: 1, deadMoney: 7.3, capSavings: 4.8, baseSalary: 6.0 },
  { id: 41, name: 'Kris Jenkins Jr.',        position: 'DT', age: 24, capHit: 2.1,   contractYears: 4, contractTotal: 11.6,  isFranchise: false, yearsRemaining: 1, deadMoney: 2.3, capSavings: -0.1, baseSalary: 1.5 },
  { id: 42, name: 'McKinnley Jackson',       position: 'DT', age: 24, capHit: 1.5,   contractYears: 3, contractTotal: 4.5,   isFranchise: false, yearsRemaining: 1, deadMoney: 0.4, capSavings: 1.1, baseSalary: 1.3 },
  { id: 43, name: 'Tedarrell Slaton',        position: 'DT', age: 28, capHit: 8.9,   contractYears: 2, contractTotal: 17.8,  isFranchise: false, yearsRemaining: 0, deadMoney: 2.5, capSavings: 6.4, baseSalary: 5.7 },
  { id: 44, name: 'Jordan Jefferson',        position: 'DT', age: 24, capHit: 1.1,   contractYears: 2, contractTotal: 2.0,   isFranchise: false, yearsRemaining: 1, deadMoney: 0, capSavings: 1.1, baseSalary: 1.1 },
  { id: 45, name: 'Howard Cross III',        position: 'DT', age: 24, capHit: 1.0,   contractYears: 2, contractTotal: 1.8,   isFranchise: false, yearsRemaining: 0, deadMoney: 0, capSavings: 1.0, baseSalary: 1.0 },
  { id: 73, name: 'Jonathan Allen',          position: 'DT', age: 31, capHit: 5.5,   contractYears: 2, contractTotal: 26.0,  isFranchise: false, yearsRemaining: 1, deadMoney: 10.0, capSavings: -4.5, baseSalary: 2.0, note: '*Cap hit estimated — contract terms not yet fully disclosed by OTC' },

  // LINEBACKERS
  { id: 46, name: 'Demetrius Knight Jr.',    position: 'LB', age: 25, capHit: 2.0,   contractYears: 4, contractTotal: 7.2,   isFranchise: false, yearsRemaining: 3, deadMoney: 5.5, capSavings: -3.4, baseSalary: 1.2 },
  { id: 47, name: 'Barrett Carter',          position: 'LB', age: 23, capHit: 1.3,   contractYears: 4, contractTotal: 4.8,   isFranchise: false, yearsRemaining: 2, deadMoney: 0.7, capSavings: 0.5, baseSalary: 1.0 },
  { id: 48, name: 'Oren Burks',              position: 'LB', age: 30, capHit: 2.7,   contractYears: 1, contractTotal: 2.7,   isFranchise: false, yearsRemaining: 0, deadMoney: 0.4, capSavings: 2.3, baseSalary: 1.7 },
  { id: 49, name: 'Liam Anderson',           position: 'LB', age: 25, capHit: 1.0,   contractYears: 2, contractTotal: 1.8,   isFranchise: false, yearsRemaining: 0, deadMoney: 0, capSavings: 1.0, baseSalary: 1.0 },
  { id: 50, name: 'Shaka Heyward',           position: 'LB', age: 25, capHit: 1.1,   contractYears: 2, contractTotal: 1.8,   isFranchise: false, yearsRemaining: 0, deadMoney: 0, capSavings: 1.1, baseSalary: 1.1 },
  { id: 51, name: 'Joe Giles-Harris',        position: 'LB', age: 28, capHit: 1.2,   contractYears: 1, contractTotal: 1.2,   isFranchise: false, yearsRemaining: 0, deadMoney: 0, capSavings: 1.2, baseSalary: 12.1 },

  // CORNERBACKS
  { id: 52, name: 'Dax Hill',                position: 'CB', age: 25, capHit: 12.7,  contractYears: 3, contractTotal: 6.0,   isFranchise: false, yearsRemaining: 2, deadMoney: 12.7, capSavings: 0, baseSalary: 12.7 },
  { id: 53, name: 'DJ Turner II',            position: 'CB', age: 25, capHit: 4.0,   contractYears: 3, contractTotal: 3.6,   isFranchise: false, yearsRemaining: 2, deadMoney: 0.4, capSavings: 3.7, baseSalary: 3.7 },
  { id: 54, name: 'Josh Newton',             position: 'CB', age: 25, capHit: 1.2,   contractYears: 3, contractTotal: 3.0,   isFranchise: false, yearsRemaining: 1, deadMoney: 0.2, capSavings: 1.0, baseSalary: 1.1 },
  { id: 55, name: 'Jalen Davis',             position: 'CB', age: 30, capHit: 1.4,   contractYears: 1, contractTotal: 1.4,   isFranchise: false, yearsRemaining: 0, deadMoney: 0.1, capSavings: 1.3, baseSalary: 1.3 },
  { id: 56, name: 'D.J. Ivey',               position: 'CB', age: 26, capHit: 1.2,   contractYears: 2, contractTotal: 1.8,   isFranchise: false, yearsRemaining: 0, deadMoney: 0, capSavings: 1.2, baseSalary: 1.1 },
  { id: 57, name: 'Jalen Kimber',            position: 'CB', age: 25, capHit: 0.9,   contractYears: 2, contractTotal: 1.6,   isFranchise: false, yearsRemaining: 0, deadMoney: 0, capSavings: 0.9, baseSalary: 0.9 },
  { id: 58, name: 'Bralyn Lux',              position: 'CB', age: 25, capHit: 0.9,   contractYears: 3, contractTotal: 2.4,   isFranchise: false, yearsRemaining: 0, deadMoney: 0, capSavings: 0.9, baseSalary: 0.9 },

  // SAFETIES
  { id: 59, name: 'Bryan Cook',              position: 'S',  age: 26, capHit: 10.7,  contractYears: 3, contractTotal: 40.25, isFranchise: false, yearsRemaining: 2, deadMoney: 11.0, capSavings: -0.3, baseSalary: 3.4 },
  { id: 60, name: 'Jordan Battle',           position: 'S',  age: 25, capHit: 3.9,   contractYears: 3, contractTotal: 3.6,   isFranchise: false, yearsRemaining: 0, deadMoney: 0.2, capSavings: 3.7, baseSalary: 3.7 },
  { id: 63, name: 'Daijahn Anthony',         position: 'S',  age: 25, capHit: 1.1,   contractYears: 2, contractTotal: 1.6,   isFranchise: false, yearsRemaining: 1, deadMoney: 0.1, capSavings: 1.0, baseSalary: 1.1 },
  { id: 64, name: 'PJ Jules',                position: 'S',  age: 24, capHit: 1.0,   contractYears: 2, contractTotal: 1.6,   isFranchise: false, yearsRemaining: 1, deadMoney: 0, capSavings: 1.0, baseSalary: 1.0 },
  { id: 65, name: 'Russ Yeast',              position: 'S',  age: 26, capHit: 1.1,   contractYears: 1, contractTotal: 1.1,   isFranchise: false, yearsRemaining: 0, deadMoney: 0, capSavings: 1.1, baseSalary: 1.1 },

  // SPECIAL TEAMS
  { id: 66, name: 'Evan McPherson',          position: 'K',  age: 26, capHit: 5.0,   contractYears: 3, contractTotal: 13.5,  isFranchise: false, yearsRemaining: 1, deadMoney: 4.2, capSavings: 0.8, baseSalary: 2.8 },
  { id: 67, name: 'Ryan Rehkow',             position: 'P',  age: 27, capHit: 1.1,   contractYears: 3, contractTotal: 3.6,   isFranchise: false, yearsRemaining: 0, deadMoney: 0, capSavings: 1.1, baseSalary: 1.1 },
  { id: 68, name: 'William Wagner',          position: 'LS', age: 25, capHit: 1.0,   contractYears: 2, contractTotal: 1.8,   isFranchise: false, yearsRemaining: 1, deadMoney: 0, capSavings: 1.0, baseSalary: 1.0 },
];

// Dead cap charges for 2026 (departed players) — source: Over The Cap
export const deadCapCharges = [
  { name: 'Trey Hendrickson', reason: 'Trade/Release',   amount: 6.5 },
  { name: 'Logan Wilson',     reason: 'Release',          amount: 4.0 },
  { name: 'Jermaine Burton',  reason: 'Cut',              amount: 0.5 },
];

// 2026 Bengals cap summary (source: Over The Cap, March 2026)
export const capSummary = {
  totalCap: 301200000,       // 2026 NFL base salary cap
  capUsed: 274429338,        // Top 51 active roster cap hits (per OTC)
  deadCap:  11248222,        // Hendrickson + Wilson + Burton
  capSpace: 31302153,        // per OTC
};

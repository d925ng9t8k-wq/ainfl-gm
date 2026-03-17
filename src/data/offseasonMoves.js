// 2026 NFL Offseason Transactions — POST-2025 SEASON ONLY
// Only includes moves made after Super Bowl LX (February 2026)
// Free agency opened March 9, 2026 (legal tampering) / March 11 (new league year)
// Sources: ESPN, NFL.com, CBS Sports, Spotrac, SI.com, Bengals.com — verified March 16, 2026
export const preseasonMoves = {
  CIN: {
    signings: [
      { player: 'Boye Mafe', position: 'EDGE', previousTeam: 'Seahawks', aav: 20.0, years: 3, total: 60.0, guaranteed: 40.0, rating: 80, date: '2026-03-12' },
      { player: 'Jonathan Allen', position: 'DT', previousTeam: 'Vikings', aav: 13.0, years: 2, total: 26.0, guaranteed: 20.0, rating: 78, date: '2026-03-13', note: 'Up to $28M with incentives' },
      { player: 'Bryan Cook', position: 'S', previousTeam: 'Chiefs', aav: 13.4, years: 3, total: 40.25, guaranteed: 14.0, rating: 76, date: '2026-03-12' },
      { player: 'Josh Johnson', position: 'QB', previousTeam: 'Free Agent', aav: 1.0, years: 1, total: 1.0, guaranteed: 0.5, rating: 55, date: '2026-03-14' },
    ],
    extensions: [
      { player: 'Orlando Brown Jr.', position: 'OT', details: '2yr/$32M extension through 2028, $23M in first 12 months. Reduced 2026 cap hit from $22M to $19.2M (saved $2.7M). Negotiated without an agent.', date: '2026-03-12' },
    ],
    departures: [
      { player: 'Trey Hendrickson', position: 'DE', destination: 'Ravens', contract: '4yr/$112M, $60M guaranteed, up to $120M with incentives', date: '2026-03-11' },
    ],
    summary: 'Bengals replaced Trey Hendrickson (4yr/$112M to BAL) with Boye Mafe (3yr/$60M from SEA). Added Jonathan Allen (2yr/$26M) to the interior DL. Bryan Cook (3yr/$40.25M) returns home to Cincinnati to solidify the secondary. Extended Orlando Brown Jr. (2yr/$32M) for cap relief. Signed veteran backup QB Josh Johnson.',
  },

  // AFC EAST
  BUF: {
    trades: [
      { acquired: 'DJ Moore', position: 'WR', from: 'Bears', note: 'Sent 2026 2nd-round pick for Moore + 2026 5th' },
    ],
    signings: [
      { player: 'Darius Slay', position: 'CB', previousTeam: 'Eagles', aav: 5.0, years: 1, total: 5.0, guaranteed: 5.0, rating: 74 },
      { player: 'Bradley Chubb', position: 'DE', previousTeam: 'Dolphins', aav: 14.5, years: 3, total: 43.5, guaranteed: 29.0, rating: 78 },
      { player: 'CJ Gardner-Johnson', position: 'S', previousTeam: 'Bears', aav: 4.0, years: 1, total: 4.0, guaranteed: 4.0, rating: 75 },
      { player: 'Kyle Allen', position: 'QB', previousTeam: 'Free Agent', aav: 1.5, years: 1, total: 1.5, guaranteed: 1.0, rating: 60 },
    ],
    departures: [],
    summary: 'Bills traded a 2nd-round pick to Chicago for WR DJ Moore (+ a 5th back). Signed veteran CB Darius Slay (1yr), EDGE Bradley Chubb (3yr/$43.5M, $29M guaranteed from MIA), and S CJ Gardner-Johnson (1yr from CHI). Added backup QB Kyle Allen.',
  },
  MIA: {
    signings: [
      { player: 'Malik Willis', position: 'QB', previousTeam: 'Packers', aav: 5.0, years: 1, total: 5.0, guaranteed: 3.0, rating: 65 },
    ],
    trades: [],
    departures: [
      { player: 'Tua Tagovailoa', position: 'QB', destination: 'Free Agent', note: 'Released' },
      { player: 'Minkah Fitzpatrick', position: 'S', destination: 'Jets', note: 'Traded for 2026 7th-round pick' },
      { player: 'Bradley Chubb', position: 'DE', destination: 'Bills', note: 'Signed in free agency (3yr/$43.5M)' },
    ],
    summary: 'Dolphins released Tua Tagovailoa and signed Malik Willis from GB as replacement. Traded Minkah Fitzpatrick to NYJ for a 7th. Lost Bradley Chubb to Buffalo in free agency.',
  },
  NE: {
    signings: [
      { player: 'Kevin Byard', position: 'S', previousTeam: 'Bears', aav: 9.0, years: 1, total: 9.0, guaranteed: 9.0, rating: 80 },
      { player: 'Romeo Doubs', position: 'WR', previousTeam: 'Packers', aav: 20.0, years: 4, total: 80.0, guaranteed: 40.0, rating: 79, note: 'Up to $80M' },
      { player: "Dre'Mont Jones", position: 'DE', previousTeam: 'Free Agent', aav: 13.17, years: 3, total: 39.5, guaranteed: 14.5, rating: 78, note: '$14.5M in Year 1' },
      { player: 'Alijah Vera-Tucker', position: 'G', previousTeam: 'Jets', aav: 8.0, years: 2, total: 16.0, guaranteed: 10.0, rating: 75 },
    ],
    trades: [],
    departures: [
      { player: 'Garrett Bradbury', position: 'C', destination: 'Bears', note: 'Traded for 2027 5th-round pick' },
    ],
    summary: "Patriots made significant additions: signed S Kevin Byard (1yr/$9M from CHI), WR Romeo Doubs (4yr up to $80M from GB), DE Dre'Mont Jones (3yr/$39.5M, $14.5M in Year 1), and G Alijah Vera-Tucker (2yr/$16M from NYJ). Traded C Garrett Bradbury to Chicago for a 2027 5th.",
  },
  NYJ: {
    signings: [
      { player: 'Demario Davis', position: 'LB', previousTeam: 'Saints', aav: 6.0, years: 1, total: 6.0, guaranteed: 4.0, rating: 76 },
      { player: 'Geno Smith', position: 'QB', previousTeam: 'Raiders', aav: 6.5, years: 1, total: 6.5, guaranteed: 6.5, rating: 71 },
    ],
    trades: [
      { acquired: 'Minkah Fitzpatrick', position: 'S', from: 'Dolphins', note: 'Sent 2026 7th-round pick; Fitzpatrick signs 3yr/$40M extension' },
    ],
    extensions: [
      { player: 'Minkah Fitzpatrick', position: 'S', details: '3yr/$40M extension upon acquisition from MIA' },
    ],
    departures: [
      { player: 'Justin Fields', position: 'QB', destination: 'Chiefs', note: 'Traded for 2027 6th-round pick' },
    ],
    summary: 'Jets signed LB Demario Davis and QB Geno Smith (1yr/$6.5M). Acquired S Minkah Fitzpatrick from Miami (3yr/$40M extension). Traded Justin Fields to KC for a 2027 6th.',
  },

  // AFC NORTH
  BAL: {
    signings: [
      { player: 'Trey Hendrickson', position: 'DE', previousTeam: 'Bengals', aav: 28.0, years: 4, total: 112.0, guaranteed: 60.0, rating: 90, date: '2026-03-11', note: 'Up to $120M with incentives, $20M signing bonus' },
    ],
    departures: [
      { player: 'Isaiah Likely', position: 'TE', destination: 'Giants', note: 'Signed in free agency (3yr/$24M)' },
    ],
    summary: 'Ravens landed Trey Hendrickson on a 4-year, $112M deal ($60M guaranteed, up to $120M) after a failed Maxx Crosby trade fell apart. Lost TE Isaiah Likely to the Giants.',
  },
  CLE: {
    signings: [
      { player: 'Zion Johnson', position: 'G', previousTeam: 'Chargers', aav: 16.5, years: 3, total: 49.5, guaranteed: 32.4, rating: 79 },
      { player: 'Elgton Jenkins', position: 'G', previousTeam: 'Packers', aav: 12.0, years: 2, total: 24.0, guaranteed: 20.0, rating: 77 },
      { player: 'Quincy Williams', position: 'LB', previousTeam: 'Jets', aav: 17.0, years: 2, total: 34.0, guaranteed: 22.0, rating: 74, note: 'Up to $17M/yr' },
      { player: 'Wyatt Teller', position: 'G', previousTeam: 'Browns', aav: 10.0, years: 2, total: 20.0, guaranteed: 14.0, rating: 80, note: 'Re-signed' },
      { player: 'Teven Jenkins', position: 'OG', previousTeam: 'Browns', aav: 3.0, years: 1, total: 3.0, guaranteed: 1.5, rating: 68, note: 'Re-sign' },
      { player: 'Jack Stoll', position: 'TE', previousTeam: 'Free Agent', aav: 1.5, years: 1, total: 1.5, guaranteed: 0.75, rating: 60 },
    ],
    trades: [
      { acquired: 'Tytus Howard', position: 'OT', from: 'Texans', note: 'Traded for from HOU' },
    ],
    departures: [],
    summary: 'Browns invested heavily in the offensive line: signed G Zion Johnson (3yr/$49.5M, $32.4M gtd), G Elgton Jenkins (2yr/$24M, $20M gtd), re-signed G Wyatt Teller and OG Teven Jenkins, and traded for OT Tytus Howard from HOU. Added LB Quincy Williams (2yr, up to $17M/yr) and TE Jack Stoll.',
  },
  PIT: {
    trades: [
      { acquired: 'Michael Pittman Jr.', position: 'WR', from: 'Colts', note: 'Late-round picks swap; signed to 3yr extension' },
    ],
    signings: [
      { player: 'Jaquan Brisker', position: 'S', previousTeam: 'Bears', aav: 5.5, years: 1, total: 5.5, guaranteed: 5.5, rating: 76 },
      { player: 'Jamel Dean', position: 'CB', previousTeam: 'Buccaneers', aav: 12.25, years: 3, total: 36.75, guaranteed: 25.0, rating: 74 },
      { player: 'Rico Dowdle', position: 'RB', previousTeam: 'Cowboys', aav: 4.0, years: 2, total: 8.0, guaranteed: 5.0, rating: 72 },
      { player: 'Asante Samuel Jr.', position: 'CB', previousTeam: 'Steelers', aav: 3.0, years: 1, total: 3.0, guaranteed: 2.0, rating: 68, note: 'Re-sign' },
      { player: 'Cole Holcomb', position: 'LB', previousTeam: 'Free Agent', aav: 4.0, years: 2, total: 8.0, guaranteed: 5.0, rating: 68 },
      { player: 'Cameron Johnston', position: 'P', previousTeam: 'Free Agent', aav: 1.5, years: 1, total: 1.5, guaranteed: 1.0, rating: 62 },
    ],
    extensions: [
      { player: 'Michael Pittman Jr.', position: 'WR', details: '3yr extension upon acquisition from IND' },
    ],
    departures: [
      { player: 'Kyle Dugger', position: 'S', destination: 'Free Agent', note: 'Released' },
      { player: 'Minkah Fitzpatrick', position: 'S', destination: 'Jets', note: 'Previously traded to MIA, then to NYJ' },
      { player: 'Kenny Gainwell', position: 'RB', destination: 'Buccaneers', note: 'Signed in free agency' },
      { player: 'Isaac Seumalo', position: 'G', destination: 'Cardinals', note: 'Signed in free agency' },
      { player: 'Calvin Austin', position: 'WR', destination: 'Giants', note: 'Signed in free agency' },
    ],
    summary: 'Steelers acquired WR Michael Pittman Jr. from IND (late-round swap, signed to 3yr extension). Signed S Jaquan Brisker (1yr/$5.5M from CHI), CB Jamel Dean (3yr/$36.75M), RB Rico Dowdle, re-signed CB Asante Samuel Jr., added LB Cole Holcomb and P Cameron Johnston. Lost S Kyle Dugger (released), RB Kenny Gainwell (TB), G Isaac Seumalo (ARI), and WR Calvin Austin (NYG).',
  },

  // AFC SOUTH
  HOU: {
    trades: [
      { acquired: 'David Montgomery', position: 'RB', from: 'Lions', note: 'Sent 2026 R4 + Juice Scruggs + 2026 R7 (Montgomery originally DET/CHI)' },
    ],
    signings: [
      { player: 'Reed Blankenship', position: 'S', previousTeam: 'Eagles', aav: 7.5, years: 3, total: 22.5, guaranteed: 14.0, rating: 76 },
      { player: 'Braden Smith', position: 'OT', previousTeam: 'Colts', aav: 12.0, years: 3, total: 36.0, guaranteed: 22.0, rating: 77 },
      { player: 'Logan Hall', position: 'DT', previousTeam: 'Buccaneers', aav: 5.0, years: 2, total: 10.0, guaranteed: 6.0, rating: 70 },
      { player: 'Foster Moreau', position: 'TE', previousTeam: 'Free Agent', aav: 3.0, years: 1, total: 3.0, guaranteed: 2.0, rating: 66 },
    ],
    departures: [],
    summary: 'Texans traded for RB David Montgomery (from DET for R4, Juice Scruggs, R7). Signed S Reed Blankenship (PHI), OT Braden Smith, DT Logan Hall, and TE Foster Moreau.',
  },
  IND: {
    signings: [
      { player: 'Micheal Clemons', position: 'DE', previousTeam: 'Jets', aav: 5.5, years: 2, total: 11.0, guaranteed: 7.0, rating: 70 },
      { player: 'Arden Key', position: 'DE', previousTeam: 'Free Agent', aav: 10.0, years: 2, total: 20.0, guaranteed: 14.0, rating: 75 },
    ],
    extensions: [
      { player: 'Alec Pierce', position: 'WR', details: '4yr/$114M extension' },
      { player: 'Daniel Jones', position: 'QB', details: '2yr/$88M extension, up to $100M with incentives, $60M+ guaranteed' },
    ],
    trades: [
      { sent: 'Michael Pittman Jr.', position: 'WR', to: 'Steelers', note: 'Traded for late-round picks swap' },
      { sent: 'Zaire Franklin', position: 'LB', to: 'Packers', note: 'Traded for DT Wooden' },
    ],
    departures: [
      { player: 'Michael Pittman Jr.', position: 'WR', destination: 'Steelers', note: 'Traded for late-round picks swap' },
      { player: 'Kwity Paye', position: 'DE', destination: 'Raiders', note: 'Signed in free agency' },
      { player: 'Zaire Franklin', position: 'LB', destination: 'Packers', note: 'Traded for DT Wooden' },
      { player: 'Braden Smith', position: 'OT', destination: 'Texans', note: 'Signed in free agency' },
      { player: 'Nick Cross', position: 'S', destination: 'Commanders', note: 'Signed in free agency' },
    ],
    summary: 'Colts extended WR Alec Pierce (4yr/$114M) and QB Daniel Jones (2yr/$88M, up to $100M, $60M+ gtd). Added DE Arden Key (2yr/$20M) and DE Micheal Clemons. Traded WR Michael Pittman Jr. to PIT and LB Zaire Franklin to GB. Lost DE Kwity Paye (LV), OT Braden Smith (HOU), and S Nick Cross (WSH).',
  },
  JAX: {
    signings: [
      { player: 'Montaric Brown', position: 'CB', previousTeam: 'Jaguars', aav: 11.0, years: 3, total: 33.0, guaranteed: 22.0, rating: 68, note: 'Re-signed' },
      { player: 'Dennis Gardeck', position: 'DE', previousTeam: 'Cardinals', aav: 4.5, years: 2, total: 9.0, guaranteed: 5.0, rating: 70 },
      { player: 'Chris Rodriguez Jr.', position: 'RB', previousTeam: 'Free Agent', aav: 2.0, years: 1, total: 2.0, guaranteed: 1.0, rating: 63 },
      { player: 'DeeJay Dallas', position: 'RB', previousTeam: 'Free Agent', aav: 1.3, years: 1, total: 1.3, guaranteed: 0.65, rating: 58 },
      { player: 'Matt Dickerson', position: 'DT', previousTeam: 'Free Agent', aav: 1.5, years: 1, total: 1.5, guaranteed: 0.75, rating: 60 },
      { player: 'Quintin Morris', position: 'TE', previousTeam: 'Jaguars', aav: 1.2, years: 1, total: 1.2, guaranteed: 0.6, rating: 58, note: 'Re-sign' },
    ],
    departures: [
      { player: 'Travis Etienne', position: 'RB', destination: 'Saints', note: 'Signed 4yr/$52M, $28M gtd' },
      { player: 'Devin Lloyd', position: 'LB', destination: 'Panthers', note: 'Signed 3yr/$45M, $30M gtd' },
    ],
    summary: 'Jaguars re-signed CB Montaric Brown (3yr/$33M). Added DE Dennis Gardeck, RBs Chris Rodriguez Jr. and DeeJay Dallas, DT Matt Dickerson, and re-signed TE Quintin Morris. Lost RB Travis Etienne (NO, 4yr/$52M) and LB Devin Lloyd (CAR, 3yr/$45M).',
  },
  TEN: {
    signings: [
      { player: "Wan'Dale Robinson", position: 'WR', previousTeam: 'Giants', aav: 19.5, years: 4, total: 78.0, guaranteed: 38.0, rating: 79 },
      { player: 'John Franklin-Myers', position: 'DT', previousTeam: 'Jets', aav: 7.0, years: 2, total: 14.0, guaranteed: 9.0, rating: 74 },
      { player: 'Mitchell Trubisky', position: 'QB', previousTeam: 'Free Agent', aav: 2.5, years: 1, total: 2.5, guaranteed: 1.5, rating: 62 },
      { player: 'Alontae Taylor', position: 'CB', previousTeam: 'Saints', aav: 5.0, years: 2, total: 10.0, guaranteed: 6.0, rating: 72 },
      { player: 'Cordale Flott', position: 'CB', previousTeam: 'Giants', aav: 2.5, years: 1, total: 2.5, guaranteed: 1.5, rating: 63 },
      { player: 'Daniel Bellinger', position: 'TE', previousTeam: 'Giants', aav: 3.5, years: 2, total: 7.0, guaranteed: 4.0, rating: 66 },
    ],
    departures: [],
    summary: "Titans signed WR Wan'Dale Robinson (4yr/$78M, $38M gtd) as their top addition. Added DT John Franklin-Myers, CB Alontae Taylor, CB Cordale Flott, TE Daniel Bellinger, and backup QB Mitchell Trubisky.",
  },

  // AFC WEST
  DEN: {
    signings: [
      { player: 'J.K. Dobbins', position: 'RB', previousTeam: 'Broncos', aav: 8.0, years: 2, total: 16.0, guaranteed: 12.0, rating: 75, note: 'Re-signing, up to $20M with incentives' },
      { player: 'Dre Greenlaw', position: 'LB', previousTeam: '49ers', aav: 5.0, years: 2, total: 10.0, guaranteed: 6.0, rating: 74 },
      { player: 'Alex Singleton', position: 'LB', previousTeam: 'Broncos', aav: 7.75, years: 2, total: 15.5, guaranteed: 11.0, rating: 68, note: 'Re-sign' },
      { player: 'Justin Strnad', position: 'LB', previousTeam: 'Broncos', aav: 6.5, years: 3, total: 19.5, guaranteed: 10.0, rating: 70, note: 'Re-sign' },
      { player: 'Adam Trautman', position: 'TE', previousTeam: 'Broncos', aav: 3.0, years: 3, total: 9.0, guaranteed: 5.0, rating: 65, note: 'Re-sign' },
      { player: 'Jaleel McLaughlin', position: 'RB', previousTeam: 'Broncos', aav: 1.5, years: 1, total: 1.5, guaranteed: 0.75, rating: 63, note: 'Re-sign' },
      { player: "Lil'Jordan Humphrey", position: 'WR', previousTeam: 'Broncos', aav: 1.5, years: 1, total: 1.5, guaranteed: 0.75, rating: 60, note: 'Re-sign' },
      { player: 'Sam Ehlinger', position: 'QB', previousTeam: 'Broncos', aav: 1.2, years: 1, total: 1.2, guaranteed: 0.6, rating: 55, note: 'Re-sign' },
    ],
    extensions: [
      { player: 'Quinn Meinerz', position: 'OG', details: 'Restructured contract, freed $11M in cap space' },
    ],
    departures: [],
    summary: 'Broncos re-signed RB J.K. Dobbins (2yr/$16M, up to $20M with incentives) and LBs Dre Greenlaw, Alex Singleton (2yr/$15.5M, $11M gtd), and Justin Strnad (3yr/$19.5M, $10M gtd). Re-signed TE Adam Trautman, RB Jaleel McLaughlin, WR Lil\'Jordan Humphrey, and QB Sam Ehlinger. Restructured OG Quinn Meinerz\'s contract to free $11M in cap space.',
  },
  KC: {
    trades: [
      { acquired: 'Justin Fields', position: 'QB', from: 'Jets', note: 'Sent 2027 6th-round pick', date: '2026-03-16' },
    ],
    signings: [
      { player: 'Kenneth Walker III', position: 'RB', previousTeam: 'Seahawks', aav: 8.0, years: 2, total: 16.0, guaranteed: 10.0, rating: 78 },
      { player: 'Leo Chenal', position: 'LB', previousTeam: 'Chiefs', aav: 5.0, years: 2, total: 10.0, guaranteed: 6.0, rating: 73, note: 'Re-sign' },
      { player: 'Alohi Gilman', position: 'S', previousTeam: 'Chargers', aav: 4.5, years: 2, total: 9.0, guaranteed: 5.0, rating: 71 },
    ],
    departures: [
      { player: 'Trent McDuffie', position: 'CB', destination: 'Rams', note: 'Traded for 2026 R1 (#29), R5, R6 + 2027 R3' },
    ],
    summary: 'Chiefs traded for Justin Fields from the Jets (for a 2027 6th). Signed RB Kenneth Walker III, re-signed LB Leo Chenal, added S Alohi Gilman. Lost CB Trent McDuffie to the Rams in a blockbuster trade.',
  },
  LV: {
    signings: [
      { player: 'Tyler Linderbaum', position: 'C', previousTeam: 'Ravens', aav: 27.0, years: 3, total: 81.0, guaranteed: 60.0, rating: 88, note: 'Highest-paid center in NFL history' },
      { player: 'Quay Walker', position: 'LB', previousTeam: 'Packers', aav: 8.0, years: 3, total: 24.0, guaranteed: 15.0, rating: 76 },
      { player: 'Kwity Paye', position: 'DE', previousTeam: 'Colts', aav: 8.0, years: 2, total: 16.0, guaranteed: 10.0, rating: 75 },
      { player: 'Malcolm Koonce', position: 'DE', previousTeam: 'Raiders', aav: 5.0, years: 2, total: 10.0, guaranteed: 6.0, rating: 72, note: 'Re-sign' },
      { player: 'Nakobe Dean', position: 'LB', previousTeam: 'Eagles', aav: 4.0, years: 2, total: 8.0, guaranteed: 5.0, rating: 71 },
      { player: 'Eric Stokes', position: 'CB', previousTeam: 'Packers', aav: 3.5, years: 1, total: 3.5, guaranteed: 2.0, rating: 66 },
    ],
    departures: [
      { player: 'Alex Cappa', position: 'OG', destination: 'Free Agent', note: 'Released March 6, 2026' },
    ],
    summary: 'Raiders made C Tyler Linderbaum the highest-paid center ever (3yr/$81M, $60M gtd). Added LB Quay Walker, DE Kwity Paye, re-signed DE Malcolm Koonce, signed LB Nakobe Dean and CB Eric Stokes. Released OG Alex Cappa.',
  },
  LAC: {
    signings: [
      { player: 'Tyler Biadasz', position: 'C', previousTeam: 'Commanders', aav: 8.0, years: 2, total: 16.0, guaranteed: 10.0, rating: 76 },
      { player: 'Cole Strange', position: 'G', previousTeam: 'Patriots', aav: 5.0, years: 2, total: 10.0, guaranteed: 6.0, rating: 70 },
      { player: 'Trevor Penning', position: 'G', previousTeam: 'Saints', aav: 4.5, years: 2, total: 9.0, guaranteed: 5.0, rating: 68 },
      { player: 'Trey Lance', position: 'QB', previousTeam: 'Chargers', aav: 3.0, years: 1, total: 3.0, guaranteed: 2.0, rating: 64, note: 'Re-signed' },
      { player: 'Charlie Kolar', position: 'TE', previousTeam: 'Ravens', aav: 3.0, years: 2, total: 6.0, guaranteed: 3.5, rating: 67 },
      { player: 'Keaton Mitchell', position: 'RB', previousTeam: 'Ravens', aav: 2.0, years: 1, total: 2.0, guaranteed: 1.0, rating: 65 },
    ],
    departures: [],
    summary: 'Chargers rebuilt their offensive line with C Tyler Biadasz, G Cole Strange, and G Trevor Penning. Re-signed QB Trey Lance, added TE Charlie Kolar and RB Keaton Mitchell.',
  },

  // NFC EAST
  DAL: {
    trades: [
      { acquired: 'Rashan Gary', position: 'DE', from: 'Packers', note: 'Trade' },
      { sent: 'Solomon Thomas', position: 'DT', to: 'Titans', note: '7th round swap' },
      { sent: 'Osa Odighizuwa', position: 'DT', to: '49ers', note: 'Traded for 2026 R3 #92' },
    ],
    signings: [
      { player: 'Jalen Thompson', position: 'S', previousTeam: 'Cardinals', aav: 7.0, years: 2, total: 14.0, guaranteed: 9.0, rating: 76 },
      { player: 'Sam Howell', position: 'QB', previousTeam: 'Seahawks', aav: 2.5, years: 1, total: 2.5, guaranteed: 1.5, rating: 63 },
      { player: 'Sam Williams', position: 'DE', previousTeam: 'Cowboys', aav: 4.0, years: 2, total: 8.0, guaranteed: 5.0, rating: 68, note: 'Re-sign' },
      { player: 'Otito Ogbonnia', position: 'DT', previousTeam: 'Chargers', aav: 2.0, years: 1, total: 2.0, guaranteed: 1.0, rating: 63 },
    ],
    extensions: [
      { player: 'Javonte Williams', position: 'RB', details: '3yr/$24M extension' },
    ],
    departures: [
      { player: 'Logan Wilson', position: 'LB', destination: 'Free Agent', note: 'Released Feb 20, 2026 — saved $6.5M cap' },
      { player: 'Osa Odighizuwa', position: 'DT', destination: '49ers', note: 'Traded for 2026 R3 #92' },
      { player: 'Solomon Thomas', position: 'DT', destination: 'Titans', note: 'Traded, 7th round swap' },
    ],
    summary: 'Cowboys acquired Rashan Gary from Green Bay via trade. Signed S Jalen Thompson (from ARI), backup QB Sam Howell, re-signed DE Sam Williams, and added DT Otito Ogbonnia (from LAC). Extended RB Javonte Williams (3yr/$24M). Traded DT Osa Odighizuwa to SF for R3 #92 and DT Solomon Thomas to TEN. Released Logan Wilson (saving $6.5M).',
  },
  NYG: {
    signings: [
      { player: 'Isaiah Likely', position: 'TE', previousTeam: 'Ravens', aav: 8.0, years: 3, total: 24.0, guaranteed: 15.0, rating: 78 },
      { player: 'Jermaine Eluemunor', position: 'OT', previousTeam: 'Texans', aav: 10.0, years: 3, total: 30.0, guaranteed: 18.0, rating: 77 },
      { player: 'Tremaine Edmunds', position: 'LB', previousTeam: 'Bears', aav: 8.0, years: 2, total: 16.0, guaranteed: 10.0, rating: 76 },
      { player: 'Greg Newsome II', position: 'CB', previousTeam: 'Free Agent', aav: 8.0, years: 1, total: 8.0, guaranteed: 3.0, rating: 74 },
      { player: 'Patrick Ricard', position: 'FB', previousTeam: 'Free Agent', aav: 3.82, years: 2, total: 7.63, guaranteed: 4.0, rating: 68 },
      { player: 'Micah McFadden', position: 'LB', previousTeam: 'Giants', aav: 3.5, years: 2, total: 7.0, guaranteed: 4.0, rating: 68, note: 'Re-sign' },
      { player: 'Calvin Austin III', position: 'WR', previousTeam: 'Steelers', aav: 1.5, years: 1, total: 1.5, guaranteed: 1.0, rating: 66, note: 'Up to $4.5M' },
      { player: 'Jason Sanders', position: 'K', previousTeam: 'Free Agent', aav: 2.0, years: 1, total: 2.0, guaranteed: 1.0, rating: 72 },
      { player: 'Jordan Stout', position: 'P', previousTeam: 'Free Agent', aav: 3.5, years: 1, total: 3.5, guaranteed: 2.0, rating: 70, note: 'Highest-paid punter' },
      { player: 'Evan Neal', position: 'OL', previousTeam: 'Giants', aav: 3.0, years: 1, total: 3.0, guaranteed: 1.5, rating: 64, note: 'Re-sign' },
      { player: 'Isaiah Hodgins', position: 'WR', previousTeam: 'Giants', aav: 2.0, years: 1, total: 2.0, guaranteed: 1.0, rating: 63, note: 'Re-sign' },
    ],
    departures: [
      { player: "Wan'Dale Robinson", position: 'WR', destination: 'Titans', note: 'Signed 4yr/$78M' },
      { player: 'Bobby Okereke', position: 'LB', destination: 'Free Agent', note: 'Released' },
    ],
    summary: "Giants signed TE Isaiah Likely (3yr/$24M from BAL), OT Jermaine Eluemunor, LB Tremaine Edmunds, CB Greg Newsome II (1yr/$8M, $3M gtd), FB Patrick Ricard (2yr/$7.63M), WR Calvin Austin III (1yr/$1.5M up to $4.5M from PIT), K Jason Sanders, P Jordan Stout (highest-paid punter), and re-signed LB Micah McFadden, OL Evan Neal, and WR Isaiah Hodgins. Lost WR Wan'Dale Robinson (TEN, 4yr/$78M) and released LB Bobby Okereke.",
  },
  PHI: {
    signings: [
      { player: 'Tariq Woolen', position: 'CB', previousTeam: 'Seahawks', aav: 7.0, years: 1, total: 7.0, guaranteed: 5.0, rating: 76 },
    ],
    extensions: [
      { player: 'Dallas Goedert', position: 'TE', details: '1-year extension' },
      { player: 'Jordan Davis', position: 'DT', details: '3yr/$78M, $65M guaranteed' },
    ],
    departures: [],
    summary: 'Eagles re-signed TE Dallas Goedert (1yr extension) and extended DT Jordan Davis (3yr/$78M, $65M guaranteed). Signed CB Tariq Woolen (1yr) from Seattle.',
  },
  WSH: {
    signings: [
      { player: 'Amik Robertson', position: 'CB', previousTeam: 'Raiders', aav: 8.0, years: 2, total: 16.0, guaranteed: 10.0, rating: 73 },
      { player: 'Marcus Mariota', position: 'QB', previousTeam: 'Free Agent', aav: 2.5, years: 1, total: 2.5, guaranteed: 1.5, rating: 63 },
      { player: 'Tim Settle', position: 'DT', previousTeam: 'Bills', aav: 5.0, years: 2, total: 10.0, guaranteed: 6.0, rating: 71 },
      { player: 'Nick Cross', position: 'S', previousTeam: 'Colts', aav: 3.5, years: 2, total: 7.0, guaranteed: 4.0, rating: 67 },
      { player: 'Leo Chenal', position: 'LB', previousTeam: 'Chiefs', aav: 5.0, years: 2, total: 10.0, guaranteed: 6.0, rating: 73 },
      { player: 'Charles Omenihu', position: 'DE', previousTeam: '49ers', aav: 6.0, years: 2, total: 12.0, guaranteed: 7.0, rating: 74 },
    ],
    departures: [],
    summary: 'Commanders signed CB Amik Robertson (2yr/$16M), DE Charles Omenihu, LB Leo Chenal, DT Tim Settle, S Nick Cross, and backup QB Marcus Mariota. Added depth across the defense.',
  },

  // NFC NORTH
  CHI: {
    trades: [
      { acquired: 'Garrett Bradbury', position: 'C', from: 'Patriots', note: 'Traded for 2027 5th-round pick' },
    ],
    signings: [
      { player: 'Coby Bryant', position: 'CB', previousTeam: 'Seahawks', aav: 13.3, years: 3, total: 40.0, guaranteed: 28.0, rating: 70 },
      { player: 'Devin Bush', position: 'LB', previousTeam: 'Free Agent', aav: 10.0, years: 3, total: 30.0, guaranteed: 15.0, rating: 70 },
      { player: 'Neville Gallimore', position: 'DT', previousTeam: 'Cowboys', aav: 4.0, years: 2, total: 8.0, guaranteed: 5.0, rating: 68 },
      { player: 'Braxton Jones', position: 'OT', previousTeam: 'Bears', aav: 6.0, years: 3, total: 18.0, guaranteed: 10.0, rating: 72, note: 'Re-sign' },
      { player: 'Jedrick Wills', position: 'OT', previousTeam: 'Free Agent', aav: 5.0, years: 1, total: 5.0, guaranteed: 3.0, rating: 68 },
      { player: 'Cam Lewis', position: 'CB', previousTeam: 'Bills', aav: 3.0, years: 2, total: 6.0, guaranteed: 3.0, rating: 65 },
      { player: 'Kentavius Street', position: 'DE', previousTeam: 'Free Agent', aav: 3.0, years: 1, total: 3.0, guaranteed: 1.5, rating: 65 },
      { player: "D'Marco Jackson", position: 'LB', previousTeam: 'Bears', aav: 3.75, years: 2, total: 7.5, guaranteed: 4.0, rating: 66, note: 'Re-sign' },
      { player: 'Kalif Raymond', position: 'WR', previousTeam: 'Lions', aav: 2.5, years: 1, total: 2.5, guaranteed: 1.5, rating: 64 },
      { player: 'Case Keenum', position: 'QB', previousTeam: 'Free Agent', aav: 2.75, years: 2, total: 5.5, guaranteed: 3.0, rating: 58, note: 'Up to $8M' },
    ],
    departures: [
      { player: 'DJ Moore', position: 'WR', destination: 'Bills', note: 'Traded for 2026 2nd-round pick (sent Moore + 5th)' },
      { player: 'Kevin Byard', position: 'S', destination: 'Patriots', note: 'Signed 1yr/$9M' },
      { player: 'Jaquan Brisker', position: 'S', destination: 'Steelers', note: 'Signed 1yr/$5.5M' },
      { player: 'CJ Gardner-Johnson', position: 'S', destination: 'Bills', note: 'Signed 1yr' },
      { player: 'Durham Smythe', position: 'TE', destination: 'Ravens', note: 'Signed in free agency' },
      { player: 'Johnathan Owens', position: 'S', destination: 'Colts', note: 'Signed in free agency' },
    ],
    summary: "Bears traded WR DJ Moore to BUF for a 2nd-round pick. Acquired C Garrett Bradbury from NE for a 2027 5th. Signed CB Coby Bryant (3yr/$40M), LB Devin Bush (3yr/$30M), OT Jedrick Wills, CB Cam Lewis (2yr from BUF), DE Kentavius Street, re-signed LB D'Marco Jackson (2yr/$7.5M), OT Braxton Jones, WR Kalif Raymond, and QB Case Keenum (2yr/$5.5M, up to $8M). Lost S Kevin Byard (NE), S Jaquan Brisker (PIT), S CJ Gardner-Johnson (BUF), TE Durham Smythe (BAL), and S Johnathan Owens (IND).",
  },
  DET: {
    signings: [
      { player: 'Isiah Pacheco', position: 'RB', previousTeam: 'Chiefs', aav: 1.81, years: 1, total: 1.81, guaranteed: 1.81, rating: 77 },
      { player: 'Cade Mays', position: 'C', previousTeam: 'Free Agent', aav: 8.33, years: 3, total: 25.0, guaranteed: 15.0, rating: 64 },
      { player: 'Tyler Conklin', position: 'TE', previousTeam: 'Free Agent', aav: 5.0, years: 2, total: 10.0, guaranteed: 6.0, rating: 72 },
      { player: 'Teddy Bridgewater', position: 'QB', previousTeam: 'Free Agent', aav: 2.0, years: 1, total: 2.0, guaranteed: 1.0, rating: 62 },
      { player: 'Roger McCreary', position: 'CB', previousTeam: 'Free Agent', aav: 5.0, years: 2, total: 10.0, guaranteed: 6.0, rating: 72 },
      { player: 'Christian Izien', position: 'S', previousTeam: 'Free Agent', aav: 2.0, years: 1, total: 2.0, guaranteed: 1.0, rating: 63 },
      { player: 'Larry Borom', position: 'OL', previousTeam: 'Free Agent', aav: 2.0, years: 1, total: 2.0, guaranteed: 1.0, rating: 62 },
      { player: 'Malcolm Rodriguez', position: 'LB', previousTeam: 'Lions', aav: 4.0, years: 2, total: 8.0, guaranteed: 5.0, rating: 70, note: 'Re-sign' },
      { player: 'Rock Ya-Sin', position: 'CB', previousTeam: 'Free Agent', aav: 3.0, years: 1, total: 3.0, guaranteed: 2.0, rating: 66 },
    ],
    departures: [
      { player: 'David Montgomery', position: 'RB', destination: 'Texans', note: 'Traded for 2026 R4 + Juice Scruggs + 2026 R7' },
      { player: 'Taylor Decker', position: 'OT', destination: 'Free Agent', note: 'Released' },
      { player: 'Alex Anzalone', position: 'LB', destination: 'Buccaneers', note: 'Signed in free agency' },
      { player: 'Amik Robertson', position: 'CB', destination: 'Commanders', note: 'Signed in free agency' },
    ],
    summary: 'Lions traded RB David Montgomery to HOU. Signed RB Isiah Pacheco (1yr/$1.81M from KC), C Cade Mays (3yr/$25M), TE Tyler Conklin, QB Teddy Bridgewater, CB Roger McCreary, S Christian Izien, OL Larry Borom, re-signed LB Malcolm Rodriguez, and added CB Rock Ya-Sin. Released OT Taylor Decker, lost LB Alex Anzalone (TB) and CB Amik Robertson (WSH).',
  },
  GB: {
    signings: [
      { player: 'Zaire Franklin', position: 'LB', previousTeam: 'Colts', aav: 9.5, years: 3, total: 28.5, guaranteed: 18.0, rating: 79 },
      { player: 'Sean Rhyan', position: 'C', previousTeam: 'Packers', aav: 11.0, years: 3, total: 33.0, guaranteed: 20.0, rating: 75 },
      { player: 'Javon Hargrave', position: 'DT', previousTeam: '49ers', aav: 8.0, years: 2, total: 16.0, guaranteed: 10.0, rating: 76 },
      { player: 'Nate Hobbs', position: 'CB', previousTeam: 'Raiders', aav: 5.0, years: 2, total: 10.0, guaranteed: 6.0, rating: 73 },
      { player: 'Benjamin St-Juste', position: 'CB', previousTeam: 'Commanders', aav: 4.0, years: 2, total: 8.0, guaranteed: 5.0, rating: 69 },
      { player: 'Skyy Moore', position: 'WR', previousTeam: 'Chiefs', aav: 2.0, years: 1, total: 2.0, guaranteed: 1.0, rating: 62 },
    ],
    departures: [
      { player: 'Rashan Gary', position: 'DE', destination: 'Cowboys', note: 'Traded' },
    ],
    summary: 'Packers signed LB Zaire Franklin (3yr/$28.5M, $18M gtd), C Sean Rhyan (3yr/$33M), DT Javon Hargrave, CBs Nate Hobbs and Benjamin St-Juste, and WR Skyy Moore. Lost Rashan Gary to the Cowboys in a trade.',
  },
  MIN: {
    signings: [
      { player: 'Kyler Murray', position: 'QB', previousTeam: 'Cardinals', aav: 15.0, years: 1, total: 15.0, guaranteed: 15.0, rating: 78, note: '1-year prove-it deal after ARI release' },
      { player: 'Eric Wilson', position: 'LB', previousTeam: 'Free Agent', aav: 7.5, years: 3, total: 22.5, guaranteed: 14.0, rating: 72 },
    ],
    extensions: [
      { player: 'Aaron Jones', position: 'RB', details: 'Revised contract: base salary reduced from $9M to $5.5M' },
    ],
    departures: [],
    summary: "Vikings signed Kyler Murray on a 1-year prove-it deal ($15M) after Arizona released him. Restructured Aaron Jones' contract to save cap. Signed LB Eric Wilson (3yr/$22.5M).",
  },

  // NFC SOUTH
  ATL: {
    signings: [
      { player: 'Tua Tagovailoa', position: 'QB', previousTeam: 'Dolphins', aav: 1.2, years: 1, total: 1.2, guaranteed: 1.2, rating: 74, note: 'Veteran minimum; MIA paying rest of guaranteed money' },
      { player: 'Nick Folk', position: 'K', previousTeam: 'Titans', aav: 2.5, years: 1, total: 2.5, guaranteed: 1.5, rating: 75 },
      { player: 'Austin Hooper', position: 'TE', previousTeam: 'Falcons', aav: 3.0, years: 1, total: 3.0, guaranteed: 2.0, rating: 67, note: 'Re-sign' },
      { player: 'Christian Harris', position: 'LB', previousTeam: 'Texans', aav: 4.0, years: 2, total: 8.0, guaranteed: 5.0, rating: 70 },
    ],
    departures: [
      { player: 'David Onyemata', position: 'DT', destination: 'Free Agent', note: 'Released' },
    ],
    summary: 'Falcons signed QB Tua Tagovailoa on a 1yr vet minimum deal ($1.2M, MIA paying rest). Added K Nick Folk, re-signed TE Austin Hooper, and signed LB Christian Harris. Released DT David Onyemata.',
  },
  CAR: {
    signings: [
      { player: 'Jaelan Phillips', position: 'DE', previousTeam: 'Dolphins', aav: 30.0, years: 4, total: 120.0, guaranteed: 80.0, rating: 85, note: '$35M signing bonus' },
      { player: 'Devin Lloyd', position: 'LB', previousTeam: 'Jaguars', aav: 15.0, years: 3, total: 45.0, guaranteed: 30.0, rating: 78 },
      { player: 'Kenny Pickett', position: 'QB', previousTeam: 'Eagles', aav: 3.0, years: 1, total: 3.0, guaranteed: 2.0, rating: 64 },
      { player: 'Rasheed Walker', position: 'OT', previousTeam: 'Packers', aav: 5.0, years: 2, total: 10.0, guaranteed: 6.0, rating: 68 },
      { player: 'Luke Fortner', position: 'C', previousTeam: 'Jaguars', aav: 4.0, years: 2, total: 8.0, guaranteed: 5.0, rating: 67 },
    ],
    departures: [],
    summary: 'Panthers made a splash signing DE Jaelan Phillips (4yr/$120M, $80M gtd, $35M signing bonus). Added LB Devin Lloyd (3yr/$45M), QB Kenny Pickett, OT Rasheed Walker, and C Luke Fortner.',
  },
  NO: {
    signings: [
      { player: 'Travis Etienne Jr.', position: 'RB', previousTeam: 'Jaguars', aav: 13.0, years: 4, total: 52.0, guaranteed: 28.0, rating: 79 },
      { player: 'Noah Fant', position: 'TE', previousTeam: 'Seahawks', aav: 5.0, years: 2, total: 10.0, guaranteed: 6.0, rating: 72 },
      { player: 'David Edwards', position: 'OG', previousTeam: 'Rams', aav: 15.25, years: 4, total: 61.0, guaranteed: 45.0, rating: 72 },
      { player: 'Dillon Radunz', position: 'OG', previousTeam: 'Titans', aav: 4.0, years: 2, total: 8.0, guaranteed: 5.0, rating: 68 },
      { player: 'Kaden Elliss', position: 'LB', previousTeam: 'Saints', aav: 11.0, years: 3, total: 33.0, guaranteed: 23.0, rating: 72, note: 'Re-sign' },
      { player: 'Ryan Wright', position: 'P', previousTeam: 'Vikings', aav: 2.0, years: 2, total: 4.0, guaranteed: 2.0, rating: 65 },
      { player: 'John Ridgeway III', position: 'DT', previousTeam: 'Saints', aav: 2.0, years: 1, total: 2.0, guaranteed: 1.0, rating: 65, note: 'Re-sign' },
    ],
    departures: [
      { player: 'Demario Davis', position: 'LB', destination: 'Jets', note: 'Signed in free agency' },
      { player: 'Alontae Taylor', position: 'CB', destination: 'Titans', note: 'Signed in free agency' },
      { player: 'Luke Fortner', position: 'C', destination: 'Panthers', note: 'Signed in free agency' },
    ],
    summary: 'Saints signed RB Travis Etienne Jr. (4yr/$52M, $28M gtd from JAX), OG David Edwards (4yr/$61M, $45M gtd), re-signed LB Kaden Elliss (3yr/$33M, $23M gtd), and added TE Noah Fant, OG Dillon Radunz, P Ryan Wright, and DT John Ridgeway III. Lost LB Demario Davis (NYJ), CB Alontae Taylor (TEN), and C Luke Fortner (CAR).',
  },
  TB: {
    signings: [
      { player: 'Alex Anzalone', position: 'LB', previousTeam: 'Lions', aav: 5.0, years: 2, total: 10.0, guaranteed: 6.0, rating: 73 },
      { player: 'Kenneth Gainwell', position: 'RB', previousTeam: 'Steelers', aav: 2.5, years: 2, total: 5.0, guaranteed: 3.0, rating: 66 },
      { player: 'Cade Otton', position: 'TE', previousTeam: 'Buccaneers', aav: 6.0, years: 3, total: 18.0, guaranteed: 10.0, rating: 74, note: 'Re-sign' },
    ],
    departures: [
      { player: 'Mike Evans', position: 'WR', destination: '49ers', note: 'Signed 3yr/$42.5M' },
      { player: 'Jamel Dean', position: 'CB', destination: 'Steelers', note: 'Signed 3yr/$36.75M' },
    ],
    summary: 'Buccaneers signed LB Alex Anzalone (2yr from DET), RB Kenneth Gainwell (2yr from PIT), and re-signed TE Cade Otton. Lost WR Mike Evans (SF, 3yr/$42.5M) and CB Jamel Dean (PIT, 3yr/$36.75M).',
  },

  // NFC WEST
  ARI: {
    signings: [
      { player: 'Gardner Minshew', position: 'QB', previousTeam: 'Raiders', aav: 5.8, years: 1, total: 5.8, guaranteed: 5.8, rating: 70 },
      { player: 'Kendrick Bourne', position: 'WR', previousTeam: 'Patriots', aav: 5.0, years: 2, total: 10.0, guaranteed: 6.0, rating: 72 },
      { player: 'Tyler Allgeier', position: 'RB', previousTeam: 'Falcons', aav: 4.0, years: 2, total: 8.0, guaranteed: 5.0, rating: 72 },
      { player: 'Isaac Seumalo', position: 'G', previousTeam: 'Steelers', aav: 8.0, years: 3, total: 24.0, guaranteed: 15.0, rating: 76 },
    ],
    departures: [
      { player: 'Kyler Murray', position: 'QB', destination: 'Vikings', note: 'Released' },
    ],
    summary: 'Cardinals released Kyler Murray (signed with MIN). Signed QB Gardner Minshew (1yr/$5.8M), WR Kendrick Bourne (2yr), RB Tyler Allgeier (2yr), and G Isaac Seumalo (3yr).',
  },
  LAR: {
    trades: [
      { acquired: 'Trent McDuffie', position: 'CB', from: 'Chiefs', note: 'Sent 2026 R1 (#29), R5, R6 + 2027 R3' },
    ],
    signings: [
      { player: 'Jaylen Watson', position: 'CB', previousTeam: 'Chiefs', aav: 5.0, years: 2, total: 10.0, guaranteed: 6.0, rating: 72 },
    ],
    extensions: [
      { player: 'Trent McDuffie', position: 'CB', details: '4yr/$124M, fully guaranteed' },
      { player: 'Tyler Higbee', position: 'TE', details: 'Re-signed' },
      { player: 'Kam Curl', position: 'S', details: 'Re-signed' },
    ],
    departures: [],
    summary: 'Rams traded multiple picks to KC for CB Trent McDuffie, then extended him (4yr/$124M, fully guaranteed). Re-signed TE Tyler Higbee and S Kam Curl. Signed CB Jaylen Watson.',
  },
  SF: {
    signings: [
      { player: 'Mike Evans', position: 'WR', previousTeam: 'Buccaneers', aav: 14.2, years: 3, total: 42.5, guaranteed: 14.3, rating: 86, date: '2026-03-11', note: '$12M signing bonus, up to $60.4M with incentives, 4 void years' },
      { player: 'Christian Kirk', position: 'WR', previousTeam: 'Jaguars', aav: 6.0, years: 1, total: 6.0, guaranteed: 4.0, rating: 74 },
      { player: 'Vederian Lowe', position: 'OT', previousTeam: 'Vikings', aav: 3.5, years: 2, total: 7.0, guaranteed: 4.0, rating: 66 },
    ],
    trades: [
      { acquired: 'Osa Odighizuwa', position: 'DT', from: 'Cowboys', note: 'Sent 2026 3rd-round pick' },
    ],
    departures: [],
    summary: '49ers signed Mike Evans (3yr/$42.5M, $14.3M guaranteed, $12M signing bonus, up to $60.4M). Added WR Christian Kirk (1yr) and OT Vederian Lowe. Acquired DT Osa Odighizuwa from Dallas for a 3rd-round pick.',
  },
  SEA: {
    signings: [
      { player: 'Rashid Shaheed', position: 'WR', previousTeam: 'Seahawks', aav: 17.0, years: 3, total: 51.0, guaranteed: 34.7, rating: 74, note: 'Re-signed, 3yr/$51M, $34.7M guaranteed' },
      { player: 'Emanuel Wilson', position: 'RB', previousTeam: 'Packers', aav: 2.5, years: 1, total: 2.5, guaranteed: 1.5, rating: 64 },
      { player: 'Drew Lock', position: 'QB', previousTeam: 'Seahawks', aav: 2.0, years: 1, total: 2.0, guaranteed: 1.0, rating: 60, note: 'Re-signed' },
      { player: 'Eric Saubert', position: 'TE', previousTeam: 'Free Agent', aav: 1.5, years: 1, total: 1.5, guaranteed: 0.75, rating: 58 },
      { player: 'Josh Jobe', position: 'CB', previousTeam: 'Seahawks', aav: 1.5, years: 1, total: 1.5, guaranteed: 0.75, rating: 60, note: 'Re-signed' },
      { player: 'Rodney Thomas', position: 'S', previousTeam: 'Free Agent', aav: 1.5, years: 1, total: 1.5, guaranteed: 0.75, rating: 60 },
      { player: "D'Anthony Bell", position: 'S', previousTeam: 'Free Agent', aav: 1.2, years: 1, total: 1.2, guaranteed: 0.6, rating: 58 },
    ],
    departures: [
      { player: 'Kenneth Walker III', position: 'RB', destination: 'Chiefs', note: 'Signed in free agency' },
      { player: 'Boye Mafe', position: 'EDGE', destination: 'Bengals', note: 'Signed 3yr/$60M' },
      { player: 'Coby Bryant', position: 'CB', destination: 'Bears', note: 'Signed 3yr/$40M' },
      { player: 'Tariq Woolen', position: 'CB', destination: 'Eagles', note: 'Signed in free agency' },
      { player: 'Dareke Young', position: 'WR', destination: 'Raiders', note: 'Signed in free agency' },
    ],
    summary: 'Seahawks re-signed WR Rashid Shaheed (3yr/$51M, $34.7M gtd) and added RB Emanuel Wilson from Green Bay. Re-signed QB Drew Lock, CB Josh Jobe, and added TE Eric Saubert, S Rodney Thomas, and S D\'Anthony Bell. Lost significant talent: RB Kenneth Walker III (KC), EDGE Boye Mafe (CIN), CB Coby Bryant (CHI), CB Tariq Woolen (PHI), and WR Dareke Young (LV).',
  },
};

// Compute a baseline offseason grade for a team based on their 2026 offseason moves
export function computeBaselineGrade(teamAbbr) {
  const moves = preseasonMoves[teamAbbr];
  if (!moves) return { grade: 'C', score: 60, summary: 'No significant 2026 offseason moves tracked yet.' };

  let score = 65;
  const signings = moves.signings || [];
  const departures = moves.departures || [];
  const trades = moves.trades || [];
  const extensions = moves.extensions || [];

  // Signings quality
  if (signings.length > 0) {
    const avgRating = signings.reduce((s, m) => s + (m.rating || 70), 0) / signings.length;
    const avgAAV = signings.reduce((s, m) => s + (m.aav || 5), 0) / signings.length;
    const valueEfficiency = avgRating / Math.max(avgAAV, 1);
    score += Math.min(12, signings.length * 2.5);
    score += Math.min(8, (avgRating - 65) * 0.5);
    score += Math.min(5, valueEfficiency * 0.8);
    if (avgAAV > 22) score -= 3;

    // Splash signing bonus: +5 per signing with rating 85+
    const splashSignings = signings.filter(s => (s.rating || 0) >= 85).length;
    score += splashSignings * 5;

    // Cap efficiency bonus: signings with AAV below typical market rate
    // If avg value efficiency > 10 (high rating per dollar), bonus
    if (valueEfficiency > 10) score += 4;
    else if (valueEfficiency > 7) score += 2;
  }

  score += Math.min(8, trades.length * 3);
  score += Math.min(6, extensions.length * 2);

  if (departures.length > 0) {
    score -= Math.min(8, departures.length * 2);
    if (signings.length >= departures.length) score += 3;

    // Bigger penalty for losing stars (rating 85+)
    // We don't have ratings on departures directly, but we can check if any departure
    // matches a signing with 85+ rating (they were notable players)
    // Approximate: penalize -5 per departure that has a notable contract mentioned
    const starDepartures = departures.filter(d => {
      const contract = d.contract || d.note || '';
      // If the contract value is high, they were likely a star
      const match = contract.match(/\$(\d+)/);
      return match && parseInt(match[1]) >= 30;
    }).length;
    score -= starDepartures * 5;
  }

  score = Math.max(40, Math.min(95, Math.round(score)));

  const gradeFromScore = (s) => {
    if (s >= 95) return 'A+'; if (s >= 90) return 'A'; if (s >= 85) return 'A-';
    if (s >= 80) return 'B+'; if (s >= 75) return 'B'; if (s >= 70) return 'B-';
    if (s >= 65) return 'C+'; if (s >= 60) return 'C'; if (s >= 55) return 'C-';
    if (s >= 50) return 'D+'; if (s >= 45) return 'D'; return 'F';
  };

  return {
    grade: gradeFromScore(score),
    score,
    summary: moves.summary || '',
    signings,
    departures,
    trades,
    extensions,
  };
}

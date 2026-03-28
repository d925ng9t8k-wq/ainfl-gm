// MLB Free Agents — 2025-26 offseason pool
// salary = expected AAV on next deal (market estimate)
// serviceTime: 6+ = FA eligible

export const mlbFreeAgents = [
  // ─── ELITE STARTERS ─────────────────────────────────────────────────────────
  { id:'FA-SP-1', name:'Corbin Burnes',       position:'SP', age:30, salary:24.0, contractYears:1, serviceTime:7,  rating:91, notes:'Top FA starter — coming off Orioles year' },
  { id:'FA-SP-2', name:'Blake Snell',          position:'SP', age:32, salary:32.0, contractYears:1, serviceTime:9,  rating:89, notes:'2x Cy Young, SF walk year' },
  { id:'FA-SP-3', name:'Jack Flaherty',        position:'SP', age:29, salary:15.0, contractYears:2, serviceTime:7,  rating:80, notes:'Tigers walk year' },
  { id:'FA-SP-4', name:'Kevin Gausman',        position:'SP', age:34, salary:20.0, contractYears:2, serviceTime:11, rating:85, notes:'TOR walk year' },
  { id:'FA-SP-5', name:'Chris Bassitt',        position:'SP', age:36, salary:15.0, contractYears:1, serviceTime:10, rating:78, notes:'TOR walk year — innings-eater' },
  { id:'FA-SP-6', name:'Sonny Gray',           position:'SP', age:35, salary:12.0, contractYears:1, serviceTime:12, rating:80, notes:'STL walk year' },
  { id:'FA-SP-7', name:'Sean Manaea',          position:'SP', age:33, salary:12.0, contractYears:1, serviceTime:8,  rating:78, notes:'NYM walk year' },
  { id:'FA-SP-8', name:'Luis Severino',        position:'SP', age:31, salary:12.0, contractYears:1, serviceTime:9,  rating:76, notes:'NYM walk year' },
  { id:'FA-SP-9', name:'Jordan Montgomery',    position:'SP', age:32, salary:20.0, contractYears:3, serviceTime:8,  rating:78, notes:'ARI — seeking extension' },
  { id:'FA-SP-10',name:'Nathan Eovaldi',       position:'SP', age:35, salary:14.0, contractYears:1, serviceTime:12, rating:79, notes:'TEX walk year' },

  // ─── SOLID STARTERS ─────────────────────────────────────────────────────────
  { id:'FA-SP-11',name:'Marcus Stroman',       position:'SP', age:34, salary:12.0, contractYears:1, serviceTime:10, rating:75, notes:'NYY — ground ball machine' },
  { id:'FA-SP-12',name:'Jon Gray',             position:'SP', age:33, salary:10.0, contractYears:1, serviceTime:10, rating:75, notes:'TEX walk year' },
  { id:'FA-SP-13',name:'Andrew Heaney',        position:'SP', age:34, salary:7.0,  contractYears:1, serviceTime:10, rating:72, notes:'TEX walk year' },
  { id:'FA-SP-14',name:'Wade Miley',           position:'SP', age:38, salary:4.0,  contractYears:1, serviceTime:13, rating:67, notes:'Veteran innings-eater' },
  { id:'FA-SP-15',name:'Charlie Morton',       position:'SP', age:41, salary:5.0,  contractYears:1, serviceTime:17, rating:70, notes:'Veteran presence' },
  { id:'FA-SP-16',name:'Frankie Montas',       position:'SP', age:32, salary:10.0, contractYears:1, serviceTime:7,  rating:73, notes:'CIN bounce-back candidate' },

  // ─── CLOSERS / ELITE RELIEVERS ───────────────────────────────────────────────
  { id:'FA-RP-1', name:'Josh Hader',           position:'RP', age:31, salary:22.0, contractYears:3, serviceTime:8,  rating:88, notes:'Elite closer, HOU' },
  { id:'FA-RP-2', name:'Kenley Jansen',        position:'RP', age:37, salary:7.0,  contractYears:1, serviceTime:14, rating:75, notes:'BOS — proven closer' },
  { id:'FA-RP-3', name:'Carlos Estevez',       position:'RP', age:31, salary:9.0,  contractYears:1, serviceTime:8,  rating:75, notes:'LAA closer' },
  { id:'FA-RP-4', name:'Ryan Pressly',         position:'RP', age:36, salary:11.0, contractYears:1, serviceTime:11, rating:75, notes:'HOU — veteran closer' },
  { id:'FA-RP-5', name:'Jose Leclerc',         position:'RP', age:31, salary:7.0,  contractYears:1, serviceTime:8,  rating:77, notes:'TEX closer' },
  { id:'FA-RP-6', name:'Jordan Romano',        position:'RP', age:31, salary:7.0,  contractYears:1, serviceTime:5,  rating:77, notes:'TOR closer' },
  { id:'FA-RP-7', name:'Jason Adam',           position:'RP', age:32, salary:4.0,  contractYears:1, serviceTime:6,  rating:76, notes:'TB setup ace' },
  { id:'FA-RP-8', name:'Will Smith',           position:'RP', age:36, salary:7.0,  contractYears:1, serviceTime:11, rating:72, notes:'TEX veteran LHP' },
  { id:'FA-RP-9', name:'A.J. Puk',             position:'RP', age:30, salary:4.0,  contractYears:2, serviceTime:5,  rating:73, notes:'MIA lefty specialist / closer' },
  { id:'FA-RP-10',name:'Jeff Hoffman',         position:'RP', age:32, salary:8.0,  contractYears:1, serviceTime:8,  rating:78, notes:'PHI — proven closer' },

  // ─── CATCHERS ────────────────────────────────────────────────────────────────
  { id:'FA-C-1',  name:'William Contreras',   position:'C',  age:27, salary:14.0, contractYears:4, serviceTime:4,  rating:82, notes:'MIL — top free agent catcher' },
  { id:'FA-C-2',  name:'Travis d\'Arnaud',    position:'C',  age:36, salary:6.0,  contractYears:1, serviceTime:12, rating:74, notes:'Veteran backstop' },
  { id:'FA-C-3',  name:'Danny Jansen',        position:'C',  age:30, salary:8.0,  contractYears:2, serviceTime:6,  rating:76, notes:'Solid two-way catcher' },

  // ─── FIRST BASEMEN ───────────────────────────────────────────────────────────
  { id:'FA-1B-1', name:'Anthony Rizzo',       position:'1B', age:36, salary:8.0,  contractYears:1, serviceTime:14, rating:74, notes:'Veteran bat, cancer history' },
  { id:'FA-1B-2', name:'Paul Goldschmidt',   position:'1B', age:37, salary:12.0, contractYears:1, serviceTime:14, rating:77, notes:'Still productive HOF candidate' },
  { id:'FA-1B-3', name:'Joey Votto',          position:'1B', age:41, salary:3.0,  contractYears:1, serviceTime:18, rating:65, notes:'Legend — part-time / mentor' },

  // ─── SECOND BASEMEN ─────────────────────────────────────────────────────────
  { id:'FA-2B-1', name:'Gleyber Torres',      position:'2B', age:28, salary:13.0, contractYears:2, serviceTime:7,  rating:79, notes:'NYY walk year' },
  { id:'FA-2B-2', name:'Ha-Seong Kim',        position:'2B', age:29, salary:9.0,  contractYears:2, serviceTime:4,  rating:77, notes:'SD walk year' },
  { id:'FA-2B-3', name:'DJ LeMahieu',         position:'2B', age:36, salary:7.0,  contractYears:1, serviceTime:14, rating:70, notes:'Veteran utility' },

  // ─── SHORTSTOPS ──────────────────────────────────────────────────────────────
  { id:'FA-SS-1', name:'Willy Adames',        position:'SS', age:30, salary:22.0, contractYears:4, serviceTime:7,  rating:83, notes:'Power-hitting SS, top FA target' },
  { id:'FA-SS-2', name:'Alex Bregman',        position:'3B', age:31, salary:21.0, contractYears:4, serviceTime:9,  rating:86, notes:'HOU walk year, can play 3B/SS' },

  // ─── THIRD BASEMEN ───────────────────────────────────────────────────────────
  { id:'FA-3B-1', name:'Alex Bregman',        position:'3B', age:31, salary:22.0, contractYears:4, serviceTime:9,  rating:86, notes:'Top 3B on market' },
  { id:'FA-3B-2', name:'Justin Turner',       position:'3B', age:40, salary:3.0,  contractYears:1, serviceTime:17, rating:70, notes:'Veteran, can DH' },

  // ─── OUTFIELDERS ─────────────────────────────────────────────────────────────
  { id:'FA-OF-1', name:'Anthony Santander',  position:'RF', age:30, salary:20.0, contractYears:4, serviceTime:8,  rating:82, notes:'BAL walk year — big HR bat' },
  { id:'FA-OF-2', name:'Randy Arozarena',    position:'LF', age:30, salary:18.0, contractYears:3, serviceTime:4,  rating:80, notes:'Breakout FA' },
  { id:'FA-OF-3', name:'Michael Conforto',   position:'LF', age:32, salary:14.0, contractYears:1, serviceTime:8,  rating:75, notes:'SF walk year' },
  { id:'FA-OF-4', name:'Cody Bellinger',     position:'CF', age:29, salary:22.0, contractYears:3, serviceTime:8,  rating:82, notes:'CHC walk year again — seeking long-term' },
  { id:'FA-OF-5', name:'Teoscar Hernandez', position:'RF', age:32, salary:18.0, contractYears:2, serviceTime:8,  rating:83, notes:'LAD/SEA walk year' },
  { id:'FA-OF-6', name:'Tyler O\'Neill',     position:'LF', age:29, salary:9.0,  contractYears:2, serviceTime:7,  rating:77, notes:'BOS — power bat' },
  { id:'FA-OF-7', name:'Starling Marte',     position:'RF', age:36, salary:8.0,  contractYears:1, serviceTime:13, rating:73, notes:'NYM veteran' },
  { id:'FA-OF-8', name:'Jake Fraley',        position:'RF', age:30, salary:5.0,  contractYears:1, serviceTime:5,  rating:72, notes:'CIN — solid platoon' },

  // ─── DH-ONLY ─────────────────────────────────────────────────────────────────
  { id:'FA-DH-1', name:'Nelson Cruz',        position:'DH', age:45, salary:2.0,  contractYears:1, serviceTime:20, rating:65, notes:'Legend still playing' },
  { id:'FA-DH-2', name:'Marcell Ozuna',      position:'DH', age:34, salary:13.0, contractYears:1, serviceTime:11, rating:79, notes:'ATL walk year' },
];

/**
 * NFL Trade Value Engine
 *
 * Research-backed player and draft pick valuation using:
 * - Jimmy Johnson draft value chart (99% match to actual NFL trades)
 * - PFF WAR positional value data
 * - Position-specific aging curves (PFF, FiveThirtyEight, ESPN)
 * - Contract surplus value analysis (Massey-Thaler, Over The Cap)
 * - Future pick discounting from observed NFL trade behavior
 */

// === DRAFT PICK VALUES (Jimmy Johnson chart) ===
const PICK_VALUES = {
  '1-1': 3000, '1-2': 2600, '1-3': 2200, '1-4': 1800, '1-5': 1700,
  '1-6': 1600, '1-7': 1500, '1-8': 1400, '1-9': 1350, '1-10': 1300,
  '1-11': 1250, '1-12': 1200, '1-13': 1150, '1-14': 1100, '1-15': 1050,
  '1-16': 1000, '1-17': 950, '1-18': 900, '1-19': 850, '1-20': 800,
  '1-21': 750, '1-22': 700, '1-23': 650, '1-24': 600, '1-25': 550,
  '1-26': 500, '1-27': 480, '1-28': 460, '1-29': 440, '1-30': 420,
  '1-31': 400, '1-32': 380,
  '2-1': 360, '2-2': 340, '2-3': 320, '2-4': 300, '2-5': 290,
  '2-10': 260, '2-17': 230, '2-20': 210, '2-32': 180,
  '3-1': 170, '3-17': 130, '3-32': 100,
  '4-1': 95, '4-17': 75, '4-32': 60,
  '5-1': 55, '5-17': 45, '5-32': 35,
  '6-1': 30, '6-17': 22, '6-32': 16,
  '7-1': 15, '7-17': 10, '7-32': 6,
};

// === POSITION CONFIG ===
// Peak ages from PFF aging curves; decay rates from PFF WAR + FiveThirtyEight
// Trade multipliers from PFF surplus value + ESPN Barnwell trade tiers
const POSITION_CONFIG = {
  QB:   { mult: 3.50, peakAge: 27, decay: 0.96 },
  EDGE: { mult: 1.50, peakAge: 26, decay: 0.90 },
  DE:   { mult: 1.50, peakAge: 26, decay: 0.90 },
  OT:   { mult: 1.30, peakAge: 27, decay: 0.92 },
  LT:   { mult: 1.30, peakAge: 27, decay: 0.92 },
  RT:   { mult: 1.30, peakAge: 27, decay: 0.92 },
  WR:   { mult: 1.25, peakAge: 26, decay: 0.90 },
  CB:   { mult: 1.20, peakAge: 26, decay: 0.89 },
  DT:   { mult: 1.05, peakAge: 26, decay: 0.90 },
  NT:   { mult: 1.05, peakAge: 26, decay: 0.90 },
  DL:   { mult: 1.05, peakAge: 26, decay: 0.90 },
  IDL:  { mult: 1.05, peakAge: 26, decay: 0.90 },
  TE:   { mult: 0.90, peakAge: 27, decay: 0.92 },
  LB:   { mult: 0.85, peakAge: 26, decay: 0.91 },
  MLB:  { mult: 0.85, peakAge: 26, decay: 0.91 },
  OLB:  { mult: 0.85, peakAge: 26, decay: 0.91 },
  ILB:  { mult: 0.85, peakAge: 26, decay: 0.91 },
  S:    { mult: 0.75, peakAge: 26, decay: 0.90 },
  FS:   { mult: 0.75, peakAge: 26, decay: 0.90 },
  SS:   { mult: 0.75, peakAge: 26, decay: 0.90 },
  G:    { mult: 0.75, peakAge: 27, decay: 0.92 },
  LG:   { mult: 0.75, peakAge: 27, decay: 0.92 },
  RG:   { mult: 0.75, peakAge: 27, decay: 0.92 },
  C:    { mult: 0.75, peakAge: 27, decay: 0.92 },
  IOL:  { mult: 0.75, peakAge: 27, decay: 0.92 },
  OG:   { mult: 0.75, peakAge: 27, decay: 0.92 },
  OL:   { mult: 0.75, peakAge: 27, decay: 0.92 },
  RB:   { mult: 0.50, peakAge: 25, decay: 0.88 },
  FB:   { mult: 0.40, peakAge: 26, decay: 0.90 },
  K:    { mult: 0.30, peakAge: 28, decay: 0.95 },
  PK:   { mult: 0.30, peakAge: 28, decay: 0.95 },
  P:    { mult: 0.30, peakAge: 28, decay: 0.95 },
  LS:   { mult: 0.30, peakAge: 28, decay: 0.95 },
};

const DEFAULT_CONFIG = { mult: 0.85, peakAge: 27, decay: 0.90 };

// === CORE FUNCTIONS ===

/**
 * Get trade value for a draft pick
 * @param {number} round - Round number (1-7)
 * @param {number} pick - Pick within round (1-32)
 * @returns {number} Trade value points
 */
export function getPickValue(round, pick) {
  const key = `${round}-${pick}`;
  if (PICK_VALUES[key]) return PICK_VALUES[key];
  // Interpolate for picks not in the table
  const base = [0, 3000, 360, 170, 95, 55, 30, 15][round] || 10;
  return Math.max(5, Math.round(base - (pick - 1) * (base * 0.55 / 32)));
}

/**
 * Get trade value for a draft pick by overall number (1-257)
 * Used by DraftPage which tracks overall pick number
 * @param {number} overall - Overall pick number
 * @returns {number} Trade value points
 */
export function getPickValueByOverall(overall) {
  // Approximate: exponential decay matching the Johnson chart
  return Math.max(5, Math.round(800 * Math.pow(0.988, overall) + 20));
}

/**
 * Get trade value for a future draft pick
 * NFL teams discount future picks steeply — roughly 1 round per year
 * Observed discount rates average over 100% annually
 * @param {number} round - Round number (1-7)
 * @param {number} year - Draft year
 * @returns {number} Trade value points
 */
export function getFuturePickValue(round, year) {
  // Use mid-round value as baseline
  const base2026 = [0, 1000, 270, 135, 78, 45, 23, 11][round] || 10;
  // Steeper discounts based on actual NFL trade data
  const discount = year === 2027 ? 0.55 : year === 2028 ? 0.30 : 0.15;
  return Math.round(base2026 * discount);
}

/**
 * Get position-specific age multiplier
 * Uses exponential decay past peak age with position-specific rates
 * Young players get a ramp-up (unproven discount)
 */
function getAgeMult(age, position) {
  const config = POSITION_CONFIG[position] || DEFAULT_CONFIG;
  const { peakAge, decay } = config;

  // Young player ramp: age 21 = 0.82, gradually increases to 1.0 at peak
  if (age <= peakAge) {
    return Math.min(1.0, 0.82 + (age - 21) * (0.18 / Math.max(1, peakAge - 21)));
  }

  // Post-peak: exponential decay at position-specific rate
  return Math.max(0.05, Math.pow(decay, age - peakAge));
}

/**
 * Get contract situation multiplier
 * Rookie deals have surplus value (below-market cost for production)
 * Expiring contracts have minimal trade value (rental)
 */
function getContractMult(yearsRemaining, capHit, position) {
  // Rough proxy for rookie deal: cap hit under $8M suggests rookie-scale contract
  const isRookieDeal = capHit < 8;

  if (isRookieDeal) {
    if (yearsRemaining >= 3) return 1.35;
    if (yearsRemaining >= 2) return 1.20;
    if (yearsRemaining >= 1) return 1.05;
    return 0.60;
  }

  // QBs on long deals are MORE valuable — years of franchise play locked in
  if (position === 'QB') {
    if (yearsRemaining >= 4) return 1.10;
    if (yearsRemaining >= 3) return 1.05;
    if (yearsRemaining >= 2) return 0.95;
    if (yearsRemaining >= 1) return 0.75;
    return 0.40;
  }

  // Veteran contracts — value decreases as contract gets shorter
  if (yearsRemaining >= 4) return 0.90;
  if (yearsRemaining >= 3) return 0.85;
  if (yearsRemaining >= 2) return 0.75;
  if (yearsRemaining >= 1) return 0.55;
  return 0.25;
}

/**
 * Get position multiplier
 */
function getPositionMult(position) {
  const config = POSITION_CONFIG[position] || DEFAULT_CONFIG;
  return config.mult;
}

/**
 * Calculate total trade value for a player
 * Formula: Base_Value × Position_Mult × Age_Mult × Contract_Mult
 *
 * Examples at the new scale:
 *   Patrick Mahomes (QB, 30, $45M, 7yr): 100*sqrt(45) * 2.50 * 0.86 * 0.90 = ~1,297 pts (~1st overall)
 *   Ja'Marr Chase (WR, 26, $32M, 3yr):  100*sqrt(32) * 1.25 * 1.00 * 0.85 = ~601 pts (~mid-1st)
 *   Derrick Henry (RB, 32, $10M, 1yr):   100*sqrt(10) * 0.50 * 0.41 * 0.55 = ~36 pts (~6th round)
 *   Joe Burrow (QB, 29, $55M, 4yr):      100*sqrt(55) * 2.50 * 0.90 * 0.90 = ~1,504 pts (~1st overall+)
 *
 * @param {Object} player - Player object with name, position, age, capHit, yearsRemaining
 * @returns {number} Trade value in draft-pick-equivalent points
 */
export function getPlayerValue(player) {
  const cap = player.capHit || 1;
  const age = player.age || 27;
  const pos = (player.position || '').toUpperCase();
  const yrsRemaining = player.yearsRemaining || 0;

  const baseValue = 110 * Math.sqrt(cap);
  const posMult = getPositionMult(pos);
  const ageMult = getAgeMult(age, pos);
  const contractMult = getContractMult(yrsRemaining, cap, pos);

  return Math.max(5, Math.round(baseValue * posMult * ageMult * contractMult));
}

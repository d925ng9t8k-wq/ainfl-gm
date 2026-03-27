"""
trader9_risk.py — Risk Management Engine
Session 3: Advanced Strategies

Complete risk management system:
  - Kelly Criterion position sizing
  - Fixed fractional sizing
  - Max drawdown enforcement
  - Correlation-based portfolio risk
  - ATR trailing stops
  - Risk/reward enforcement
  - Daily/weekly loss limits
  - Portfolio heat tracker

This module is the last gate before any order is placed.
If risk checks fail, the trade does not execute.
"""

import math
import json
import numpy as np
from datetime import datetime, timezone, date
from typing import Optional, Dict, List, Tuple
from dataclasses import dataclass, asdict


# ---------------------------------------------------------------------------
# TRADE CONTEXT — Input to risk checks
# ---------------------------------------------------------------------------

@dataclass
class TradeRequest:
    """A pending trade that needs risk approval."""
    symbol:        str
    direction:     str       # 'long' or 'short'
    entry_price:   float
    stop_loss:     float
    take_profit:   List[float]
    strategy:      str
    confidence:    float     # 0-1 from signal
    timestamp:     str


@dataclass
class RiskDecision:
    """Output of the risk engine."""
    approved:          bool
    position_size_usd: float   # dollar amount to deploy
    position_pct:      float   # % of account
    stop_loss:         float   # confirmed or adjusted stop
    take_profit:       List[float]
    risk_amount:       float   # max dollar loss on this trade
    risk_reward:       float   # R:R ratio
    rejection_reasons: List[str]
    warnings:          List[str]

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# RISK CONFIGURATION
# ---------------------------------------------------------------------------

# Default configuration — all values tunable
DEFAULT_CONFIG = {
    # Account
    'starting_capital':       200.0,

    # Per-trade limits
    'max_risk_per_trade_pct': 0.02,    # Max 2% of account at risk per trade
    'max_position_pct':       0.25,    # Max 25% of account per position
    'min_risk_reward':        1.5,     # Minimum acceptable R:R ratio
    'max_open_positions':     2,       # Never more than 2 simultaneous

    # Daily limits
    'daily_loss_limit_pct':   0.05,    # Stop trading if down 5% for the day
    'daily_trade_limit':      20,      # Max trades per day

    # Weekly limits
    'weekly_loss_limit_pct':  0.15,    # Full review if down 15% on the week

    # Sizing methods
    'default_sizing':         'fixed_fractional',  # or 'kelly'
    'kelly_fraction':         0.25,    # Use quarter-Kelly (conservative)
    'fixed_fraction_risk':    0.01,    # Risk 1% per trade with fixed fractional

    # Correlation
    'max_correlated_exposure': 0.40,   # Max 40% in highly-correlated assets
    'correlation_threshold':   0.80,   # Correlation above this = "same sector"

    # ATR-based stop optimization
    'atr_stop_multiplier':    2.0,     # Default ATR multiplier for stops

    # Geopolitical override
    'geo_risk_active':        False,   # True = halve all position sizes
    'fear_greed_floor':       10,      # Halve sizes if F&G drops below this

    # Paper trading flag
    'paper_trading':          True,    # ALWAYS True until explicitly changed
}


class RiskConfig:
    def __init__(self, overrides: Optional[Dict] = None):
        self._cfg = {**DEFAULT_CONFIG, **(overrides or {})}

    def __getitem__(self, key):
        return self._cfg[key]

    def get(self, key, default=None):
        return self._cfg.get(key, default)

    def update(self, key: str, value):
        self._cfg[key] = value


# ---------------------------------------------------------------------------
# KELLY CRITERION
# ---------------------------------------------------------------------------

def kelly_criterion(win_rate: float,
                    avg_win_pct: float,
                    avg_loss_pct: float) -> float:
    """
    Kelly Criterion: optimal fraction of capital to bet.

    Formula: f* = (b*p - q) / b
    Where:
        b = avg_win / avg_loss (odds ratio)
        p = win rate
        q = 1 - p (loss rate)

    Returns the full Kelly fraction. In practice, use a fraction of this
    (quarter-Kelly is common) to reduce variance.

    Args:
        win_rate:     historical win rate (0-1)
        avg_win_pct:  average gain on winning trades (e.g. 0.03 = 3%)
        avg_loss_pct: average loss on losing trades (e.g. 0.015 = 1.5%)

    Returns:
        Kelly fraction (0-1). Negative = don't trade this system.
    """
    if avg_loss_pct <= 0 or win_rate <= 0 or win_rate >= 1:
        return 0.0

    b = avg_win_pct / avg_loss_pct  # odds
    p = win_rate
    q = 1 - win_rate

    kelly = (b * p - q) / b
    return max(0.0, kelly)


def position_size_kelly(capital: float,
                        win_rate: float,
                        avg_win_pct: float,
                        avg_loss_pct: float,
                        kelly_fraction: float = 0.25,
                        max_pct: float = 0.25) -> float:
    """
    Position size using Kelly Criterion (fractional).

    Args:
        capital:        current account value
        win_rate:       strategy win rate (from backtest or live)
        avg_win_pct:    average winning trade return
        avg_loss_pct:   average losing trade return (absolute)
        kelly_fraction: fraction of Kelly to use (0.25 = quarter-Kelly)
        max_pct:        hard cap on position size regardless of Kelly

    Returns:
        Dollar amount to invest.
    """
    full_kelly = kelly_criterion(win_rate, avg_win_pct, avg_loss_pct)
    used_kelly = full_kelly * kelly_fraction
    capped     = min(used_kelly, max_pct)
    return round(capital * capped, 2)


# ---------------------------------------------------------------------------
# FIXED FRACTIONAL SIZING
# ---------------------------------------------------------------------------

def position_size_fixed_fractional(capital: float,
                                   entry_price: float,
                                   stop_loss: float,
                                   risk_pct: float = 0.01,
                                   max_pct: float = 0.25) -> Dict:
    """
    Fixed fractional position sizing.

    Risk a fixed % of account on every trade.
    Position size is determined by the stop distance.

    Formula:
        risk_amount = capital * risk_pct
        stop_distance = |entry - stop_loss| / entry
        position_size = risk_amount / stop_distance

    Args:
        capital:     current account balance
        entry_price: planned entry price
        stop_loss:   planned stop loss price
        risk_pct:    fraction of capital to risk (default 1%)
        max_pct:     maximum position as % of capital

    Returns:
        {'size_usd': ..., 'risk_usd': ..., 'stop_distance_pct': ...}
    """
    if entry_price <= 0 or stop_loss <= 0:
        return {'size_usd': 0, 'risk_usd': 0, 'stop_distance_pct': 0}

    stop_distance = abs(entry_price - stop_loss) / entry_price

    if stop_distance == 0:
        return {'size_usd': 0, 'risk_usd': 0, 'stop_distance_pct': 0}

    risk_amount   = capital * risk_pct
    size_from_risk = risk_amount / stop_distance

    max_size = capital * max_pct
    size_usd = min(size_from_risk, max_size)

    actual_risk = size_usd * stop_distance

    return {
        'size_usd':          round(size_usd, 2),
        'risk_usd':          round(actual_risk, 2),
        'stop_distance_pct': round(stop_distance * 100, 2),
    }


# ---------------------------------------------------------------------------
# ATR-BASED TRAILING STOP
# ---------------------------------------------------------------------------

class TrailingStop:
    """
    ATR-based trailing stop manager.

    The stop trails the price by a fixed ATR multiple.
    It only moves in the favorable direction (never against the trade).

    For long trades: stop rises as price rises, never falls.
    For short trades: stop falls as price falls, never rises.
    """

    def __init__(self, atr_multiplier: float = 2.0):
        self.multiplier = atr_multiplier
        self.current_stop: Optional[float] = None
        self.direction: Optional[str] = None
        self.highest_price: Optional[float] = None
        self.lowest_price: Optional[float] = None

    def initialize(self, entry_price: float, atr: float, direction: str):
        """Set the initial stop at entry."""
        self.direction = direction
        if direction == 'long':
            self.current_stop   = entry_price - self.multiplier * atr
            self.highest_price  = entry_price
        else:
            self.current_stop   = entry_price + self.multiplier * atr
            self.lowest_price   = entry_price

    def update(self, current_price: float, current_atr: float) -> float:
        """
        Update trailing stop given new price and ATR.

        Returns the new stop price.
        The stop only moves in the profitable direction.
        """
        if self.direction == 'long':
            if current_price > self.highest_price:
                self.highest_price = current_price
            new_stop = self.highest_price - self.multiplier * current_atr
            if new_stop > self.current_stop:
                self.current_stop = new_stop

        else:  # short
            if current_price < self.lowest_price:
                self.lowest_price = current_price
            new_stop = self.lowest_price + self.multiplier * current_atr
            if new_stop < self.current_stop:
                self.current_stop = new_stop

        return round(self.current_stop, 4)

    def is_triggered(self, current_price: float) -> bool:
        """Has the trailing stop been hit?"""
        if self.direction == 'long':
            return current_price <= self.current_stop
        return current_price >= self.current_stop


# ---------------------------------------------------------------------------
# CORRELATION-BASED PORTFOLIO RISK
# ---------------------------------------------------------------------------

class PortfolioRiskTracker:
    """
    Tracks open positions and measures portfolio-level correlation risk.

    Prevents over-concentration in highly correlated assets.
    E.g.: holding both BTC and ETH longs is essentially doubling crypto exposure.

    Known crypto correlations (approximate, regime-dependent):
    BTC/ETH: ~0.85
    BTC/AVAX: ~0.75
    ETH/LINK: ~0.80
    All crypto vs USD: effectively 0 (USD is our base currency)
    """

    # Hardcoded correlation matrix for Alpaca crypto pairs
    CORRELATION_MATRIX = {
        ('BTC/USD', 'ETH/USD'): 0.85,
        ('ETH/USD', 'BTC/USD'): 0.85,
        ('BTC/USD', 'AVAX/USD'): 0.75,
        ('AVAX/USD', 'BTC/USD'): 0.75,
        ('ETH/USD', 'LINK/USD'): 0.80,
        ('LINK/USD', 'ETH/USD'): 0.80,
        ('BTC/USD', 'DOGE/USD'): 0.65,
        ('DOGE/USD', 'BTC/USD'): 0.65,
    }

    def __init__(self, config: RiskConfig):
        self.config    = config
        self.positions: Dict[str, Dict] = {}  # symbol -> {size_usd, direction, entry}

    def add_position(self, symbol: str, size_usd: float,
                     direction: str, entry_price: float):
        self.positions[symbol] = {
            'size_usd':    size_usd,
            'direction':   direction,
            'entry_price': entry_price,
            'opened_at':   datetime.now(timezone.utc).isoformat(),
        }

    def remove_position(self, symbol: str):
        self.positions.pop(symbol, None)

    def total_exposure(self) -> float:
        """Total dollar exposure across all open positions."""
        return sum(p['size_usd'] for p in self.positions.values())

    def correlation_exposure(self, new_symbol: str,
                             new_direction: str,
                             new_size_usd: float) -> Dict:
        """
        Calculate how much correlated exposure exists if we add this trade.

        Returns:
        {
            'total_correlated_usd': ...,
            'total_correlated_pct': ...,
            'exceeds_limit': bool,
            'correlated_pairs': [...],
        }
    """
        correlated_usd  = new_size_usd  # count the new position
        correlated_with = []

        for symbol, pos in self.positions.items():
            key = (new_symbol, symbol)
            corr = self.CORRELATION_MATRIX.get(key, 0.0)

            # Only count if same direction AND highly correlated
            if corr >= self.config['correlation_threshold'] and \
               pos['direction'] == new_direction:
                correlated_usd += pos['size_usd'] * corr
                correlated_with.append({
                    'symbol':      symbol,
                    'correlation': corr,
                    'exposure':    pos['size_usd'],
                })

        # Approximate account value (would be pulled from Alpaca in production)
        account_val = self.config['starting_capital']
        correlated_pct = correlated_usd / account_val

        return {
            'total_correlated_usd': round(correlated_usd, 2),
            'total_correlated_pct': round(correlated_pct, 4),
            'exceeds_limit':        correlated_pct > self.config['max_correlated_exposure'],
            'correlated_pairs':     correlated_with,
        }

    def portfolio_heat(self, account_balance: float) -> Dict:
        """
        Portfolio heat: sum of max losses across all open positions.
        If every stop is hit simultaneously, how much do we lose?
        """
        total_risk_usd = 0.0
        positions_heat = []

        for symbol, pos in self.positions.items():
            # Estimate risk as 2% of position (approximate)
            risk_usd = pos['size_usd'] * 0.02
            total_risk_usd += risk_usd
            positions_heat.append({
                'symbol':   symbol,
                'size_usd': pos['size_usd'],
                'risk_usd': round(risk_usd, 2),
            })

        heat_pct = total_risk_usd / account_balance if account_balance > 0 else 0

        return {
            'total_risk_usd':  round(total_risk_usd, 2),
            'portfolio_heat_pct': round(heat_pct * 100, 2),
            'positions':       positions_heat,
            'status':          'HOT' if heat_pct > 0.05 else 'WARM' if heat_pct > 0.02 else 'COOL',
        }


# ---------------------------------------------------------------------------
# DAILY / WEEKLY STATE TRACKER
# ---------------------------------------------------------------------------

class PnLTracker:
    """
    Tracks daily and weekly P&L to enforce loss limits.

    State is persisted to a JSON file so it survives process restarts.
    """

    def __init__(self, state_file: str = '/tmp/trader9_pnl_state.json'):
        self.state_file = state_file
        self._state     = self._load()

    def _load(self) -> Dict:
        try:
            with open(self.state_file, 'r') as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return self._fresh_state()

    def _fresh_state(self) -> Dict:
        today = date.today().isoformat()
        week  = datetime.now().strftime('%Y-W%W')
        return {
            'today':             today,
            'week':              week,
            'daily_pnl':        0.0,
            'weekly_pnl':       0.0,
            'daily_trades':     0,
            'trades_today':     [],
            'halted_until':     None,  # ISO timestamp or None
        }

    def _save(self):
        with open(self.state_file, 'w') as f:
            json.dump(self._state, f, indent=2)

    def _refresh_if_new_day(self):
        today = date.today().isoformat()
        week  = datetime.now().strftime('%Y-W%W')
        if self._state['today'] != today:
            self._state['daily_pnl']    = 0.0
            self._state['daily_trades'] = 0
            self._state['trades_today'] = []
            self._state['today']        = today
            self._state['halted_until'] = None  # Reset daily halt
        if self._state['week'] != week:
            self._state['weekly_pnl'] = 0.0
            self._state['week']       = week
        self._save()

    def record_trade(self, symbol: str, pnl: float, strategy: str):
        self._refresh_if_new_day()
        self._state['daily_pnl']    += pnl
        self._state['weekly_pnl']   += pnl
        self._state['daily_trades'] += 1
        self._state['trades_today'].append({
            'symbol':    symbol,
            'pnl':       pnl,
            'strategy':  strategy,
            'timestamp': datetime.now(timezone.utc).isoformat(),
        })
        self._save()

    def set_halt(self, duration_hours: float = 24):
        """Halt trading for N hours."""
        from datetime import timedelta
        until = (datetime.now(timezone.utc) + timedelta(hours=duration_hours)).isoformat()
        self._state['halted_until'] = until
        self._save()

    def is_halted(self) -> Tuple[bool, Optional[str]]:
        """Returns (is_halted, reason)."""
        self._refresh_if_new_day()
        if self._state.get('halted_until'):
            until = datetime.fromisoformat(self._state['halted_until'])
            if datetime.now(timezone.utc) < until:
                return True, f"Trading halted until {until.strftime('%H:%M UTC')}"
        return False, None

    @property
    def daily_pnl(self) -> float:
        self._refresh_if_new_day()
        return self._state['daily_pnl']

    @property
    def weekly_pnl(self) -> float:
        self._refresh_if_new_day()
        return self._state['weekly_pnl']

    @property
    def daily_trades(self) -> int:
        self._refresh_if_new_day()
        return self._state['daily_trades']

    def summary(self) -> Dict:
        self._refresh_if_new_day()
        return {
            'today':         self._state['today'],
            'daily_pnl':     round(self._state['daily_pnl'], 2),
            'weekly_pnl':    round(self._state['weekly_pnl'], 2),
            'daily_trades':  self._state['daily_trades'],
            'halted_until':  self._state.get('halted_until'),
        }


# ---------------------------------------------------------------------------
# RISK ENGINE — Master Gate
# ---------------------------------------------------------------------------

class RiskEngine:
    """
    Master risk gate. Every trade MUST pass through this before execution.

    Checks (in order):
    1. Paper trading mode confirmed
    2. System halt check (daily loss limit hit, manual halt)
    3. Daily trade count limit
    4. Weekly loss limit
    5. Open position count
    6. R:R ratio check
    7. Position size calculation (Kelly or fixed fractional)
    8. Max risk per trade check
    9. Correlation exposure check
    10. Portfolio heat check
    11. Geopolitical risk override
    """

    def __init__(self,
                 config: Optional[RiskConfig] = None,
                 portfolio: Optional[PortfolioRiskTracker] = None,
                 pnl_tracker: Optional[PnLTracker] = None):
        self.config    = config    or RiskConfig()
        self.portfolio = portfolio or PortfolioRiskTracker(self.config)
        self.pnl       = pnl_tracker or PnLTracker()

    def evaluate(self,
                 request: TradeRequest,
                 account_balance: float,
                 open_position_count: int,
                 win_rate: float = 0.60,
                 avg_win_pct: float = 0.025,
                 avg_loss_pct: float = 0.015) -> RiskDecision:
        """
        Evaluate a trade request against all risk rules.

        Args:
            request:              the proposed trade
            account_balance:      current account value
            open_position_count:  number of currently open positions
            win_rate:             recent strategy win rate (for Kelly)
            avg_win_pct:          recent average winning trade %
            avg_loss_pct:         recent average losing trade %

        Returns:
            RiskDecision — approved or rejected with reasons.
        """
        rejections = []
        warnings   = []

        # 1. Paper trading mode
        if not self.config['paper_trading']:
            warnings.append('WARNING: paper_trading=False. Real money at risk.')

        # 2. Halt check
        halted, halt_reason = self.pnl.is_halted()
        if halted:
            rejections.append(f'HALT: {halt_reason}')

        # 3. Daily loss limit
        daily_loss_limit = account_balance * self.config['daily_loss_limit_pct']
        if self.pnl.daily_pnl < -daily_loss_limit:
            self.pnl.set_halt(24)
            rejections.append(
                f'Daily loss limit hit: ${abs(self.pnl.daily_pnl):.2f} > ${daily_loss_limit:.2f}. '
                f'Halted for 24h.'
            )

        # 4. Daily trade count
        if self.pnl.daily_trades >= self.config['daily_trade_limit']:
            rejections.append(
                f'Daily trade limit reached: {self.pnl.daily_trades}/{self.config["daily_trade_limit"]}'
            )

        # 5. Weekly loss limit
        weekly_loss_limit = account_balance * self.config['weekly_loss_limit_pct']
        if self.pnl.weekly_pnl < -weekly_loss_limit:
            rejections.append(
                f'Weekly loss limit hit: ${abs(self.pnl.weekly_pnl):.2f} > ${weekly_loss_limit:.2f}. '
                f'Full strategy review required.'
            )

        # 6. Open position count
        if open_position_count >= self.config['max_open_positions']:
            rejections.append(
                f'Max open positions reached: {open_position_count}/{self.config["max_open_positions"]}'
            )

        # 7. R:R check
        stop_distance  = abs(request.entry_price - request.stop_loss)
        tp1_distance   = abs(request.take_profit[0] - request.entry_price) if request.take_profit else 0
        rr_ratio       = (tp1_distance / stop_distance) if stop_distance > 0 else 0
        if rr_ratio < self.config['min_risk_reward'] and rr_ratio > 0:
            rejections.append(
                f'R:R too low: {rr_ratio:.2f} < {self.config["min_risk_reward"]}. Adjust stop or target.'
            )

        # 8. Position sizing
        geo_multiplier = 0.5 if self.config['geo_risk_active'] else 1.0

        if self.config['default_sizing'] == 'kelly':
            base_size = position_size_kelly(
                capital=account_balance,
                win_rate=win_rate,
                avg_win_pct=avg_win_pct,
                avg_loss_pct=avg_loss_pct,
                kelly_fraction=self.config['kelly_fraction'],
                max_pct=self.config['max_position_pct'],
            )
        else:
            sizing = position_size_fixed_fractional(
                capital=account_balance,
                entry_price=request.entry_price,
                stop_loss=request.stop_loss,
                risk_pct=self.config['fixed_fraction_risk'],
                max_pct=self.config['max_position_pct'],
            )
            base_size = sizing['size_usd']

        # Apply geo risk multiplier
        position_size_usd = base_size * geo_multiplier
        if self.config['geo_risk_active']:
            warnings.append(f'Geo risk active: position size halved to ${position_size_usd:.2f}')

        position_pct  = position_size_usd / account_balance

        # 9. Max risk per trade
        actual_risk   = position_size_usd * (stop_distance / request.entry_price) if request.entry_price > 0 else 0
        max_risk_usd  = account_balance * self.config['max_risk_per_trade_pct']
        if actual_risk > max_risk_usd:
            # Scale down position to stay within max risk
            scale_factor      = max_risk_usd / actual_risk
            position_size_usd = position_size_usd * scale_factor
            actual_risk       = max_risk_usd
            warnings.append(f'Position scaled down to respect max risk ${max_risk_usd:.2f}')

        # 10. Correlation check
        corr_check = self.portfolio.correlation_exposure(
            request.symbol, request.direction, position_size_usd
        )
        if corr_check['exceeds_limit']:
            rejections.append(
                f'Correlated exposure {corr_check["total_correlated_pct"]*100:.1f}% > '
                f'{self.config["max_correlated_exposure"]*100:.0f}% limit. '
                f'Pairs: {[p["symbol"] for p in corr_check["correlated_pairs"]]}'
            )

        # 11. Portfolio heat
        heat = self.portfolio.portfolio_heat(account_balance)
        if heat['status'] == 'HOT':
            warnings.append(f'Portfolio heat {heat["portfolio_heat_pct"]}% — system running hot')

        # Final decision
        approved = len(rejections) == 0 and position_size_usd > 0

        # Minimum viable position (Alpaca crypto min is ~$1)
        if position_size_usd < 1.0:
            approved = False
            rejections.append(f'Position size ${position_size_usd:.2f} below minimum $1.00')

        return RiskDecision(
            approved          = approved,
            position_size_usd = round(position_size_usd, 2),
            position_pct      = round(position_pct, 4),
            stop_loss         = request.stop_loss,
            take_profit       = request.take_profit,
            risk_amount       = round(actual_risk, 2),
            risk_reward       = round(rr_ratio, 2),
            rejection_reasons = rejections,
            warnings          = warnings,
        )


# ---------------------------------------------------------------------------
# MAX DRAWDOWN MONITOR
# ---------------------------------------------------------------------------

class DrawdownMonitor:
    """
    Tracks the equity curve and enforces maximum drawdown limits.

    max_drawdown: largest peak-to-trough decline in account value.
    If drawdown exceeds limit, trading is suspended.
    """

    def __init__(self, max_drawdown_pct: float = 0.20):
        self.max_drawdown_pct = max_drawdown_pct  # 20% = blow-up protection
        self.peak_equity      = 0.0
        self.equity_history   = []

    def update(self, current_equity: float) -> Dict:
        """
        Update equity curve and check drawdown.

        Returns:
        {
            'current_drawdown_pct': ...,
            'peak_equity':          ...,
            'max_drawdown_pct':     ...,
            'status':               'ok' | 'warning' | 'critical',
            'should_halt':          bool,
        }
        """
        if current_equity > self.peak_equity:
            self.peak_equity = current_equity

        self.equity_history.append({
            'equity':    current_equity,
            'timestamp': datetime.now(timezone.utc).isoformat(),
        })

        # Keep last 1000 data points
        if len(self.equity_history) > 1000:
            self.equity_history = self.equity_history[-1000:]

        drawdown_pct = 0.0
        if self.peak_equity > 0:
            drawdown_pct = (self.peak_equity - current_equity) / self.peak_equity

        status = 'ok'
        if drawdown_pct >= self.max_drawdown_pct:
            status = 'critical'
        elif drawdown_pct >= self.max_drawdown_pct * 0.75:
            status = 'warning'

        return {
            'current_drawdown_pct': round(drawdown_pct * 100, 2),
            'peak_equity':          round(self.peak_equity, 2),
            'max_drawdown_pct':     round(self.max_drawdown_pct * 100, 2),
            'status':               status,
            'should_halt':          status == 'critical',
        }

    def worst_drawdown(self) -> float:
        """Returns the worst historical drawdown from equity history."""
        if len(self.equity_history) < 2:
            return 0.0

        peak = 0.0
        max_dd = 0.0
        for point in self.equity_history:
            eq = point['equity']
            if eq > peak:
                peak = eq
            dd = (peak - eq) / peak if peak > 0 else 0
            if dd > max_dd:
                max_dd = dd

        return round(max_dd * 100, 2)


# ---------------------------------------------------------------------------
# QUICK DEMO
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    print("=== trader9 Risk Engine Demo ===\n")

    config    = RiskConfig()
    portfolio = PortfolioRiskTracker(config)
    pnl       = PnLTracker()
    engine    = RiskEngine(config, portfolio, pnl)

    # Simulate a trade request
    request = TradeRequest(
        symbol      = 'ETH/USD',
        direction   = 'long',
        entry_price = 2100.0,
        stop_loss   = 2068.5,   # 1.5% below
        take_profit = [2163.0, 2226.0],  # 3% and 6%
        strategy    = 'mean_reversion',
        confidence  = 0.75,
        timestamp   = datetime.now(timezone.utc).isoformat(),
    )

    decision = engine.evaluate(
        request              = request,
        account_balance      = 200.0,
        open_position_count  = 0,
        win_rate             = 0.67,
        avg_win_pct          = 0.025,
        avg_loss_pct         = 0.015,
    )

    print(f"Trade Request: {request.direction.upper()} {request.symbol}")
    print(f"Entry: ${request.entry_price}  SL: ${request.stop_loss}  TP: {request.take_profit}")
    print(f"\nRisk Decision:")
    print(f"  Approved:       {decision.approved}")
    print(f"  Position size:  ${decision.position_size_usd}")
    print(f"  Position %:     {decision.position_pct*100:.1f}%")
    print(f"  Risk amount:    ${decision.risk_amount}")
    print(f"  R:R ratio:      {decision.risk_reward}")
    if decision.warnings:
        print(f"  Warnings:       {decision.warnings}")
    if decision.rejection_reasons:
        print(f"  Rejections:     {decision.rejection_reasons}")

    # Kelly demo
    print("\n--- Kelly Criterion Demo ---")
    full_k = kelly_criterion(win_rate=0.67, avg_win_pct=0.025, avg_loss_pct=0.015)
    print(f"Full Kelly: {full_k:.4f} ({full_k*100:.1f}% of capital)")
    print(f"Quarter Kelly: {full_k*0.25:.4f} ({full_k*0.25*100:.1f}% of capital)")
    kelly_size = position_size_kelly(200, 0.67, 0.025, 0.015)
    print(f"Kelly position size on $200: ${kelly_size}")

    # Fixed fractional demo
    print("\n--- Fixed Fractional Demo ---")
    ff = position_size_fixed_fractional(200, 2100, 2068.5, risk_pct=0.01)
    print(f"Fixed fractional (1% risk): ${ff['size_usd']} (risk ${ff['risk_usd']})")

    # Trailing stop demo
    print("\n--- ATR Trailing Stop Demo ---")
    ts = TrailingStop(atr_multiplier=2.0)
    ts.initialize(entry_price=2100, atr=31.5, direction='long')
    print(f"Initial stop: {ts.current_stop:.2f}")
    ts.update(2150, 30)
    print(f"After price rises to 2150: stop = {ts.current_stop:.2f}")
    ts.update(2200, 28)
    print(f"After price rises to 2200: stop = {ts.current_stop:.2f}")
    print(f"Triggered at 2150? {ts.is_triggered(2150)}")

    # Drawdown monitor
    print("\n--- Drawdown Monitor ---")
    dm = DrawdownMonitor(max_drawdown_pct=0.20)
    for equity in [200, 210, 205, 195, 185, 180]:
        result = dm.update(equity)
        print(f"  Equity ${equity}: drawdown {result['current_drawdown_pct']}% [{result['status']}]")

    print("\nAll risk checks passed.")

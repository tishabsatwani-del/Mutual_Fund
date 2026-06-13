"""Common mutual fund / investment calculators.

All functions are pure and rely only on the Python standard library.
"""

from __future__ import annotations

from datetime import date
from typing import Sequence, Tuple


def absolute_return(invested: float, current_value: float) -> float:
    """Simple absolute return as a fraction.

    A value of 0.25 means a 25% gain. Returns are negative for a loss.
    """
    if invested <= 0:
        raise ValueError("invested must be positive")
    return (current_value - invested) / invested


def cagr(invested: float, current_value: float, years: float) -> float:
    """Compound Annual Growth Rate as a fraction.

    Args:
        invested: Amount originally invested.
        current_value: Value at the end of the period.
        years: Holding period in years (must be > 0).
    """
    if invested <= 0:
        raise ValueError("invested must be positive")
    if current_value < 0:
        raise ValueError("current_value cannot be negative")
    if years <= 0:
        raise ValueError("years must be positive")
    return (current_value / invested) ** (1.0 / years) - 1.0


def lumpsum_future_value(principal: float, annual_rate: float, years: float) -> float:
    """Future value of a one-time investment compounded annually.

    Args:
        principal: Amount invested today.
        annual_rate: Expected annual return as a fraction (0.12 == 12%).
        years: Investment horizon in years.
    """
    if principal < 0:
        raise ValueError("principal cannot be negative")
    if years < 0:
        raise ValueError("years cannot be negative")
    return principal * (1.0 + annual_rate) ** years


def sip_future_value(
    monthly_investment: float, annual_rate: float, years: float
) -> float:
    """Future value of a monthly SIP using the standard annuity formula.

    Contributions are assumed to be made at the start of each month.

    Args:
        monthly_investment: Amount invested every month.
        annual_rate: Expected annual return as a fraction (0.12 == 12%).
        years: Investment horizon in years.
    """
    if monthly_investment < 0:
        raise ValueError("monthly_investment cannot be negative")
    if years < 0:
        raise ValueError("years cannot be negative")

    months = int(round(years * 12))
    monthly_rate = annual_rate / 12.0

    if monthly_rate == 0:
        return monthly_investment * months

    growth = (1.0 + monthly_rate) ** months
    # Annuity-due: contributions at the beginning of each period.
    return monthly_investment * ((growth - 1.0) / monthly_rate) * (1.0 + monthly_rate)


def _xnpv(rate: float, cashflows: Sequence[Tuple[date, float]]) -> float:
    """Net present value for irregularly spaced cashflows (day-count basis)."""
    t0 = cashflows[0][0]
    return sum(
        amount / (1.0 + rate) ** ((when - t0).days / 365.0)
        for when, amount in cashflows
    )


def xirr(
    cashflows: Sequence[Tuple[date, float]],
    guess: float = 0.1,
    tol: float = 1e-6,
    max_iter: int = 100,
) -> float:
    """Internal Rate of Return for dated cashflows (the XIRR of a portfolio).

    Investments are negative cashflows, redemptions / current value positive.
    Solved with the Newton-Raphson method, falling back to bisection.

    Args:
        cashflows: Sequence of (date, amount) pairs. Needs at least one
            negative and one positive amount.
        guess: Initial rate estimate.
        tol: Convergence tolerance on the NPV.
        max_iter: Maximum number of iterations.

    Returns:
        The annualised internal rate of return as a fraction.
    """
    if len(cashflows) < 2:
        raise ValueError("xirr needs at least two cashflows")
    amounts = [amount for _, amount in cashflows]
    if not (any(a > 0 for a in amounts) and any(a < 0 for a in amounts)):
        raise ValueError("xirr needs both positive and negative cashflows")

    flows = sorted(cashflows, key=lambda cf: cf[0])

    rate = guess
    for _ in range(max_iter):
        npv = _xnpv(rate, flows)
        if abs(npv) < tol:
            return rate
        # Numerical derivative for the Newton step.
        delta = 1e-6
        derivative = (_xnpv(rate + delta, flows) - npv) / delta
        if derivative == 0:
            break
        new_rate = rate - npv / derivative
        if new_rate <= -1.0:  # keep the discount factor well-defined
            new_rate = (rate - 1.0) / 2.0
        if abs(new_rate - rate) < tol:
            return new_rate
        rate = new_rate

    # Fallback: bisection over a wide bracket.
    low, high = -0.9999, 10.0
    f_low = _xnpv(low, flows)
    for _ in range(200):
        mid = (low + high) / 2.0
        f_mid = _xnpv(mid, flows)
        if abs(f_mid) < tol:
            return mid
        if (f_low < 0) != (f_mid < 0):
            high = mid
        else:
            low, f_low = mid, f_mid
    raise ValueError("xirr failed to converge")

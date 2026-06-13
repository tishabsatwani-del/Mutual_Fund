"""Portfolio aggregation over multiple fund holdings."""

from __future__ import annotations

from typing import Dict, Iterable, List

from .calculators import absolute_return
from .fund import Fund, Holding


class Portfolio:
    """A collection of mutual fund holdings with aggregate metrics."""

    def __init__(self, holdings: Iterable[Holding] | None = None) -> None:
        self._holdings: List[Holding] = list(holdings or [])

    @property
    def holdings(self) -> List[Holding]:
        return list(self._holdings)

    def add_investment(self, fund: Fund, amount: float) -> Holding:
        """Buy ``amount`` worth of ``fund`` at its current NAV.

        If the fund is already held, the new units and cost are merged into
        the existing holding. Returns the affected holding.
        """
        if amount <= 0:
            raise ValueError("amount must be positive")
        if fund.nav <= 0:
            raise ValueError("cannot buy a fund with non-positive NAV")

        units = amount / fund.nav
        existing = self._find(fund.scheme_code)
        if existing is not None:
            existing.units += units
            existing.invested_amount += amount
            return existing

        holding = Holding(fund=fund, units=units, invested_amount=amount)
        self._holdings.append(holding)
        return holding

    def _find(self, scheme_code: str) -> Holding | None:
        for holding in self._holdings:
            if holding.fund.scheme_code == scheme_code:
                return holding
        return None

    @property
    def invested_amount(self) -> float:
        return sum(h.invested_amount for h in self._holdings)

    @property
    def current_value(self) -> float:
        return sum(h.current_value for h in self._holdings)

    @property
    def profit_loss(self) -> float:
        return self.current_value - self.invested_amount

    @property
    def total_return(self) -> float:
        """Absolute return across the whole portfolio (0 if nothing invested)."""
        if self.invested_amount == 0:
            return 0.0
        return absolute_return(self.invested_amount, self.current_value)

    def allocation(self) -> Dict[str, float]:
        """Fraction of current value held in each fund, keyed by scheme code."""
        total = self.current_value
        if total == 0:
            return {h.fund.scheme_code: 0.0 for h in self._holdings}
        return {h.fund.scheme_code: h.current_value / total for h in self._holdings}

    def __len__(self) -> int:
        return len(self._holdings)

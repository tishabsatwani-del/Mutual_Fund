"""Core data models: a mutual fund scheme and a holding in a portfolio."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Fund:
    """A mutual fund scheme.

    Attributes:
        scheme_code: Unique identifier for the scheme (e.g. AMFI code).
        name: Human-readable scheme name.
        nav: Current Net Asset Value per unit.
        category: Optional category label (e.g. "Equity", "Debt").
    """

    scheme_code: str
    name: str
    nav: float
    category: str = ""

    def __post_init__(self) -> None:
        if self.nav < 0:
            raise ValueError("nav cannot be negative")


@dataclass
class Holding:
    """An investment in a single fund.

    Attributes:
        fund: The fund being held.
        units: Number of units owned.
        invested_amount: Total amount invested (cost basis).
    """

    fund: Fund
    units: float
    invested_amount: float

    def __post_init__(self) -> None:
        if self.units < 0:
            raise ValueError("units cannot be negative")
        if self.invested_amount < 0:
            raise ValueError("invested_amount cannot be negative")

    @property
    def current_value(self) -> float:
        """Market value of the holding at the fund's current NAV."""
        return self.units * self.fund.nav

    @property
    def average_cost_nav(self) -> float:
        """Average NAV paid per unit, or 0 if no units are held."""
        if self.units == 0:
            return 0.0
        return self.invested_amount / self.units

    @property
    def profit_loss(self) -> float:
        """Unrealised profit or loss for the holding."""
        return self.current_value - self.invested_amount

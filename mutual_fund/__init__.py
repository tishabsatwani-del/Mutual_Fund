"""Mutual Fund portfolio tracker and calculators.

A small, dependency-free toolkit for modelling mutual fund holdings,
computing portfolio value and returns, and running common investment
calculators (lumpsum, SIP, CAGR, XIRR).
"""

from .fund import Fund, Holding
from .portfolio import Portfolio
from .calculators import (
    cagr,
    absolute_return,
    lumpsum_future_value,
    sip_future_value,
    xirr,
)

__all__ = [
    "Fund",
    "Holding",
    "Portfolio",
    "cagr",
    "absolute_return",
    "lumpsum_future_value",
    "sip_future_value",
    "xirr",
]

__version__ = "0.1.0"

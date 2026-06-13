"""Tiny end-to-end demo of the mutual_fund toolkit.

Run from the repo root:

    python examples/demo.py
"""

import os
import sys
from datetime import date

# Allow running directly with `python examples/demo.py` from the repo root.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from mutual_fund import Fund, Portfolio, sip_future_value, xirr


def main() -> None:
    bluechip = Fund("100001", "Bluechip Equity Fund", nav=20.0, category="Equity")
    liquid = Fund("200002", "Liquid Debt Fund", nav=10.0, category="Debt")

    portfolio = Portfolio()
    portfolio.add_investment(bluechip, 75_000)
    portfolio.add_investment(liquid, 25_000)

    print("Holdings")
    for h in portfolio.holdings:
        print(
            f"  {h.fund.name:<22} units={h.units:>10.3f} "
            f"value={h.current_value:>12,.2f}"
        )

    print(f"\nInvested      : {portfolio.invested_amount:,.2f}")
    print(f"Current value : {portfolio.current_value:,.2f}")
    print(f"Total return  : {portfolio.total_return:.2%}")

    print("\nAllocation")
    for code, frac in portfolio.allocation().items():
        print(f"  {code}: {frac:.1%}")

    print("\nSIP projection (5,000/month, 12% p.a., 15 yrs):")
    print(f"  {sip_future_value(5000, 0.12, 15):,.2f}")

    print("\nXIRR of a sample cashflow:")
    flows = [
        (date(2022, 1, 1), -50_000.0),
        (date(2023, 1, 1), -50_000.0),
        (date(2024, 1, 1), 120_000.0),
    ]
    print(f"  {xirr(flows):.2%}")


if __name__ == "__main__":
    main()

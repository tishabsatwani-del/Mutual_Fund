import math
import unittest
from datetime import date

from mutual_fund.calculators import (
    absolute_return,
    cagr,
    lumpsum_future_value,
    sip_future_value,
    xirr,
)


class TestCalculators(unittest.TestCase):
    def test_absolute_return(self):
        self.assertAlmostEqual(absolute_return(1000, 1250), 0.25)
        self.assertAlmostEqual(absolute_return(1000, 800), -0.20)

    def test_absolute_return_invalid(self):
        with self.assertRaises(ValueError):
            absolute_return(0, 100)

    def test_cagr_doubling_over_two_years(self):
        # Doubling in 2 years ~= 41.42% CAGR.
        self.assertAlmostEqual(cagr(1000, 2000, 2), math.sqrt(2) - 1, places=6)

    def test_cagr_invalid_years(self):
        with self.assertRaises(ValueError):
            cagr(1000, 2000, 0)

    def test_lumpsum_future_value(self):
        self.assertAlmostEqual(lumpsum_future_value(1000, 0.10, 1), 1100.0)
        self.assertAlmostEqual(lumpsum_future_value(1000, 0.10, 2), 1210.0)

    def test_sip_zero_rate_is_sum_of_contributions(self):
        self.assertAlmostEqual(sip_future_value(1000, 0.0, 2), 1000 * 24)

    def test_sip_future_value_positive_rate(self):
        # 5000/month at 12% for 10 years -> well-known ballpark ~11.6 lakh.
        fv = sip_future_value(5000, 0.12, 10)
        self.assertGreater(fv, 1_100_000)
        self.assertLess(fv, 1_200_000)

    def test_xirr_simple_doubling(self):
        flows = [(date(2020, 1, 1), -1000.0), (date(2021, 1, 1), 1100.0)]
        rate = xirr(flows)
        self.assertAlmostEqual(rate, 0.10, places=3)

    def test_xirr_requires_sign_change(self):
        flows = [(date(2020, 1, 1), -1000.0), (date(2021, 1, 1), -500.0)]
        with self.assertRaises(ValueError):
            xirr(flows)


if __name__ == "__main__":
    unittest.main()

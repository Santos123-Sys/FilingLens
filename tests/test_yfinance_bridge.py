"""Offline, network-free tests for the exact yfinance bridge used on Railway."""
import importlib.util
import pathlib
import unittest

import pandas as pd

BRIDGE = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "yfinance_bridge.py"
spec = importlib.util.spec_from_file_location("yfinance_bridge", BRIDGE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakeTicker:
    def __init__(self, symbol):
        self.symbol = symbol

    def history(self, **kwargs):
        assert kwargs["auto_adjust"] is False
        return pd.DataFrame({"Close": [336.64]}, index=pd.DatetimeIndex(["2026-10-09"], tz="America/New_York"))

    def get_fast_info(self):
        return {"market_cap": 4_912_000_000_000, "currency": "USD"}

    def get_revenue_estimate(self):
        return pd.DataFrame({"avg": [477_850_000_000, 528_210_000_000],
                             "low": [450_000_000_000, 500_000_000_000],
                             "high": [510_000_000_000, 550_000_000_000],
                             "numberOfAnalysts": [40, 35]}, index=["0y", "+1y"])

    def get_earnings_estimate(self):
        return pd.DataFrame({"avg": [8.83, 10.12], "low": [8.0, 9.4],
                             "high": [9.3, 11.0], "numberOfAnalysts": [36, 30]},
                            index=["0y", "+1y"])

    def get_eps_trend(self):
        return pd.DataFrame({"30daysAgo": [8.3, 9.9]}, index=["0y", "+1y"])

    def get_eps_revisions(self):
        return pd.DataFrame({"upLast30days": [12, 8],
                             "downLast30days": [2, 3]}, index=["0y", "+1y"])

    def get_income_stmt(self, **kwargs):
        return pd.DataFrame({"2025-09-27": [416_161_000_000]})

class YahooBridgeTests(unittest.TestCase):
    def test_rejects_invalid_symbol_before_ever_fetching(self):
        self.assertEqual(module.collect("AAPL;rm -rf /")["error"], "invalid_symbol")

    def test_returns_annual_buckets_daily_close_and_revision_fields(self):
        result = module.collect("AAPL", FakeTicker)
        self.assertIsNone(result["quoteError"])
        self.assertEqual(result["quote"]["tradingDate"], "2026-10-09")
        self.assertEqual(result["quote"]["priceBasis"], "unadjusted_daily_close")
        self.assertEqual(result["quote"]["currency"], "USD")
        self.assertEqual(result["consensus"][0]["yahooBucket"], "0y")
        self.assertEqual(result["consensus"][0]["epsTrend30dAgo"], 8.3)
        self.assertEqual(result["consensus"][0]["epsRevisionsUp30d"], 12)
        self.assertIn("forward_ebit_not_available_from_yahoo", result["warnings"])

    def test_refuses_non_finite_numbers(self):
        self.assertIsNone(module.finite(float("nan")))
        self.assertIsNone(module.finite(float("inf")))
        self.assertIsNone(module.finite(True))

if __name__ == "__main__":
    unittest.main()

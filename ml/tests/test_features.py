import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd


SRC_DIR = Path(__file__).resolve().parent.parent / "src"
sys.path.insert(0, str(SRC_DIR))

from features import FEATURES, make_features  # noqa: E402


def sample_prices(scale: float = 1.0) -> pd.DataFrame:
    dates = pd.bdate_range("2024-01-02", periods=80, tz="UTC")
    trend = np.arange(len(dates), dtype=float)
    return pd.DataFrame(
        {
            "date": dates,
            "adjClose": scale * (100.0 + trend + np.sin(trend)),
            "adjVolume": 1_000_000.0 + 1_000.0 * trend,
        }
    )


class FeatureTests(unittest.TestCase):
    def setUp(self) -> None:
        self.stock = sample_prices(1.2)
        self.benchmarks = {
            "SPY": sample_prices(4.0),
            "QQQ": sample_prices(3.0),
        }

    def test_all_expected_features_are_finite(self) -> None:
        result = make_features(self.stock, self.benchmarks, include_target=True)
        self.assertGreater(len(result), 0)
        self.assertTrue(np.isfinite(result[list(FEATURES)]).all().all())
        self.assertTrue(np.isfinite(result["target"]).all())

    def test_target_is_the_following_business_day_return(self) -> None:
        result = make_features(self.stock, self.benchmarks, include_target=True)
        row = result.iloc[0]
        source_index = self.stock.index[self.stock["date"] == row["date"]][0]
        expected = np.log(
            self.stock.loc[source_index + 1, "adjClose"]
            / self.stock.loc[source_index, "adjClose"]
        )
        self.assertAlmostEqual(row["target"], expected)


if __name__ == "__main__":
    unittest.main()

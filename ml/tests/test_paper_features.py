import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd


SRC_DIR = Path(__file__).resolve().parent.parent / "src"
sys.path.insert(0, str(SRC_DIR))

from paper_features import DIRECTION_FEATURES, make_direction_features  # noqa: E402


def sample_prices(scale: float = 1.0, periods: int = 160) -> pd.DataFrame:
    dates = pd.bdate_range("2024-01-02", periods=periods, tz="UTC")
    index = np.arange(periods, dtype=float)
    close = scale * (100 + 0.08 * index + 3 * np.sin(index / 4))
    return pd.DataFrame(
        {
            "date": dates,
            "adjOpen": close - 0.3,
            "adjHigh": close + 1.0,
            "adjLow": close - 1.0,
            "adjClose": close,
            "adjVolume": 1_000_000 + 4_000 * index,
        }
    )


class PaperFeatureTests(unittest.TestCase):
    def setUp(self) -> None:
        self.stock = sample_prices(1.2)
        self.benchmarks = {
            "SPY": sample_prices(4.0),
            "QQQ": sample_prices(3.0),
        }

    def test_direction_features_are_finite_and_binary(self) -> None:
        result = make_direction_features(
            self.stock,
            self.benchmarks,
            horizon=5,
            smoothing_alpha=0.2,
            include_target=True,
        )
        self.assertGreater(len(result), 0)
        self.assertTrue(np.isfinite(result[list(DIRECTION_FEATURES)]).all().all())
        self.assertEqual(set(result["target_direction"].unique()), {0.0, 1.0})

    def test_direction_target_uses_the_requested_future_horizon(self) -> None:
        horizon = 5
        result = make_direction_features(
            self.stock,
            self.benchmarks,
            horizon=horizon,
            smoothing_alpha=0.2,
            include_target=True,
        )
        row = result.iloc[0]
        source_index = self.stock.index[self.stock["date"] == row["date"]][0]
        expected = int(
            self.stock.loc[source_index + horizon, "adjClose"]
            > self.stock.loc[source_index, "adjClose"]
        )
        self.assertEqual(row["target_direction"], expected)

    def test_future_changes_do_not_modify_past_features(self) -> None:
        changed = self.stock.copy()
        changed.loc[120:, ["adjOpen", "adjHigh", "adjLow", "adjClose"]] *= 10

        original_features = make_direction_features(
            self.stock,
            self.benchmarks,
            horizon=5,
            smoothing_alpha=0.2,
            include_target=False,
        )
        changed_features = make_direction_features(
            changed,
            self.benchmarks,
            horizon=5,
            smoothing_alpha=0.2,
            include_target=False,
        )
        comparison_date = self.stock.loc[100, "date"]
        original_row = original_features.loc[
            original_features["date"] == comparison_date, list(DIRECTION_FEATURES)
        ]
        changed_row = changed_features.loc[
            changed_features["date"] == comparison_date, list(DIRECTION_FEATURES)
        ]
        np.testing.assert_allclose(original_row, changed_row)


if __name__ == "__main__":
    unittest.main()

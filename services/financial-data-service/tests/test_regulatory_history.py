from app.providers.cvm import _scale_multiplier
from app.providers.sec_edgar import _annual_facts


def test_sec_annual_selector_uses_distinct_fact_periods():
    facts = {
        "facts": {
            "us-gaap": {
                "Revenues": {
                    "units": {
                        "USD": [
                            {"val": 100, "form": "10-K", "fp": "FY", "start": "2021-01-01", "end": "2021-12-31", "filed": "2022-02-01"},
                            {"val": 110, "form": "10-K", "fp": "FY", "start": "2022-01-01", "end": "2022-12-31", "filed": "2023-02-01"},
                            {"val": 120, "form": "10-K", "fp": "FY", "start": "2023-01-01", "end": "2023-12-31", "filed": "2024-02-01"},
                            {"val": 130, "form": "10-K", "fp": "FY", "start": "2024-01-01", "end": "2024-12-31", "filed": "2025-02-01"},
                            {"val": 140, "form": "10-K", "fp": "FY", "start": "2025-01-01", "end": "2025-12-31", "filed": "2026-02-01"},
                            # Later filing repeats the 2024 comparative fact. It
                            # should replace, not create a sixth history period.
                            {"val": 131, "form": "10-K", "fp": "FY", "start": "2024-01-01", "end": "2024-12-31", "filed": "2026-02-01"},
                            {"val": 99, "form": "10-Q", "fp": "Q1", "start": "2026-01-01", "end": "2026-03-31", "filed": "2026-05-01"},
                        ]
                    }
                }
            }
        }
    }
    selected = _annual_facts(facts, ["Revenues"], duration_metric=True, history_years=5)
    assert [item["end"] for item in selected] == [
        "2021-12-31", "2022-12-31", "2023-12-31", "2024-12-31", "2025-12-31"
    ]
    assert selected[-2]["_value"] == 131


def test_cvm_scaling_normalizes_reported_units_to_base_brl():
    assert _scale_multiplier("MIL") == 1_000
    assert _scale_multiplier("milhares") == 1_000
    assert _scale_multiplier("MILHÃO") == 1_000_000
    assert _scale_multiplier("UNIDADE") == 1

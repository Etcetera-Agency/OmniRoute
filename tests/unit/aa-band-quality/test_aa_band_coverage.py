"""Pure offline checks; never import OmniRoute or initialize its database."""

import copy
import importlib.util
from pathlib import Path
import unittest


SCRIPT = (Path(__file__).parents[3] / "openspec/changes/fix-free-band-quality-sources"
          / "evidence/calculation/coverage.py")
SPEC = importlib.util.spec_from_file_location("aa_coverage", SCRIPT)
coverage = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(coverage)


def model(index, general, coding):
    return {"id": str(index), "name": f"Model {index}", "slug": f"model-{index}",
            "release_date": "2026-01-01", "model_creator": {"id": "lab"},
            "evaluations": {"artificial_analysis_intelligence_index": general,
                            "artificial_analysis_coding_index": coding}}


class CoverageTests(unittest.TestCase):
    def setUp(self):
        self.aa = {"captured_at": "now", "intelligence_index_version": 4.3,
                   "data": [model(i, i, 100-i) for i in range(10)]}
        self.candidates = {"captured_at": "now", "source": "test",
                           "candidates": [{"provider": "provider", "model": "model-0"}]}
        self.metadata = {"captured_at": "now", "models": {
            row["id"]: {"name": row["name"], "deprecated": False,
                        "intelligenceIndexIsEstimated": False, "isReasoning": False}
            for row in self.aa["data"]}}
        self.mapping = {"provider": "provider", "model": "model-0", "aa_id": "0",
                        "aa_models": [{"id": "0", "name": "Model 0", "creator_id": "lab",
                                       "release_date": "2026-01-01"}],
                        "identity_evidence": "fixture: exact identity",
                        "configuration": "non-reasoning", "fixed_configuration": True,
                        "configuration_evidence": "fixture: non-reasoning-only model"}

    def report(self, mappings=None):
        return coverage.build_report(self.candidates, self.aa,
                                     [self.mapping] if mappings is None else mappings, self.metadata)

    def test_name_suggestion_does_not_award_rating(self):
        result = self.report([])
        self.assertTrue(result["models"][0]["suggestions"])
        self.assertEqual(result["scored_counts"], {"coding": 0, "general": 0})
        self.assertEqual(result["models"][0]["tasks"]["coding"]["bands"], ["low"])

    def test_tasks_have_independent_rankings(self):
        result = self.report()["models"][0]["tasks"]
        self.assertEqual(result["coding"]["bands"], ["high"])
        self.assertEqual(result["general"]["bands"], ["low"])

    def test_unknown_effort_uses_a_marked_model_estimate(self):
        self.mapping["fixed_configuration"] = False
        self.mapping["configuration"] = "high"
        result = self.report()
        self.assertEqual(result["identity_matches"], 1)
        self.assertEqual(result["configuration_matches"], 0)
        self.assertEqual(result["models"][0]["tasks"]["coding"]["status"], "estimated")
        self.assertIn("aa_effort_proxy", result["models"][0]["tasks"]["coding"]["estimate_reasons"])

    def test_zero_is_measured_and_null_is_unrated(self):
        self.aa["data"][0]["evaluations"]["artificial_analysis_coding_index"] = None
        result = self.report()["models"][0]["tasks"]
        self.assertEqual(result["general"]["status"], "rated")
        self.assertEqual(result["coding"]["reason"], "metric_unmeasured")

    def test_changed_identity_is_rejected(self):
        self.aa["data"][0]["model_creator"]["id"] = "other-lab"
        self.assertEqual(self.report()["identity_matches"], 0)

    def test_duplicate_accounts_do_not_inflate_counts(self):
        self.candidates["candidates"] *= 3
        self.assertEqual(self.report()["candidate_count"], 1)

    def test_ties_are_equal_and_overlapping_ranges_are_inclusive(self):
        self.assertEqual(coverage.percentile(1, [0, 1, 1, 2]), 0.5)
        bands = [b for b, (lo, hi) in coverage.RANGES.items() if lo <= 0.7 <= hi]
        self.assertEqual(bands, ["mid", "high"])

    def test_duplicate_aa_ids_are_rejected(self):
        self.aa["data"].append(copy.deepcopy(self.aa["data"][0]))
        with self.assertRaises(ValueError):
            self.report()

    def test_estimates_can_score_but_do_not_inflate_reference(self):
        self.metadata["models"]["0"]["intelligenceIndexIsEstimated"] = True
        result = self.report()
        self.assertEqual(result["reference_counts"]["general"], 9)
        self.assertEqual(result["reference_counts"]["coding"], 10)
        self.assertEqual(result["models"][0]["tasks"]["general"]["status"], "estimated")
        self.assertEqual(result["models"][0]["tasks"]["coding"]["status"], "rated")

    def test_unknown_estimation_status_is_not_false(self):
        del self.metadata["models"]["0"]["intelligenceIndexIsEstimated"]
        self.assertEqual(self.report()["measured_counts"]["general"], 0)

    def test_public_metadata_score_drift_is_rejected(self):
        self.metadata["models"]["0"]["intelligenceIndex"] = 90
        with self.assertRaises(ValueError):
            self.report()

    def test_fixed_reasoning_needs_matching_aa_mode(self):
        self.mapping["configuration"] = "fixed-reasoning"
        self.assertEqual(self.report()["configuration_matches"], 0)
        self.metadata["models"]["0"]["isReasoning"] = True
        self.assertEqual(self.report()["configuration_matches"], 1)

    def configure_effort_variants(self):
        self.mapping.pop("fixed_configuration")
        self.mapping["reasoning_audit"] = {"aa_modes": {"low": "low", "medium": "medium", "high": "high"}, "default_mode": "medium"}
        self.mapping["aa_models"] = []
        for index, label in [(0, "Low"), (5, "Medium"), (9, "High")]:
            row = self.aa["data"][index]
            self.metadata["models"][str(index)].update(suffix=label, isReasoning=True)
            self.mapping["aa_models"].append({"id": str(index), "name": row["name"],
                                             "creator_id": "lab", "release_date": "2026-01-01"})

    def test_explicit_effort_selects_different_aa_records(self):
        self.configure_effort_variants()
        for effort, expected in [("low", "0"), ("medium", "5"), ("high", "9")]:
            report = coverage.build_report(self.candidates, self.aa, [self.mapping], self.metadata, "reasoning-" + effort)
            self.assertEqual(report["models"][0]["selected_aa_ids"], [expected])
            self.assertTrue(report["models"][0]["configuration_matched"])

    def test_reference_uses_one_effort_selected_config_per_model(self):
        low = model(10, 5, 5)
        low.update(name="Variant Model (Low)", slug="variant-model-low")
        high = model(11, 95, 95)
        high.update(name="Variant Model (High)", slug="variant-model-high")
        self.aa["data"].extend([low, high])
        self.metadata["models"].update({
            "10": {"name": low["name"], "suffix": "Low", "isReasoning": True,
                   "deprecated": False, "intelligenceIndexIsEstimated": False},
            "11": {"name": high["name"], "suffix": "High", "isReasoning": True,
                   "deprecated": False, "intelligenceIndexIsEstimated": False},
        })

        low_report = coverage.build_report(self.candidates, self.aa, [self.mapping], self.metadata,
                                           "reasoning-low")
        high_report = coverage.build_report(self.candidates, self.aa, [self.mapping], self.metadata,
                                            "reasoning-high")

        self.assertEqual(low_report["reference_counts"]["coding"], 11)
        self.assertEqual(high_report["reference_counts"]["coding"], 11)
        self.assertEqual(low_report["reference_profile_counts"]["coding"],
                         {"exact_effort": 1, "same_model_proxy": 10})
        self.assertEqual(high_report["reference_profile_counts"]["coding"],
                         {"exact_effort": 1, "same_model_proxy": 10})

    def test_api_name_suffix_identifies_effort_and_shared_model(self):
        low = model(10, 10, 10)
        low.update(name="Variant Model (Low)", slug="variant-model-low")
        high = model(11, 90, 90)
        high.update(name="Variant Model (High)", slug="variant-model")
        self.aa["data"].extend([low, high])
        for row in [low, high]:
            self.metadata["models"][row["id"]] = {
                "name": row["name"], "deprecated": False,
                "intelligenceIndexIsEstimated": False, "isReasoning": True,
            }

        self.assertEqual(coverage.configuration_effort(high, self.metadata["models"]), "high")
        self.assertEqual(coverage.configuration_identity(low, self.metadata["models"]),
                         coverage.configuration_identity(high, self.metadata["models"]))

    def test_api_name_effort_takes_precedence_over_chart_metadata(self):
        high = model(10, 10, 10)
        high.update(name="Variant Model (High)", slug="variant-model")
        self.metadata["models"]["10"] = {
            "name": high["name"], "suffix": "Low", "deprecated": False,
            "intelligenceIndexIsEstimated": False, "isReasoning": True,
        }

        self.assertEqual(coverage.configuration_effort(high, self.metadata["models"]), "high")

    def test_high_reference_prefers_high_then_uses_xhigh_as_fallback(self):
        high = model(10, 40, 40)
        high.update(name="Variant Model (High)", slug="variant-model")
        xhigh = model(11, 55, 55)
        xhigh.update(name="Variant Model (Xhigh)", slug="variant-model-xhigh")
        self.aa["data"].extend([high, xhigh])
        for row, suffix in [(high, "High"), (xhigh, "Xhigh")]:
            self.metadata["models"][row["id"]] = {
                "name": row["name"], "suffix": suffix, "deprecated": False,
                "intelligenceIndexIsEstimated": False, "isReasoning": True,
            }

        values, counts = coverage.reference_population(
            self.aa["data"], self.metadata["models"], "coding", "reasoning-high"
        )
        self.assertEqual(counts, {"exact_effort": 1, "same_model_proxy": 10})
        self.assertIn(40, values)
        self.assertNotIn(55, values)

        del self.aa["data"][-2]
        del self.metadata["models"]["10"]
        values, counts = coverage.reference_population(
            self.aa["data"], self.metadata["models"], "coding", "reasoning-high"
        )
        self.assertEqual(counts, {"exact_effort": 1, "same_model_proxy": 10})
        self.assertIn(55, values)

    def test_missing_medium_uses_median_not_best_variant(self):
        self.configure_effort_variants()
        self.mapping["aa_models"] = [self.mapping["aa_models"][0], self.mapping["aa_models"][-1]]
        report = coverage.build_report(self.candidates, self.aa, [self.mapping], self.metadata, "reasoning-medium")
        rating = report["models"][0]["tasks"]["general"]
        self.assertEqual(rating["aa_score_or_estimate"], 4.5)
        self.assertEqual(rating["status"], "estimated")

    def test_missing_task_score_on_exact_effort_uses_same_model_proxy(self):
        self.configure_effort_variants()
        self.aa["data"][5]["evaluations"]["artificial_analysis_coding_index"] = None
        report = coverage.build_report(self.candidates, self.aa, [self.mapping], self.metadata,
                                       "reasoning-medium")
        coding = report["models"][0]["tasks"]["coding"]
        self.assertEqual(coding["status"], "estimated")
        self.assertIn("aa_effort_proxy", coding["estimate_reasons"])
        self.assertEqual(coding["aa_score_or_estimate"], 95.5)

    def test_provider_mapping_high_can_select_native_xhigh(self):
        self.configure_effort_variants()
        self.mapping["reasoning_audit"]["aa_modes"]["high"] = "xhigh"
        self.metadata["models"]["9"]["suffix"] = "Xhigh"
        high = model(10, 50, 50)
        high.update(name="Model 0 (High)", slug="model-0-high")
        self.aa["data"].append(high)
        self.metadata["models"]["10"] = {
            "name": high["name"], "suffix": "High", "deprecated": False,
            "intelligenceIndexIsEstimated": False, "isReasoning": True,
        }
        self.mapping["aa_models"].append({
            "id": "10", "name": high["name"], "creator_id": "lab",
            "release_date": "2026-01-01",
        })
        self.assertEqual(self.report()["models"][0]["selected_aa_ids"], ["9"])

    def test_missing_mapped_xhigh_uses_marked_high_sibling_proxy(self):
        self.configure_effort_variants()
        self.mapping["reasoning_audit"]["aa_modes"]["high"] = "xhigh"
        report = self.report()
        candidate = report["models"][0]
        self.assertEqual(candidate["selected_aa_ids"], ["9"])
        self.assertFalse(candidate["configuration_matched"])
        self.assertEqual(candidate["selection_basis"], "sibling_effort_proxy")
        self.assertEqual(candidate["tasks"]["coding"]["status"], "estimated")
        self.assertIn("aa_effort_proxy", candidate["tasks"]["coding"]["estimate_reasons"])

    def test_high_effort_prefers_high_over_xhigh_when_both_exist(self):
        self.configure_effort_variants()
        xhigh = model(10, 100, 100)
        xhigh.update(name="Model 0 (Xhigh)", slug="model-0-xhigh")
        self.aa["data"].append(xhigh)
        self.metadata["models"]["10"] = {
            "name": xhigh["name"], "suffix": "Xhigh", "deprecated": False,
            "intelligenceIndexIsEstimated": False, "isReasoning": True,
        }
        self.mapping["aa_models"].append({
            "id": "10", "name": xhigh["name"], "creator_id": "lab",
            "release_date": "2026-01-01",
        })

        selected, basis, exact, mode = coverage.select_mode(
            self.mapping, {row["id"]: row for row in self.aa["data"]},
            self.metadata["models"], "reasoning-high",
        )

        self.assertEqual([row["id"] for row in selected], ["9"])
        self.assertEqual((basis, exact, mode), ("exact_effort", True, "high"))

    def test_existing_fork_reasoning_filter_is_intersected_with_quality(self):
        snapshot = {"source": "actual fork inspector", "pools": {
            "general_low:free": ["provider/model-0"], "general_low_reasoning:free": []}}
        report = coverage.build_report(self.candidates, self.aa, [self.mapping], self.metadata,
                                       fork_filter=snapshot)
        self.assertEqual(report["band_counts"]["coding"]["high"], 1)
        self.assertEqual(report["reasoning_band_counts"]["coding"]["high"], 0)

    def test_fork_filter_from_different_pool_is_rejected(self):
        snapshot = {"source": "other pool", "pools": {
            "general_low:free": [], "general_low_reasoning:free": []}}
        with self.assertRaises(ValueError):
            coverage.build_report(self.candidates, self.aa, [self.mapping], self.metadata,
                                  fork_filter=snapshot)

    def test_fetch_visits_every_page(self):
        calls = []

        def fetch_page(page):
            calls.append(page)
            return {"intelligence_index_version": 4.3, "data": [model(page, page, page)],
                    "pagination": {"page": page, "total_pages": 3, "has_more": page < 3}}

        result = coverage.fetch_snapshot("never-sent", fetch_page)
        self.assertEqual(calls, [1, 2, 3])
        self.assertEqual(len(result["data"]), 3)

    def test_partial_pagination_is_rejected(self):
        def fetch_page(page):
            return {"intelligence_index_version": 4.3, "data": [model(page, page, page)],
                    "pagination": {"page": page, "total_pages": 3, "has_more": False}}

        with self.assertRaises(ValueError):
            coverage.fetch_snapshot("never-sent", fetch_page)


if __name__ == "__main__":
    unittest.main()

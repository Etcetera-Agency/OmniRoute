"""Offline tests for the agreed median and bidirectional task fallback."""
import copy
import importlib.util
from pathlib import Path
import unittest

path = (Path(__file__).parents[3] / "openspec/changes/fix-free-band-quality-sources"
        / "evidence/calculation/unify_fitness.py")
spec = importlib.util.spec_from_file_location("unify_fitness", path)
unify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(unify)


def observation(model, score, benchmark="SWE-bench Verified", **kwargs):
    return {"model": model, "score": score, "benchmark": benchmark,
            "metric": "percent", "effort": "high", "agent": "agent",
            "source": "https://fixture/" + model, "targets": [model], **kwargs}


def aa_model(target, coding=None, general=None, mode="high"):
    def task(score):
        if score is None:
            return {"status": "unrated"}
        return {"status": "rated", "fitness": score, "estimate_reasons": []}
    return {"provider": target.split("/")[0], "model": target.split("/", 1)[1],
            "mode": mode, "fork_reasoning_capable": True,
            "tasks": {"coding": task(coding), "general": task(general)}}


class UnifiedTests(unittest.TestCase):
    def setUp(self):
        self.rows = [observation(f"p/{name}", score)
                     for name, score in [("a", 10), ("b", 20), ("c", 30), ("d", 40), ("e", 50)]]

    def test_no_aa_uses_benchmarks_and_copies_coding_to_general(self):
        second_family = [observation(f"p/{name}", score, "Terminal-Bench 2.1")
                         for name, score in [("a", 10), ("b", 20), ("c", 30), ("d", 40), ("e", 50)]]
        report = unify.build_report([aa_model("p/c")], self.rows + second_family)
        row = report["models"][0]
        self.assertAlmostEqual(row["coding"], 0.5)
        self.assertEqual(row["general"], row["coding"])
        self.assertEqual(row["general_source"], "coding_fallback")

    def test_general_fills_missing_coding(self):
        row = unify.build_report([aa_model("p/a", general=.73)], [])["models"][0]
        self.assertEqual((row["coding"], row["general"]), (.73, .73))
        self.assertEqual(row["coding_source"], "general_fallback")

    def test_independent_existing_task_scores_are_preserved(self):
        row = unify.build_report([aa_model("p/a", .8, .3)], [])["models"][0]
        self.assertEqual((row["coding"], row["general"]), (.8, .3))

    def test_median_gives_one_vote_to_each_family(self):
        rows = self.rows + [observation(f"p/{name}", score, "Terminal-Bench 2.1")
                            for name, score in [("a", 99), ("b", 20), ("c", 30), ("d", 40), ("e", 50)]]
        row = unify.build_report([aa_model("p/a", coding=.7)], rows)["models"][0]
        self.assertEqual(len(row["family_votes"]), 3)
        self.assertEqual(row["coding"], .7)

    def test_duplicate_publication_and_provider_copy_do_not_change_score(self):
        baseline = unify.build_report([aa_model("p/a")], self.rows)["models"][0]["coding"]
        duplicate = copy.deepcopy(self.rows[0])
        duplicate["source"] = "https://hf/duplicate"
        duplicate["targets"].append("provider-copy/a")
        result = unify.build_report([aa_model("p/a"), aa_model("provider-copy/a")], self.rows + [duplicate])
        self.assertEqual([r["coding"] for r in result["models"]], [baseline, baseline])
        self.assertEqual(result["reference_counts"]["SWE-bench Verified"], 5)

    def test_punctuation_similar_names_need_an_explicit_alias(self):
        rows = [observation("p/model-a", 10), observation("p/modela", 90)]
        measured = unify.measurements(rows, {})
        self.assertEqual({row["canonical_model"] for row in measured}, {"p/model-a", "p/modela"})

    def test_exact_reviewed_alias_is_applied_without_fuzzy_matching(self):
        rows = [observation("owner/model-name", 10), observation("owner/modelname", 90)]
        measured = unify.measurements(rows, {"owner/model-name": "canonical/model"})
        self.assertEqual({row["canonical_model"] for row in measured}, {"canonical/model", "owner/modelname"})

    def test_equal_scores_from_different_agents_are_not_deduplicated(self):
        first = observation("p/a", 10)
        second = copy.deepcopy(first)
        second["agent"] = "another-agent"
        measured = unify.measurements(self.rows + [second], {})
        self.assertEqual(len(measured), 6)

    def test_fraction_and_percent_deduplicate(self):
        row = observation("p/a", .1, metric="fraction")
        report = unify.build_report([aa_model("p/a")], self.rows + [row])
        self.assertEqual(report["measurements_after_dedup"], 5)

    def test_invalid_fraction_is_not_silently_used_as_percent(self):
        with self.assertRaises(ValueError):
            unify.build_report([aa_model("p/a")], [observation("p/a", 70, metric="fraction")])

    def test_zero_aa_is_an_available_rating(self):
        row = unify.build_report([aa_model("p/a", coding=0)], [])["models"][0]
        self.assertEqual((row["coding"], row["general"]), (0, 0))

    def test_unrequested_benchmark_does_not_enter_score(self):
        row = unify.build_report([aa_model("p/a")], [observation("p/a", 99, "MMLU")])["models"][0]
        self.assertIsNone(row["coding"])

    def test_reference_does_not_depend_on_input_order(self):
        a = unify.build_report([aa_model("p/a")], self.rows)["models"][0]
        b = unify.build_report([aa_model("p/a")], list(reversed(self.rows)))["models"][0]
        self.assertEqual(a["coding"], b["coding"])

    def test_versions_are_ranked_separately_but_family_has_one_vote(self):
        rows = [observation(f"p/{name}", score, "Terminal-Bench 2.0")
                for name, score in [("a", 90), ("b", 99), ("c", 20), ("d", 30), ("e", 40)]]
        rows += [observation(f"p/{name}", score, "Terminal-Bench 2.1")
                 for name, score in [("a", 5), ("b", 1), ("c", 10), ("d", 20), ("e", 30)]]
        row = unify.build_report([aa_model("p/a")], rows)["models"][0]
        self.assertEqual(row["family_votes"], {"Terminal-Bench": .5})

    def test_exact_effort_is_preferred_and_missing_mode_is_proxy(self):
        rows = self.rows + [observation("p/a", 99, effort="max")]
        high = unify.build_report([aa_model("p/a")], rows)["models"][0]
        self.assertEqual(high["benchmark_votes"][0]["selected_scores"], [10])
        rows = [row for row in self.rows if row["model"] != "p/a"]
        rows += [observation("p/a", 10, effort=None), observation("p/a", 99, effort="max")]
        proxy = unify.build_report([aa_model("p/a", mode="medium")], rows)["models"][0]
        self.assertIn("effort_unknown_proxy", proxy["benchmark_votes"][0]["notes"])
        self.assertEqual(proxy["benchmark_votes"][0]["selected_scores"], [10])

    def test_high_profile_matches_xhigh_effort(self):
        rows = [observation(f"p/{name}", score, effort="xhigh" if name == "a" else "high")
                for name, score in [("a", 10), ("b", 20), ("c", 30), ("d", 40), ("e", 50)]]
        vote = unify.build_report([aa_model("p/a")], rows)["models"][0]["benchmark_votes"][0]
        self.assertEqual(vote["selected_efforts"], ["xhigh"])
        self.assertIn("sibling_effort_proxy", vote["notes"])

    def test_high_effort_prefers_high_when_both_high_and_xhigh_exist(self):
        rows = self.rows + [observation("p/a", 99, effort="xhigh")]
        vote = unify.build_report([aa_model("p/a")], rows)["models"][0]["benchmark_votes"][0]
        self.assertEqual(vote["selected_efforts"], ["high"])
        self.assertEqual(vote["selected_scores"], [10])

    def test_mapped_xhigh_uses_exact_xhigh_when_high_sibling_exists(self):
        rows = self.rows + [observation("p/a", 99, effort="xhigh")]
        vote = unify.build_report([aa_model("p/a", mode="xhigh")], rows)["models"][0]["benchmark_votes"][0]
        self.assertEqual(vote["selected_efforts"], ["xhigh"])
        self.assertEqual(vote["selected_scores"], [99])
        self.assertNotIn("sibling_effort_proxy", vote["notes"])

    def test_missing_mapped_xhigh_uses_marked_high_sibling_proxy(self):
        vote = unify.build_report([aa_model("p/a", mode="xhigh")], self.rows)["models"][0]["benchmark_votes"][0]
        self.assertEqual(vote["selected_efforts"], ["high"])
        self.assertIn("sibling_effort_proxy", vote["notes"])

    def test_singleton_reference_docs_and_data_agree(self):
        row = unify.build_report([aa_model("p/a")], self.rows[:1])["models"][0]
        self.assertEqual(row["benchmark_votes"], [])
        self.assertIsNone(row["coding"])

    def test_missing_effort_prefers_unknown_then_uses_other_effort_median(self):
        rows = [row for row in self.rows if row["model"] != "p/a"]
        rows += [observation("p/a", 10, effort="low"), observation("p/a", 20, effort="xhigh")]
        proxy = unify.build_report([aa_model("p/a", mode="medium")], rows)["models"][0]
        vote = proxy["benchmark_votes"][0]
        self.assertIn("cross_effort_proxy", vote["notes"])
        self.assertEqual(vote["selected_scores"], [10, 20])

    def test_singleton_does_not_create_a_benchmark_rating(self):
        row = unify.build_report([aa_model("p/a")], self.rows[:1])["models"][0]
        self.assertIsNone(row["coding"])
        self.assertEqual(row["benchmark_votes"], [])

    def test_benchmark_only_coding_needs_two_independent_families(self):
        one_family = unify.build_report([aa_model("p/a")], self.rows)["models"][0]
        self.assertIsNone(one_family["coding"])
        rows = self.rows + [observation(f"p/{name}", score, "Terminal-Bench 2.1")
                            for name, score in [("a", 10), ("b", 20), ("c", 30), ("d", 40), ("e", 50)]]
        two_families = unify.build_report([aa_model("p/a")], rows)["models"][0]
        self.assertIsNotNone(two_families["coding"])

    def test_empty_inputs_do_not_invent_zero_and_ranges_overlap(self):
        row = unify.build_report([aa_model("p/a")], [])["models"][0]
        self.assertIsNone(row["coding"])
        self.assertEqual(unify.bands(.75), ["mid", "high"])


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Offline median-fitness hypothesis over frozen AA, leaderboard, HF and search data."""
import argparse
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parent.parent
EVIDENCE = ROOT
RANGES = {"low": (0, .55), "mid": (.45, .8), "high": (.7, 1)}


def read(path):
    return json.loads(path.read_text())


def bands(score):
    return [name for name, (lo, hi) in RANGES.items() if score is not None and lo <= score <= hi]


def family(benchmark):
    for name in ["SWE-bench Verified", "SWE-bench Multilingual", "SWE-bench Pro"]:
        if benchmark.startswith(name):
            return "SWE-bench"
    for name in ["Terminal-Bench", "DeepSWE"]:
        if benchmark.startswith(name):
            return name
    return None


def measurements(rows, aliases):
    unique = {}
    for row in rows:
        if not family(row["benchmark"]):
            continue
        value = row["score"]
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
            raise ValueError("Benchmark score must be finite")
        if row["metric"] == "fraction":
            if not 0 <= value <= 1:
                raise ValueError("Fraction outside [0,1]")
            value *= 100
        if not 0 <= value <= 100:
            raise ValueError("Percentage outside [0,100]")
        canonical = aliases.get(row["model"], row["model"])
        effort = (row.get("effort") or "unknown").lower()
        agent = row.get("agent") or "unknown"
        # AICODE-NOTE: Deduplicate repeated publications only within the same
        # exact model, version, effort, and agent configuration.
        identifier = (canonical, row["benchmark"], effort, agent, round(value, 10))
        item = unique.setdefault(identifier, {
            "canonical_model": canonical, "benchmark": row["benchmark"],
            "effort": effort, "agent": agent, "score_percent": value,
            "sources": [], "targets": [],
        })
        for field, values in [("sources", [row["source"]]), ("targets", row.get("targets", []))]:
            item[field] = sorted(set(item[field]) | set(values))
    return list(unique.values())


def select_effort(rows, desired):
    choices = {"high": ("high", "xhigh"), "xhigh": ("xhigh", "high")}.get(desired, (desired,))
    for effort in choices:
        selected = [row for row in rows if row["effort"] == effort]
        if selected:
            return selected, "effort_match" if effort == desired else "sibling_effort_proxy"
    unknown = [row for row in rows if row["effort"] == "unknown"]
    if unknown:
        return unknown, "effort_unknown_proxy"
    return rows, "cross_effort_proxy" if rows else None


def build_report(aa_models, rows, aliases=None, effort="high", exclude=None):
    observed = measurements(rows, aliases or {})
    grouped = defaultdict(lambda: defaultdict(list))
    for row in observed:
        grouped[row["benchmark"]][row["canonical_model"]].append(row)
    # Compare each selected configuration with one same-profile score per model.
    populations = {}
    for benchmark, model_rows in grouped.items():
        population = []
        for available in model_rows.values():
            selected, _ = select_effort(available, effort)
            if selected:
                population.append(median([row["score_percent"] for row in selected]))
        populations[benchmark] = population
    results = []
    for aa in aa_models:
        target = aa["provider"] + "/" + aa["model"]
        desired = aa.get("mode")
        if desired not in ["none", "low", "medium", "high", "xhigh", "max", "ultra"]:
            desired = effort
        grouped = defaultdict(list)
        for row in observed:
            if target in row["targets"] and family(row["benchmark"]) != exclude:
                grouped[row["benchmark"]].append(row)
        votes, families = [], defaultdict(list)
        for benchmark, available in sorted(grouped.items()):
            selected, selection = select_effort(available, desired)
            value = median([row["score_percent"] for row in selected])
            population = populations[benchmark]
            if len(population) < 5:
                continue
            rank = (sum(x < value for x in population) + .5 * population.count(value)) / len(population)
            notes = [] if selection == "effort_match" else [selection]
            if "unspecified" in benchmark:
                notes.append("unspecified_benchmark_version")
            vote = {"benchmark": benchmark, "selected_scores": [r["score_percent"] for r in selected],
                    "score_percent": value, "fitness": rank, "reference_models": len(population),
                    "desired_effort": desired, "selected_efforts": sorted({r["effort"] for r in selected}),
                    "sources": sorted({s for r in selected for s in r["sources"]}), "notes": notes}
            votes.append(vote)
            families[family(benchmark)].append(rank)
        family_votes = {name: median(values) for name, values in families.items()}
        aa_coding = aa["tasks"]["coding"].get("fitness")
        aa_general = aa["tasks"]["general"].get("fitness")
        if aa_coding is not None and exclude != "AA Coding":
            family_votes["AA Coding"] = aa_coding
        benchmark_families = set(families)
        enough_coding_evidence = "AA Coding" in family_votes or len(benchmark_families) >= 2
        coding = median(list(family_votes.values())) if enough_coding_evidence else None
        coding_source = ("family_median" if benchmark_families else "AA Coding") if coding is not None else None
        general, general_source = aa_general, "AA Intelligence" if aa_general is not None else None
        # AICODE-NOTE: Owner's mandatory symmetric fallback. Missing AA is not zero
        # and never blocks an available leaderboard/HF/search benchmark estimate.
        if coding is None and general is not None:
            coding, coding_source = general, "general_fallback"
        if general is None and coding is not None:
            general, general_source = coding, "coding_fallback"
        results.append({"target": target, "requested_effort": effort, "effective_effort": desired,
                        "coding": coding, "general": general, "coding_source": coding_source,
                        "general_source": general_source, "aa_coding": aa_coding, "aa_general": aa_general,
                        "aa_estimate_reasons": {t: aa["tasks"][t].get("estimate_reasons", []) for t in ["coding", "general"]},
                        "family_votes": family_votes, "benchmark_votes": votes,
                        "bands": {"coding": bands(coding), "general": bands(general)},
                        "reasoning_capable": aa.get("fork_reasoning_capable", False)})
    report = {"hypothesis": "profile-matched model ranks; one median vote per family; symmetric task fallback",
              "effort": effort, "candidate_count": len(results), "measurements_after_dedup": len(observed),
              "reference_counts": {b: len(p) for b, p in sorted(populations.items())}, "models": results}
    report["scored_count"] = sum(r["coding"] is not None for r in results)
    report["no_numeric_evidence"] = [r["target"] for r in results if r["coding"] is None]
    for prefix, candidates in [("", results), ("reasoning_", [r for r in results if r["reasoning_capable"]])]:
        report[prefix + "band_counts"] = {task: {band: sum(band in r["bands"][task] for r in candidates)
                                                 for band in RANGES} for task in ["coding", "general"]}
    return report


def load_inputs(profile):
    name = f"aa-{profile}.json"
    aa = read(EVIDENCE / name)
    raw = read(EVIDENCE / "benchmark-results.json")
    rows = raw["results"] + raw["unmatched_board_rows"]
    aliases = {}
    for repo in read(EVIDENCE / "benchmark-hf.json")["repos"]:
        for alias in [repo["repo"], *repo["aliases"]]:
            canonical = repo["repo"]
            if alias in aliases and aliases[alias] != canonical:
                raise ValueError("Ambiguous reviewed alias: " + alias)
            aliases[alias] = canonical
    # Six model searches are already completed and schema-validated on disk.
    # Keep small-subset results in their OWN version/cohort, never the full board.
    search = EVIDENCE / "six-model-search"
    for filename in ["gemma3_270m", "allam_2_7b", "glyph_cluster", "big_pickle", "longcat_2_5_preview", "space_bunny"]:
        model = read(search / (filename + ".json"))
        for group in model["benchmarks"].values():
            for row in group["results"]:
                benchmark = row["benchmark_version"].replace("DeepSWE v", "DeepSWE ")
                rows.append({"model": row["model"], "targets": [model["model_id"]],
                             "score": row["score"], "metric": "percent", "benchmark": benchmark,
                             "effort": row["effort"], "agent": row["agent"], "source": row["source_url"]})
    return aa["models"], rows, aliases


def write_report(profile):
    models, rows, aliases = load_inputs(profile)
    report = build_report(models, rows, aliases, profile)
    aa_filename = f"aa-{profile}.json"
    inputs = [EVIDENCE / aa_filename, EVIDENCE / "benchmark-results.json", EVIDENCE / "benchmark-hf.json",
              *sorted((EVIDENCE / "six-model-search").glob("*.json"))]
    report["input_sha256"] = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs}
    sensitivity = {}
    for name in ["AA Coding", "SWE-bench", "Terminal-Bench", "DeepSWE"]:
        other = build_report(models, rows, aliases, profile, exclude=name)
        pairs = [(a, b) for a, b in zip(report["models"], other["models"])
                 if a["coding"] is not None and b["coding"] is not None]
        sensitivity[name] = {
            "scored_count": other["scored_count"],
            "median_absolute_coding_change": median([abs(a["coding"] - b["coding"]) for a, b in pairs]) if pairs else None,
            "coding_band_changes": [a["target"] for a, b in zip(report["models"], other["models"])
                                    if a["bands"]["coding"] != b["bands"]["coding"]],
        }
    report["leave_one_family_out"] = sensitivity
    path = EVIDENCE / f"unified-{profile}"
    path.with_suffix(".json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    lines = ["# Unified fitness hypothesis: " + profile, "", "Offline frozen snapshots; no inference or routing integration.", "",
             f"Numeric estimates: {report['scored_count']}/{report['candidate_count']}.", "",
             "| Provider/model | Family votes | Coding | General | Coding bands | General bands | Task fallback |",
             "|---|---|---|---|---|---|---|"]
    for row in report["models"]:
        family_values = ", ".join(f"{k}={v:.4f}" for k, v in row["family_votes"].items())
        fallback = ", ".join(s for s in [row["coding_source"], row["general_source"]] if s and "fallback" in s)
        values = ["—" if row[t] is None else f"{row[t]:.4f}" for t in ["coding", "general"]]
        lines.append("| " + " | ".join([row["target"], family_values, *values, ",".join(row["bands"]["coding"]),
                                         ",".join(row["bands"]["general"]), fallback]) + " |")
    lines += ["", "## Reference model counts by benchmark/version", "", *[f"- {b}: {n}" for b, n in report["reference_counts"].items()],
              "", "## Limits", "", "Ranks pool observed effort/agent configurations, with one median per model. Candidate selection prefers exact effort; otherwise it is a marked proxy.",
              "HF duplicates do not add votes. Unknown versions and small subsets stay separate. Cohorts with fewer than five model identities, including singleton subsets, do not supply a cross-model comparison or vote.",
              "The snapshot populations are heterogeneous; this is a relative hypothesis, not measured success probability. Full per-vote raw scores, sources, reference sizes and proxy notes are in the JSON.",
              "", "## Leave one coding family out", "", *[f"- {name}: {len(v['coding_band_changes'])} band changes; median absolute fitness change {v['median_absolute_coding_change']}" for name, v in sensitivity.items()]]
    path.with_suffix(".md").write_text("\n".join(lines) + "\n")
    print(json.dumps({k: report[k] for k in ["effort", "scored_count", "band_counts", "reasoning_band_counts"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", choices=["low", "medium", "high"], default="high")
    write_report(parser.parse_args().profile)

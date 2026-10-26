#!/usr/bin/env python3
"""Offline AA coverage prototype. `fetch` and `metadata` only GET public metadata."""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
from datetime import datetime, timezone
import re
from statistics import median
from urllib.request import Request, urlopen


AA_URL = "https://artificialanalysis.ai/api/v2/language/models/free"
METRICS = {
    "coding": "artificial_analysis_coding_index",
    "general": "artificial_analysis_intelligence_index",
}
RANGES = {"low": (0, 0.55), "mid": (0.45, 0.8), "high": (0.7, 1)}


def read_json(path):
    return json.loads(Path(path).read_text())


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def finite_score(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def aa_rows(snapshot):
    rows = snapshot["data"]
    if not rows or len({row["id"] for row in rows}) != len(rows):
        raise ValueError("AA snapshot must contain unique, nonempty model IDs")
    if not snapshot.get("intelligence_index_version"):
        raise ValueError("AA snapshot has no methodology version")
    return {row["id"]: row for row in rows}


def fetch_snapshot(key, fetch_page=None):
    def request_page(page):
        request = Request(
            f"{AA_URL}?page={page}&page_size=200",
            headers={"x-api-key": key, "User-Agent": "Hermes-AA-Coverage-Prototype/1.0"},
        )
        with urlopen(request, timeout=45) as response:
            return json.load(response)

    fetch_page = fetch_page or request_page
    rows, pages, version, seen = [], [], None, set()
    page = 1
    while True:
        body = fetch_page(page)
        pagination = body["pagination"]
        if pagination["page"] != page or not body["data"]:
            raise ValueError("Missing or unexpected AA page")
        if version is not None and body["intelligence_index_version"] != version:
            raise ValueError("AA methodology changed during pagination")
        version = body["intelligence_index_version"]
        for row in body["data"]:
            if row["id"] in seen:
                raise ValueError("Duplicate AA ID across pages; retry a fresh capture")
            seen.add(row["id"])
            rows.append(row)
        pages.append({"page": page, "count": len(body["data"]), **pagination})
        if not pagination["has_more"]:
            if page != pagination["total_pages"]:
                raise ValueError("AA pagination stopped before total_pages")
            break
        page += 1
    snapshot = {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "source": AA_URL,
        "intelligence_index_version": version,
        "pages": pages,
        "data": rows,
    }
    aa_rows(snapshot)
    return snapshot


def percentile(value, population):
    return (sum(x < value for x in population) + 0.5 * population.count(value)) / len(population)


def configuration_suffix(row, metadata):
    match = re.search(r"\(([^()]*)\)\s*$", row["name"])
    if match and re.match(
        r"^(?:low|medium|high|xhigh|max|ultra|minimal|reasoning|non-reasoning)(?:$|[\s,])",
        match.group(1).strip().lower(),
    ):
        return match.group(1).strip()
    return (metadata[row["id"]].get("suffix") or "").strip()


def configuration_effort(row, metadata):
    suffix = configuration_suffix(row, metadata).lower()
    if suffix.startswith("non-reasoning"):
        return "non-reasoning"
    if suffix.startswith("reasoning"):
        return "reasoning"
    for effort in ("xhigh", "medium", "high", "low"):
        if re.match(rf"^{effort}(?:$|[\s,])", suffix):
            return effort
    return None


def configuration_identity(row, metadata):
    name = row["name"]
    suffix = configuration_suffix(row, metadata)
    if suffix and name.lower().endswith(f" ({suffix})".lower()):
        name = name[:-(len(suffix) + 3)]
    return (row["model_creator"]["id"], name.strip().lower(), row.get("release_date"))


def reference_population(rows, metadata, task, profile):
    metric = METRICS[task]
    eligible = [row for row in rows
                if metadata[row["id"]].get("deprecated") is False
                and (task == "coding" or metadata[row["id"]].get("intelligenceIndexIsEstimated") is False)
                and metadata[row["id"]].get("name") == row["name"]
                and finite_score(row.get("evaluations", {}).get(metric))]
    grouped = {}
    for row in eligible:
        grouped.setdefault(configuration_identity(row, metadata), []).append(row)

    requested = profile.removeprefix("reasoning-") if profile.startswith("reasoning-") else None
    matching = {"low": ["low"], "medium": ["medium"], "high": ["high", "xhigh"]}
    values, selection_counts = [], {"exact_effort": 0, "same_model_proxy": 0}
    for variants in grouped.values():
        exact = []
        for effort in matching.get(requested, []):
            exact = [row for row in variants if configuration_effort(row, metadata) == effort]
            if exact:
                break
        if exact:
            selected, source = exact, "exact_effort"
        else:
            reasoning = [row for row in variants if metadata[row["id"]].get("isReasoning") is True]
            selected, source = reasoning or variants, "same_model_proxy"
        values.append(median([row["evaluations"][metric] for row in selected]))
        selection_counts[source] += 1
    return values, selection_counts


def fetch_public_metadata():
    # AICODE-NOTE: Free API omits intelligenceIndexIsEstimated. Capture the public
    # page's chart metadata explicitly; never silently treat missing flags as false.
    url = "https://artificialanalysis.ai/models/llama-3-2-instruct-90b-vision"
    with urlopen(Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=45) as response:
        html = response.read().decode()
    chunks = []
    for match in re.finditer(r"self\.__next_f\.push\((\[.*?\])\)</script>", html, re.S):
        item = json.loads(match.group(1))
        if item[0] == 1 and isinstance(item[1], str):
            chunks.append(item[1])
    stream, rows, decoder = "".join(chunks), {}, json.JSONDecoder()
    fields = ["id", "slug", "name", "suffix", "isReasoning", "deprecated",
              "intelligenceIndex", "intelligenceIndexIsEstimated", "modelWeightsSourceUrl"]
    for match in re.finditer(r'\{"id":"[a-f0-9-]+","slug":', stream):
        try:
            row, _ = decoder.raw_decode(stream, match.start())
        except ValueError:
            continue
        if "intelligenceIndexIsEstimated" in row:
            rows[row["id"]] = {key: row.get(key) for key in fields}
    if not rows:
        raise ValueError("Public metadata shape changed; estimation status unavailable")
    return {"captured_at": datetime.now(timezone.utc).isoformat(), "source": url,
            "models": rows}


def name_key(value):
    return re.sub(r"[^a-z0-9]", "", value.lower())


def suggestions(model, rows):
    # AICODE-NOTE: Names only propose review candidates. Never award a score here;
    # stripping effort/free markers is unsafe for benchmark identity.
    name = model.rsplit("/", 1)[-1]
    keys = {name_key(name), name_key(re.sub(r"(?::free|-free)$", "", name))}
    found = []
    for row in rows.values():
        base_name = re.sub(r"\s*\([^)]*\)", "", row["name"])
        if keys & {name_key(row["slug"]), name_key(row["name"]), name_key(base_name)}:
            found.append({"aa_id": row["id"], "name": row["name"], "slug": row["slug"]})
    return found


def select_mode(mapping, rows, metadata, profile):
    """Select within one confirmed identity, never across similar model names."""
    variants = [rows[item["id"]] for item in mapping["aa_models"]]
    if mapping.get("fixed_configuration") and mapping.get("configuration_evidence"):
        row = rows.get(mapping.get("aa_id"))
        if row not in variants:
            raise ValueError("Fixed AA configuration is outside confirmed identity")
        expected_reasoning = mapping["configuration"] == "fixed-reasoning"
        if metadata[row["id"]].get("isReasoning") is expected_reasoning:
            return [row], "fixed_mode", True, mapping["configuration"]
    audit = mapping.get("reasoning_audit", {})
    if profile == "provider-default":
        mode = audit.get("default_mode", "unknown")
    else:
        effort = profile.removeprefix("reasoning-")
        mode = audit.get("aa_modes", {}).get(effort, "unknown")
    if mode == "none":
        matching = [row for row in variants if metadata[row["id"]].get("isReasoning") is False]
        if matching:
            return matching, "reasoning_mode", True, mode
    elif mode == "reasoning":
        matching = [row for row in variants if metadata[row["id"]].get("isReasoning") is True]
        suffix = (metadata[matching[0]["id"]].get("suffix") or "").lower() if matching else ""
        binary_control = audit.get("controls") in ("reasoning.enabled", "chat_template_kwargs.enable_thinking")
        exact_binary = len(matching) == 1 and (suffix == "reasoning" or suffix == "" and binary_control)
        if matching:
            return matching, "reasoning_mode" if exact_binary else "reasoning_variants_median", exact_binary, mode
    else:
        # AICODE-NOTE: AA publishes separate rows per reasoning configuration.
        # Preserve the candidate's mapped effective effort; use its sibling
        # configuration only as a marked proxy fallback, never as a combined score.
        effort_order = {"high": ("high", "xhigh"), "xhigh": ("xhigh", "high")}.get(mode, (mode,))
        matching = []
        selected_effort = None
        for effort in effort_order:
            matching = [row for row in variants if configuration_effort(row, metadata) == effort]
            if matching:
                selected_effort = effort
                break
        if matching:
            exact = selected_effort == mode
            basis = "exact_effort" if exact else "sibling_effort_proxy"
            return matching, basis, exact, mode
    # AICODE-NOTE: The median is a derived estimate, never a benchmark result
    # for an unmeasured effort. Do not silently select the best available score.
    reasoning = [row for row in variants if metadata[row["id"]].get("isReasoning") is True]
    selected = reasoning if mode not in ("none", "unknown") and reasoning else variants
    return selected, "available_variants_median", False, mode


def build_report(candidates, aa, mappings, public_metadata, profile="reasoning-high", fork_filter=None):
    if profile not in ("provider-default", "reasoning-low", "reasoning-medium", "reasoning-high"):
        raise ValueError("Unknown reasoning profile")
    rows = aa_rows(aa)
    metadata = public_metadata["models"]
    if set(rows) != set(metadata):
        raise ValueError("API and public metadata model sets differ; recapture both snapshots")
    for aa_id, row in rows.items():
        api_score = row.get("evaluations", {}).get(METRICS["general"])
        page_score = metadata[aa_id].get("intelligenceIndex")
        if finite_score(api_score) and finite_score(page_score) and abs(api_score - page_score) > 0.11:
            raise ValueError("API/page scores disagree; recapture a coherent snapshot")
    mapping_index = {}
    for mapping in mappings:
        key = (mapping["provider"], mapping["model"])
        if key in mapping_index:
            raise ValueError(f"Duplicate mapping for {key}")
        mapping_index[key] = mapping

    # One published AA ID per evaluated configuration; no provider/account copies.
    # Freeze this complete population, including paid models, for both free bands.
    populations, reference_profile_counts = {}, {}
    for task in METRICS:
        populations[task], reference_profile_counts[task] = reference_population(
            rows.values(), metadata, task, profile
        )
    if any(not population for population in populations.values()):
        raise ValueError("No measured active reference population for a task")
    results = []
    seen = set()
    for candidate in candidates["candidates"]:
        key = (candidate["provider"], candidate["model"])
        if key in seen:
            continue
        seen.add(key)
        mapping = mapping_index.get(key, {})
        mapped_rows = [rows.get(item["id"]) for item in mapping.get("aa_models", [])]
        identity_reason = "no_confirmed_mapping"
        if mapping:
            identity_reason = "aa_id_missing" if not mapped_rows or None in mapped_rows else None
            for expected, actual in zip(mapping.get("aa_models", []), mapped_rows):
                if actual and (expected["creator_id"] != actual["model_creator"]["id"]
                               or expected["release_date"] != actual.get("release_date")
                               or expected["name"] != actual["name"]):
                    identity_reason = "aa_identity_changed"
            if not mapping.get("identity_evidence"):
                identity_reason = "identity_evidence_missing"
        selected, basis, exact, mode = [], None, False, None
        if identity_reason is None:
            selected, basis, exact, mode = select_mode(mapping, rows, metadata, profile)
        result = {
            "provider": key[0], "model": key[1],
            "identity_matched": identity_reason is None,
            "configuration_matched": exact,
            "mode": mode, "selection_basis": basis,
            "reasoning_audit": mapping.get("reasoning_audit"),
            "selected_aa_ids": [row["id"] for row in selected],
            "identity_aa_models": [
                {"id": x["id"], "name": x["name"], "evaluations": x["evaluations"],
                 "general_estimated": metadata[x["id"]].get("intelligenceIndexIsEstimated"),
                 "deprecated": metadata[x["id"]].get("deprecated")}
                for x in mapped_rows if x is not None
            ],
            "suggestions": suggestions(key[1], rows) if identity_reason else [],
            "tasks": {},
        }
        for task, metric in METRICS.items():
            available = [row for row in selected if finite_score(row.get("evaluations", {}).get(metric))]
            metric_proxy = False
            if not available and identity_reason is None:
                reasoning = [row for row in mapped_rows
                             if row is not None and metadata[row["id"]].get("isReasoning") is True]
                fallback = reasoning if mode not in ("none", "unknown") and reasoning else [
                    row for row in mapped_rows if row is not None
                ]
                available = [row for row in fallback
                             if finite_score(row.get("evaluations", {}).get(metric))]
                metric_proxy = bool(available)
            reason = identity_reason or ("metric_unmeasured" if not available else None)
            if reason:
                result["tasks"][task] = {"status": "unrated", "reason": reason, "bands": ["low"]}
            else:
                values = [row["evaluations"][metric] for row in available]
                value = median(values)
                estimate_reasons = []
                if not exact or metric_proxy:
                    estimate_reasons.append("aa_effort_proxy")
                if len(available) != len(selected):
                    estimate_reasons.append("partial_variant_coverage")
                if any(metadata[row["id"]].get("deprecated") is True for row in available):
                    estimate_reasons.append("historical_aa_result")
                if task == "general" and any(metadata[row["id"]].get("intelligenceIndexIsEstimated") is not False for row in available):
                    estimate_reasons.append("aa_general_estimate")
                fitness = percentile(value, populations[task])
                result["tasks"][task] = {
                    "status": "estimated" if estimate_reasons else "rated",
                    "aa_score_or_estimate": value, "fitness": fitness,
                    "estimate_reasons": estimate_reasons,
                    "source_scores": [{"aa_id": row["id"], "score": row["evaluations"][metric]} for row in available],
                    "bands": [band for band, (lo, hi) in RANGES.items() if lo <= fitness <= hi],
                }
        results.append(result)

    bands = {
        task: {band: [f"{r['provider']}/{r['model']}" for r in results
                      if band in r["tasks"][task]["bands"]] for band in RANGES}
        for task in METRICS
    }
    report = {
        "aa_captured_at": aa["captured_at"],
        "candidates_captured_at": candidates["captured_at"],
        "candidate_source": candidates["source"],
        "public_metadata_captured_at": public_metadata["captured_at"],
        "reasoning_profile": profile,
        "profile_is_live_configuration": False,
        "reference_policy": {
            "coding": "one active numeric Coding Index per exact model identity; prefer the profile effort, then same-model proxy",
            "general": "one active non-estimated Intelligence Index per exact model identity; prefer the profile effort, then same-model proxy",
        },
        "intelligence_index_version": aa["intelligence_index_version"],
        "aa_snapshot_sha256": hashlib.sha256(json.dumps(aa, sort_keys=True).encode()).hexdigest(),
        "reference_counts": {task: len(values) for task, values in populations.items()},
        "reference_profile_counts": reference_profile_counts,
        "candidate_count": len(results),
        "identity_matches": sum(r["identity_matched"] for r in results),
        "configuration_matches": sum(r["configuration_matched"] for r in results),
        "scored_counts": {task: sum(r["tasks"][task]["status"] != "unrated" for r in results) for task in METRICS},
        "measured_counts": {task: sum(r["tasks"][task]["status"] == "rated" for r in results) for task in METRICS},
        "estimated_counts": {task: sum(r["tasks"][task]["status"] == "estimated" for r in results) for task in METRICS},
        "band_counts": {task: {band: len(items) for band, items in groups.items()}
                        for task, groups in bands.items()},
        "bands": bands, "models": results,
        "scope": "offline quality-band simulation of the captured pool; no inference, quota, reserve, or modality checks",
        "source_attribution": "Artificial Analysis — https://artificialanalysis.ai/",
    }
    if fork_filter is not None:
        base = set(fork_filter["pools"]["general_low:free"])
        reasoning = set(fork_filter["pools"]["general_low_reasoning:free"])
        targets = {f"{row['provider']}/{row['model']}" for row in results}
        if base != targets or not reasoning <= base:
            raise ValueError("Fork filter snapshot does not describe the same candidate pool")
        report["fork_reasoning_filter_source"] = fork_filter["source"]
        report["reasoning_capable_count"] = len(reasoning)
        report["reasoning_bands"] = {
            task: {band: [target for target in items if target in reasoning]
                   for band, items in groups.items()} for task, groups in bands.items()
        }
        report["reasoning_band_counts"] = {
            task: {band: len(items) for band, items in groups.items()}
            for task, groups in report["reasoning_bands"].items()
        }
        for row in results:
            row["fork_reasoning_capable"] = f"{row['provider']}/{row['model']}" in reasoning
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    fetch = commands.add_parser("fetch")
    fetch.add_argument("--key-file", type=Path)
    fetch.add_argument("--out", required=True, type=Path)
    metadata = commands.add_parser("metadata")
    metadata.add_argument("--out", required=True, type=Path)
    report = commands.add_parser("report")
    report.add_argument("--aa", required=True, type=Path)
    report.add_argument("--candidates", required=True, type=Path)
    report.add_argument("--mappings", required=True, type=Path)
    report.add_argument("--metadata", required=True, type=Path)
    report.add_argument("--out", required=True, type=Path)
    report.add_argument("--profile", choices=["provider-default", "reasoning-low", "reasoning-medium", "reasoning-high"], default="reasoning-high")
    report.add_argument("--fork-filter", type=Path)
    args = parser.parse_args()
    if args.command == "fetch":
        key = args.key_file.read_text().strip() if args.key_file else os.environ.get("AA_API_KEY")
        if not key:
            parser.error("Set AA_API_KEY or --key-file")
        write_json(args.out, fetch_snapshot(key))
    elif args.command == "metadata":
        write_json(args.out, fetch_public_metadata())
    else:
        paths = [args.aa, args.candidates, args.mappings, args.metadata]
        if args.fork_filter:
            paths.append(args.fork_filter)
        result = build_report(read_json(args.candidates), read_json(args.aa),
                              read_json(args.mappings), read_json(args.metadata), args.profile,
                              read_json(args.fork_filter) if args.fork_filter else None)
        result["input_sha256"] = {
            path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in paths
        }
        write_json(args.out, result)


if __name__ == "__main__":
    main()

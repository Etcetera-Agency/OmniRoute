#!/usr/bin/env python3
"""Build the profile-specific TypeScript table from reviewed score reports."""

import argparse
import json
from pathlib import Path


EVIDENCE = Path(__file__).resolve().parent.parent
PROFILES = ("low", "medium", "high")


def build_snapshot():
    result = {}
    for profile in PROFILES:
        aa_report = json.loads((EVIDENCE / f"aa-{profile}.json").read_text())
        scores = json.loads((EVIDENCE / f"unified-{profile}.json").read_text())
        for model, row in zip(aa_report["models"], scores["models"], strict=True):
            model_id = model["model"].lower()
            values = {"coding": row["coding"], "general": row["general"]}
            profile_scores = result.setdefault(model_id, {})
            if profile in profile_scores and profile_scores[profile] != values:
                raise ValueError(f"Provider copies disagree for {model_id} in {profile}")
            profile_scores[profile] = values
    return result


def render(snapshot):
    rows = ",\n".join(
        f"  {json.dumps(model_id)}: {json.dumps(scores, separators=(',', ':'))}"
        for model_id, scores in sorted(snapshot.items())
    )
    return f'''// Generated from this OpenSpec change's recalculated evidence.
export type BandFitnessProfile = "low" | "medium" | "high";

type TaskFitness = Readonly<{{ coding: number | null; general: number | null }}>;

export const BENCHMARK_CONSENSUS_FITNESS: Readonly<
  Record<string, Readonly<Partial<Record<BandFitnessProfile, TaskFitness>>>>
> = {{
{rows}
}};

export function getBenchmarkConsensusFitness(
  model: string,
  taskType: string,
  profile: BandFitnessProfile
): number | null {{
  let task: "coding" | "general" | null = null;
  if (taskType === "default" || taskType === "general") {{
    task = "general";
  }} else if (taskType === "coding") {{
    task = "coding";
  }}
  if (!task) return null;
  return BENCHMARK_CONSENSUS_FITNESS[model.toLowerCase()]?.[profile]?.[task] ?? null;
}}
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    snapshot = build_snapshot()
    args.output.write_text(render(snapshot))
    print(json.dumps({"model_ids": len(snapshot), "output": str(args.output)}))


if __name__ == "__main__":
    main()

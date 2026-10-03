/**
 * Read-only report for quality-band calibration against this install's local
 * connected AutoCombo catalog and resolved fitness/capability data.
 *
 * Run from the repository root:
 *   node --import tsx/esm scripts/ad-hoc/bands-calibrate.ts
 *
 * This script prints JSON only. It does not contact providers or write band
 * configuration/state.
 */

import { pathToFileURL } from "node:url";
import { getResolvedModelCapabilities } from "@/lib/modelCapabilities";
import { isVisionBridgeForcedModel } from "@/shared/constants/visionBridgeDefaults";
import { providerSupportsEmulatedToolCalling } from "../../open-sse/services/combo/comboStructure.ts";
import {
  buildBandCalibrationReport,
  createBandCalibrationController,
  type BandCalibrationReportCandidate,
} from "../../open-sse/services/autoCombo/bands/calibrate.ts";
import {
  getBandConfig,
  getBandRange,
  loadBandConfig,
  type BandConfig,
} from "../../open-sse/services/autoCombo/bands/config.ts";
import { getTaskFitnessWithSource } from "../../open-sse/services/autoCombo/taskFitness.ts";
import { prepareVirtualAutoComboInputs } from "../../open-sse/services/autoCombo/virtualFactory.ts";

function readCapabilityFacts(
  provider: string,
  model: string,
  soUnknown: "allow" | "deny"
): BandCalibrationReportCandidate["capabilities"] {
  const resolved = getResolvedModelCapabilities({ provider, model });
  const emulatedTools = providerSupportsEmulatedToolCalling(provider);
  return {
    tools: {
      known: emulatedTools || resolved.supportsTools !== null,
      matches: emulatedTools || (resolved.toolCalling && resolved.supportsTools !== false),
    },
    so: {
      known: resolved.structuredOutput !== null,
      matches:
        resolved.structuredOutput === true ||
        (resolved.structuredOutput === null && soUnknown === "allow"),
    },
    reasoning: {
      known: resolved.supportsThinking !== null,
      matches: resolved.reasoning || resolved.supportsThinking === true,
    },
    vision: {
      known: resolved.supportsVision !== null,
      matches:
        resolved.supportsVision === true && !isVisionBridgeForcedModel(`${provider}/${model}`),
    },
  };
}

// AICODE-NOTE: This operator report reads only the local candidate/catalog and
// fitness caches; it never syncs Radar/providers or changes band config/state.
async function main(): Promise<void> {
  const config = await loadBandCalibrationReportConfig();
  const prepared = await prepareVirtualAutoComboInputs();
  const candidates: BandCalibrationReportCandidate[] = prepared.regularCandidates.map(
    ({ provider, model }) => ({
      provider,
      model,
      fitness: {
        general: getTaskFitnessWithSource(model, "default"),
        coding: getTaskFitnessWithSource(model, "coding"),
      },
      capabilities: readCapabilityFacts(provider, model, config.capabilities.so.unknown),
    })
  );

  const report = buildBandCalibrationReport(candidates, config.ratedSources, getBandRange);
  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: "local connected AutoCombo catalog and task-fitness data",
        readOnly: true,
        ...report,
      },
      null,
      2
    )
  );
}

export async function loadBandCalibrationReportConfig(): Promise<BandConfig> {
  await loadBandConfig();
  await createBandCalibrationController().initialize();
  return getBandConfig();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("Band calibration report failed; details suppressed to avoid exposing secrets.");
    process.exitCode = 1;
  });
}

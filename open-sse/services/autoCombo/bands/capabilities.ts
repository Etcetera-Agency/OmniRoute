import { getResolvedModelCapabilities } from "@/lib/modelCapabilities";
import { isVisionBridgeForcedModel } from "@/shared/constants/visionBridgeDefaults";
import { providerSupportsEmulatedToolCalling } from "../../combo/comboStructure.ts";
import type { BandCapability } from "./grammar.ts";

export interface BandCapabilityCandidate {
  provider: string;
  model: string;
}

export type StructuredOutputUnknownPolicy = "allow" | "deny";

// AICODE-NOTE: channel capabilities are hard pool constraints, independent of
// which optional fields happen to be present in an individual request.
export function buildCapabilityCheck(
  capabilities: readonly BandCapability[],
  soUnknownPolicy: StructuredOutputUnknownPolicy = "deny"
): (candidate: BandCapabilityCandidate) => boolean {
  if (capabilities.length === 0) {
    return function allowCandidate(): boolean {
      return true;
    };
  }

  return function checkCandidate(candidate: BandCapabilityCandidate): boolean {
    let resolved: ReturnType<typeof getResolvedModelCapabilities> | undefined;
    const getCapabilities = (): ReturnType<typeof getResolvedModelCapabilities> => {
      resolved ??= getResolvedModelCapabilities(candidate);
      return resolved;
    };

    for (const capability of capabilities) {
      switch (capability) {
        case "tools": {
          if (providerSupportsEmulatedToolCalling(candidate.provider)) continue;
          const modelCapabilities = getCapabilities();
          if (!(modelCapabilities.toolCalling && modelCapabilities.supportsTools !== false)) {
            return false;
          }
          break;
        }
        case "so": {
          const structuredOutput = getCapabilities().structuredOutput;
          if (
            structuredOutput !== true &&
            !(structuredOutput === null && soUnknownPolicy === "allow")
          ) {
            return false;
          }
          break;
        }
        case "reasoning": {
          const modelCapabilities = getCapabilities();
          if (!(modelCapabilities.reasoning || modelCapabilities.supportsThinking === true)) {
            return false;
          }
          break;
        }
        case "vision": {
          if (getCapabilities().supportsVision !== true) return false;
          if (isVisionBridgeForcedModel(`${candidate.provider}/${candidate.model}`)) return false;
          break;
        }
      }
    }

    return true;
  };
}

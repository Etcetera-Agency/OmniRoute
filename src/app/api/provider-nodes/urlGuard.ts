import { NextResponse } from "next/server";
import {
  OutboundUrlGuardError,
  parseAndValidateNonMetadataUrl,
  parseAndValidatePublicUrl,
  parseOutboundUrl,
} from "@/shared/network/outboundUrlGuard";
import { getProviderValidationGuard } from "@/shared/network/outboundUrlGuardPolicy";
import { buildCompatibleModelsUrl } from "@/shared/utils/compatibleProviderUrls";

function guardProviderNodeBaseUrl(baseUrl: string): void {
  const guard = getProviderValidationGuard();
  if (guard === "none") {
    parseOutboundUrl(baseUrl);
    return;
  }
  if (guard === "block-metadata") {
    parseAndValidateNonMetadataUrl(baseUrl);
    return;
  }
  parseAndValidatePublicUrl(baseUrl);
}

export function validateProviderNodeBaseUrl(baseUrl: string): NextResponse | null {
  try {
    guardProviderNodeBaseUrl(baseUrl);
    return null;
  } catch (error) {
    const message =
      error instanceof OutboundUrlGuardError
        ? error.code === "OUTBOUND_URL_INVALID"
          ? "Invalid provider base URL format"
          : error.message
        : "Invalid provider base URL";
    return NextResponse.json(
      {
        error: {
          message: "Invalid request",
          details: [{ field: "baseUrl", message }],
        },
      },
      { status: 400 }
    );
  }
}

export function validateProviderNodeModelsPath(
  baseUrl: string,
  modelsPath?: string
): NextResponse | null {
  // AICODE-NOTE: Saved modelsPath values use discovery's origin and traversal checks.
  try {
    buildCompatibleModelsUrl(baseUrl, modelsPath || "/models");
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid models endpoint";
    return NextResponse.json(
      {
        error: {
          message: "Invalid request",
          details: [{ field: "modelsPath", message }],
        },
      },
      { status: 400 }
    );
  }
}

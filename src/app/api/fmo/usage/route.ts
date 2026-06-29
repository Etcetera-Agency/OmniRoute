import { NextResponse } from "next/server";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { getFmoPoolUsageBackchannel } from "@/lib/db/fmoPools";
import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";

export async function GET(request: Request): Promise<Response> {
  if (!isFeatureFlagEnabled("OMNIROUTE_FMO_POOLS_ENABLED")) {
    return NextResponse.json(
      { disabled: true, error: "FMO pools usage disabled" },
      { status: 404 }
    );
  }

  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  return NextResponse.json(getFmoPoolUsageBackchannel());
}

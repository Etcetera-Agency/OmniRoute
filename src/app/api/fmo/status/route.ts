import { NextResponse } from "next/server";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { getFmoRebalanceStatus } from "@/lib/fmoPools/rebalance";
import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";

function disabledResponse(): Response {
  return NextResponse.json({ disabled: true, error: "FMO pool status disabled" }, { status: 404 });
}

export async function GET(request: Request): Promise<Response> {
  if (!isFeatureFlagEnabled("OMNIROUTE_FMO_POOLS_ENABLED")) {
    return disabledResponse();
  }

  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  return NextResponse.json({
    kind: "fmo_pool_execution_status",
    demandFeedback: false,
    ...getFmoRebalanceStatus(),
  });
}

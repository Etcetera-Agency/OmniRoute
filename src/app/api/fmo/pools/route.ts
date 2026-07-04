import { NextResponse } from "next/server";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import {
  listMissingFmoPoolComboIds,
  restoreFmoPoolsState,
  snapshotFmoPoolsState,
  storeFmoPoolsGeneration,
} from "@/lib/db/fmoPools";
import { buildFmoGenerationPlan } from "@/lib/fmoPools/planGeneration";
import { rebalanceFmoPools, rescheduleActiveFmoRebalance } from "@/lib/fmoPools/rebalance";
import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";
import { fmoPoolsGenerationSchema } from "@/shared/schemas/fmoPools";

function disabledResponse(): Response {
  return NextResponse.json(
    { disabled: true, error: "FMO pools ingestion disabled" },
    { status: 404 }
  );
}

async function handleWrite(request: Request): Promise<Response> {
  if (!isFeatureFlagEnabled("OMNIROUTE_FMO_POOLS_ENABLED")) {
    return disabledResponse();
  }

  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = fmoPoolsGenerationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid fmo-pools/v1 payload" }, { status: 400 });
  }

  const idempotencyKey = request.headers.get("Idempotency-Key");

  const missingComboIds = listMissingFmoPoolComboIds(
    parsed.data.pools.map((pool) => pool.combo_id)
  );
  if (missingComboIds.length > 0) {
    return NextResponse.json({ error: "Referenced combo not found" }, { status: 400 });
  }

  const previousState = snapshotFmoPoolsState();

  try {
    const marker = storeFmoPoolsGeneration(parsed.data, idempotencyKey);
    const plan = await buildFmoGenerationPlan();
    const apply = await rebalanceFmoPools({ planOverride: plan });
    rescheduleActiveFmoRebalance();
    return NextResponse.json(
      {
        status: "accepted",
        applied: apply.applied,
        generation: marker.generation,
        marker,
        diffs: apply.diffs,
      },
      { status: 202 }
    );
  } catch {
    restoreFmoPoolsState(previousState);
    return NextResponse.json(
      {
        error: "FMO pool publish failed",
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request): Promise<Response> {
  return handleWrite(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleWrite(request);
}

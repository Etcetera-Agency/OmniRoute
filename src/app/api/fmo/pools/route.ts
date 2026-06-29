import { NextResponse } from "next/server";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { listMissingFmoPoolComboIds, storeFmoPoolsGeneration } from "@/lib/db/fmoPools";
import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";
import { FMO_POOLS_CONTRACT_VERSION, fmoPoolsGenerationSchema } from "@/shared/schemas/fmoPools";

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

  if (parsed.data.contract !== FMO_POOLS_CONTRACT_VERSION) {
    return NextResponse.json({ error: "Unsupported FMO pools contract" }, { status: 400 });
  }

  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (idempotencyKey !== parsed.data.generation) {
    return NextResponse.json({ error: "Idempotency-Key must equal generation" }, { status: 409 });
  }

  const missingComboIds = listMissingFmoPoolComboIds(
    parsed.data.pools.map((pool) => pool.combo_id)
  );
  if (missingComboIds.length > 0) {
    return NextResponse.json({ error: "Referenced combo not found" }, { status: 400 });
  }

  const marker = storeFmoPoolsGeneration(parsed.data, idempotencyKey);
  return NextResponse.json({ status: "accepted", marker }, { status: 202 });
}

export async function PUT(request: Request): Promise<Response> {
  return handleWrite(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleWrite(request);
}

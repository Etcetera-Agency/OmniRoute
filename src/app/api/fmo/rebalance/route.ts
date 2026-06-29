import { NextResponse } from "next/server";
import { z } from "zod";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { getFmoPoolGenerationMarker } from "@/lib/db/fmoPools";
import { rebalanceFmoPools } from "@/lib/fmoPools/rebalance";
import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";

const planMemberSchema = z
  .object({
    role: z.enum(["head", "tail", "canary"]),
    providerId: z.string().trim().min(1),
    modelId: z.string().trim().min(1),
    connectionId: z.string().trim().min(1).nullable(),
    countedCapacity: z.number().finite().nonnegative(),
  })
  .strict();

const rebalancePlanSchema = z
  .object({
    generation: z.string().trim().min(1),
    plans: z.record(z.string().trim().min(1), z.array(planMemberSchema)),
    decisions: z.array(
      z
        .object({
          comboId: z.string().trim().min(1),
          providerId: z.string().trim().min(1),
          modelId: z.string().trim().min(1),
          connectionId: z.string().trim().min(1).nullable(),
          role: z.enum(["head", "tail", "canary"]),
          outcome: z.enum(["kept", "displaced", "dropped", "seated"]),
          reason: z.string().trim().min(1),
        })
        .strict()
    ),
  })
  .strict();

const rebalanceBodySchema = z
  .object({
    shadow: z.boolean().optional(),
    plan: rebalancePlanSchema.optional(),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  if (!isFeatureFlagEnabled("OMNIROUTE_FMO_POOLS_ENABLED")) {
    return NextResponse.json({ disabled: true, error: "FMO rebalance disabled" }, { status: 404 });
  }

  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  const parsed = rebalanceBodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid FMO rebalance request", details: parsed.error.issues },
      { status: 400 }
    );
  }

  if (!parsed.data.plan) {
    return NextResponse.json({ error: "FMO rebalance plan is required" }, { status: 400 });
  }

  const marker = getFmoPoolGenerationMarker();
  if (marker?.generation !== parsed.data.plan.generation) {
    return NextResponse.json(
      { error: "FMO rebalance plan generation is not accepted" },
      { status: 409 }
    );
  }

  const result = rebalanceFmoPools({
    shadow: parsed.data.shadow === true,
    planOverride: parsed.data.plan,
  });

  return NextResponse.json(result);
}

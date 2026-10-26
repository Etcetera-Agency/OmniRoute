import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/shared/utils/apiAuth";
import {
  listModelBenchmarkSearchEvidence,
  listModelBenchmarkSearchRuns,
} from "@/lib/db/modelBenchmarkSearch";

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const modelId = searchParams.get("modelId");
  const requestedLimit = Number(searchParams.get("limit") ?? 100);
  const limit = Number.isFinite(requestedLimit) ? requestedLimit : 100;

  if (modelId) {
    return NextResponse.json({
      modelId,
      evidence: listModelBenchmarkSearchEvidence(modelId, limit),
    });
  }

  return NextResponse.json({ runs: listModelBenchmarkSearchRuns(limit) });
}

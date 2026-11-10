import { POST as fetchWeb } from "@/app/api/v1/web/fetch/route";
import { isDashboardSessionAuthenticated } from "@/shared/utils/apiAuth";

export async function POST(request: Request) {
  if (!(await isDashboardSessionAuthenticated(request))) {
    return Response.json({ error: { message: "Authentication required" } }, { status: 401 });
  }
  return fetchWeb(request);
}

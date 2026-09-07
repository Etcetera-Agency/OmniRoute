import { persistCodexChildCooldown } from "../../services/codexAccount/index.ts";

type CodexFailoverCredentials = {
  connectionId?: string | null;
  providerSpecificData?: unknown;
};

export async function markCodexScopeRateLimited(params: {
  failedConnectionId: string;
  model: string | null;
  rateLimitedUntil: string;
  credentials?: CodexFailoverCredentials | null;
}): Promise<void> {
  const connection = await getCachedProviderConnectionById(params.failedConnectionId).catch(
    () => null
  );
  const existingProviderData = connection
    ? asProviderData(connection.providerSpecificData)
    : asProviderData(params.credentials?.providerSpecificData);
  const existingScopeMap = asProviderData(existingProviderData.codexScopeRateLimitedUntil);
  const nextProviderData = {
    ...existingProviderData,
    codexScopeRateLimitedUntil: {
      ...existingScopeMap,
      [getCodexModelScope(params.model || "")]: params.rateLimitedUntil,
    },
  };

  if (
    persisted &&
    params.credentials &&
    String(params.credentials.connectionId) === params.failedConnectionId
  ) {
    params.credentials.providerSpecificData = persisted.providerSpecificData;
  }
}

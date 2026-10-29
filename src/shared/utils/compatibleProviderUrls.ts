// AICODE-NOTE: Keep imports out of this module to preserve benchmark runtime graph.

export function stripAnthropicMessagesSuffix(baseUrl: string | null | undefined): string {
  const normalized = String(baseUrl || "")
    .trim()
    .replace(/\/$/, "");
  if (!normalized) return "";
  return normalized.split("?")[0].replace(/\/messages$/i, "");
}

export function stripClaudeCodeCompatibleEndpointSuffix(
  baseUrl: string | null | undefined
): string {
  const normalized = String(baseUrl || "")
    .trim()
    .replace(/\/$/, "");
  if (!normalized) return "";
  return normalized.split("?")[0].replace(/\/(?:v\d+\/)?messages$/i, "");
}

export function normalizeAnthropicBaseUrl(baseUrl: string): string {
  return stripAnthropicMessagesSuffix(baseUrl || "");
}

export function normalizeClaudeCodeCompatibleBaseUrl(baseUrl: string): string {
  return stripClaudeCodeCompatibleEndpointSuffix(baseUrl || "");
}

export function buildCompatibleModelsUrl(baseUrl: string, modelsPath?: string): string {
  const base = new URL(baseUrl);
  const path = modelsPath?.trim() || "models";
  const rawPath = path.replace(/^https?:\/\/[^/?#]*/i, "").split(/[?#]/, 1)[0];
  for (const segment of rawPath.split("/")) {
    let decoded = segment;
    for (let pass = 0; pass < 2; pass++) {
      try {
        decoded = decodeURIComponent(decoded);
      } catch {
        break;
      }
    }
    if (decoded === "." || decoded === "..") {
      throw new Error("Compatible models endpoint cannot contain dot-segment traversal");
    }
  }
  let target: URL;
  if (/^https?:\/\//i.test(path)) {
    target = new URL(path);
  } else {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const version = base.pathname.match(/(\/v\d+)$/i)?.[1];
    const joinedPath =
      version && normalizedPath.toLowerCase().startsWith(`${version.toLowerCase()}/`)
        ? `${base.pathname}${normalizedPath.slice(version.length)}`
        : `${base.pathname.replace(/\/$/, "")}${normalizedPath}`;
    target = new URL(joinedPath, base.origin);
  }
  if (target.username || target.password)
    throw new Error("Compatible models endpoint cannot include credentials");
  if (target.origin !== base.origin) {
    throw new Error("Compatible models endpoint must use the base URL origin");
  }
  return target.toString();
}

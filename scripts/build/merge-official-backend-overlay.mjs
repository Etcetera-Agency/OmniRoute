#!/usr/bin/env node

import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { normalizeAppPath } = require("next/dist/shared/lib/router/utils/app-paths.js");
// AICODE-NOTE: The standalone-image merger needs a sorter shipped with Next's runtime.
const { getSortedRouteObjects } = require("next/dist/shared/lib/router/utils/sorted-routes.js");
const REWRITE_GROUPS = ["beforeFiles", "afterFiles", "fallback"];
const API_ROUTE_PREFIX = "/api/";

function isApiRoute(routeKey) {
  return routeKey === "/api" || routeKey.startsWith(API_ROUTE_PREFIX);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])])
    );
  }
  return value;
}

function stableKey(value) {
  return JSON.stringify(stableValue(value));
}

function mergeRewriteGroups(baseRewrites, overlayRewrites) {
  if (
    !baseRewrites ||
    !overlayRewrites ||
    Array.isArray(baseRewrites) ||
    Array.isArray(overlayRewrites)
  ) {
    throw new Error(
      "routes-manifest rewrites must use the Next.js beforeFiles/afterFiles/fallback shape"
    );
  }

  const merged = { ...baseRewrites };
  for (const group of REWRITE_GROUPS) {
    if (!Array.isArray(baseRewrites[group]) || !Array.isArray(overlayRewrites[group])) {
      throw new Error(`routes-manifest rewrites.${group} must be an array`);
    }
    const rules = [...baseRewrites[group]];
    const seen = new Set(rules.map(stableKey));
    for (const rule of overlayRewrites[group]) {
      const key = stableKey(rule);
      if (seen.has(key)) continue;
      seen.add(key);
      rules.push(rule);
    }
    merged[group] = rules;
  }
  return merged;
}

function mergeApiRouteEntries(baseEntries, overlayEntries, manifestGroup) {
  if (!Array.isArray(baseEntries) || !Array.isArray(overlayEntries)) {
    throw new Error(`routes-manifest ${manifestGroup} must be an array`);
  }

  const routesByPage = new Map();
  for (const route of baseEntries) {
    if (!route || typeof route !== "object" || typeof route.page !== "string") {
      throw new Error(`routes-manifest ${manifestGroup} entries must contain a page string`);
    }
    routesByPage.set(route.page, route);
  }

  for (const route of overlayEntries) {
    if (!route || typeof route !== "object" || typeof route.page !== "string") {
      throw new Error(
        `overlay routes-manifest ${manifestGroup} entries must contain a page string`
      );
    }
    if (isApiRoute(route.page)) routesByPage.set(route.page, route);
  }

  return getSortedRouteObjects([...routesByPage.values()], (route) => route.page);
}

function validateObject(value, file) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${file} must contain a JSON object`);
  }
  return value;
}

function validateManifest(value, file, key) {
  validateObject(value, file);
  if (!value[key] || typeof value[key] !== "object" || Array.isArray(value[key])) {
    throw new Error(`${file} must contain an object-valued ${key} field`);
  }
  return value;
}

function validateApiRoutePath(routeKey, routePath) {
  const expectedPath = normalizeAppPath(routeKey);
  if (
    typeof routePath !== "string" ||
    routePath !== expectedPath ||
    !isApiRoute(routePath) ||
    path.posix.normalize(routePath) !== routePath ||
    routePath.includes("\\")
  ) {
    throw new Error(
      `API route ${routeKey} must map to normalized app path ${expectedPath}; got ${String(routePath)}`
    );
  }
  return routePath;
}

function validateApiBundlePath(serverDir, routeKey, bundlePath) {
  if (
    typeof bundlePath !== "string" ||
    !bundlePath.startsWith("app/api/") ||
    path.posix.normalize(bundlePath) !== bundlePath ||
    path.posix.isAbsolute(bundlePath) ||
    bundlePath.includes("\\")
  ) {
    throw new Error(
      `API route ${routeKey} has bundle path outside the server tree: ${String(bundlePath)}`
    );
  }

  const absolutePath = path.resolve(serverDir, ...bundlePath.split("/"));
  const relativePath = path.relative(path.resolve(serverDir), absolutePath);
  if (
    !relativePath ||
    relativePath.startsWith(`..${path.sep}`) ||
    relativePath === ".." ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`API route ${routeKey} has bundle path outside the server tree: ${bundlePath}`);
  }
  return absolutePath;
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`Could not read valid JSON from ${file}: ${error.message}`, { cause: error });
  }
}

async function writeJsonAtomic(file, value) {
  const temporaryPath = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(temporaryPath, file);
}

function hasV1ApiRewrite(rewrites) {
  return REWRITE_GROUPS.some((group) =>
    rewrites[group].some(
      (rule) => rule.source === "/v1/:path*" && rule.destination === "/api/v1/:path*"
    )
  );
}

/**
 * Merge fork API server artifacts into an official standalone Next.js dist.
 * @param {{
 *   baseDistDir:string,
 *   overlayServerDir:string,
 *   overlayRoutesManifestPath:string,
 *   overlayAppPathRoutesManifestPath:string,
 *   runtimeOverlayServerDir:string
 * }} options
 * @returns {Promise<{apiRouteCount:number,rewriteCount:number,functionConfigCount:number,overlayServerDir:string}>}
 */
export async function mergeOfficialBackendOverlay({
  baseDistDir,
  overlayServerDir,
  overlayRoutesManifestPath,
  overlayAppPathRoutesManifestPath,
  runtimeOverlayServerDir = path.resolve(baseDistDir, "omni-overlay/server"),
}) {
  const baseServerDir = path.join(baseDistDir, "server");
  const baseAppPathsFile = path.join(baseServerDir, "app-paths-manifest.json");
  const overlayAppPathsFile = path.join(overlayServerDir, "app-paths-manifest.json");
  const baseAppPathRoutesFile = path.join(baseDistDir, "app-path-routes-manifest.json");
  const baseFunctionsFile = path.join(baseServerDir, "functions-config-manifest.json");
  const overlayFunctionsFile = path.join(overlayServerDir, "functions-config-manifest.json");
  const baseRoutesFile = path.join(baseDistDir, "routes-manifest.json");

  const [
    baseAppPaths,
    overlayAppPaths,
    baseAppPathRoutes,
    overlayAppPathRoutes,
    baseFunctions,
    overlayFunctions,
    baseRoutes,
    overlayRoutes,
  ] = await Promise.all([
    readJson(baseAppPathsFile),
    readJson(overlayAppPathsFile),
    readJson(baseAppPathRoutesFile),
    readJson(overlayAppPathRoutesManifestPath),
    readJson(baseFunctionsFile),
    readJson(overlayFunctionsFile),
    readJson(baseRoutesFile),
    readJson(overlayRoutesManifestPath),
  ]);

  validateObject(baseAppPaths, baseAppPathsFile);
  validateObject(overlayAppPaths, overlayAppPathsFile);
  validateObject(baseAppPathRoutes, baseAppPathRoutesFile);
  validateObject(overlayAppPathRoutes, overlayAppPathRoutesManifestPath);
  validateObject(baseRoutes, baseRoutesFile);
  validateObject(overlayRoutes, overlayRoutesManifestPath);
  validateManifest(baseFunctions, baseFunctionsFile, "functions");
  validateManifest(overlayFunctions, overlayFunctionsFile, "functions");

  const baseApiKeys = Object.keys(baseAppPaths).filter(isApiRoute);
  const overlayApiEntries = Object.entries(overlayAppPaths).filter(([routeKey]) =>
    isApiRoute(routeKey)
  );
  const overlayApiKeys = new Set(overlayApiEntries.map(([routeKey]) => routeKey));
  const missingApiKeys = baseApiKeys.filter((routeKey) => !overlayApiKeys.has(routeKey));
  if (missingApiKeys.length > 0) {
    throw new Error(`Backend overlay is missing official API route ${missingApiKeys[0]}`);
  }
  if (overlayApiEntries.length === 0) {
    throw new Error("Backend overlay app-paths manifest contains no API routes");
  }

  const normalizedOverlayServerDir = path.resolve(overlayServerDir);
  const normalizedRuntimeOverlayServerDir = path.resolve(runtimeOverlayServerDir);
  const normalizedBaseServerDir = path.resolve(baseServerDir);
  const overlayRelativeToBase = path.relative(
    normalizedBaseServerDir,
    normalizedRuntimeOverlayServerDir
  );
  const overlayRelativeToDist = path.relative(
    path.resolve(baseDistDir),
    normalizedRuntimeOverlayServerDir
  );
  if (
    !overlayRelativeToDist ||
    overlayRelativeToDist === ".." ||
    overlayRelativeToDist.startsWith(`..${path.sep}`) ||
    path.isAbsolute(overlayRelativeToDist) ||
    !overlayRelativeToBase.startsWith(`..${path.sep}`)
  ) {
    throw new Error(
      "Runtime backend overlay server must be a sibling subtree within the official dist directory"
    );
  }

  const resolvedBundles = new Map();
  const sourceRoot = await fs.realpath(normalizedOverlayServerDir);
  for (const [routeKey, bundlePath] of overlayApiEntries) {
    const sourceBundle = validateApiBundlePath(normalizedOverlayServerDir, routeKey, bundlePath);
    let realBundle;
    try {
      realBundle = await fs.realpath(sourceBundle);
    } catch (error) {
      throw new Error(`API route ${routeKey} bundle is missing: ${sourceBundle}`, { cause: error });
    }
    const realRelative = path.relative(sourceRoot, realBundle);
    if (
      !realRelative ||
      realRelative === ".." ||
      realRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(realRelative)
    ) {
      throw new Error(
        `API route ${routeKey} bundle resolves outside the server tree: ${bundlePath}`
      );
    }
    const bundleStat = await fs.stat(realBundle);
    if (!bundleStat.isFile())
      throw new Error(`API route ${routeKey} bundle is not a file: ${bundlePath}`);
    resolvedBundles.set(routeKey, bundlePath);
  }

  const baseFunctionsMap = baseFunctions.functions;
  const overlayFunctionsMap = overlayFunctions.functions;
  const mergedFunctions = { ...baseFunctionsMap };
  let functionConfigCount = 0;
  for (const [routeKey, config] of Object.entries(overlayFunctionsMap)) {
    if (!isApiRoute(routeKey)) continue;
    mergedFunctions[routeKey] = config;
    functionConfigCount += 1;
  }

  const mergedRewrites = mergeRewriteGroups(baseRoutes.rewrites, overlayRoutes.rewrites);
  const mergedStaticRoutes = mergeApiRouteEntries(
    baseRoutes.staticRoutes,
    overlayRoutes.staticRoutes,
    "staticRoutes"
  );
  const mergedDynamicRoutes = mergeApiRouteEntries(
    baseRoutes.dynamicRoutes,
    overlayRoutes.dynamicRoutes,
    "dynamicRoutes"
  );
  if (!hasV1ApiRewrite(mergedRewrites)) {
    throw new Error("Merged routes manifest is missing the /v1/:path* to /api/v1/:path* rewrite");
  }

  const mergedAppPaths = { ...baseAppPaths };
  const mergedAppPathRoutes = { ...baseAppPathRoutes };
  for (const [routeKey, bundlePath] of resolvedBundles) {
    // AICODE-NOTE: Next 16.3.5 preserves absolute app-path entries; keeping a route and its chunks under one dist subtree lets Node resolve the route's relative webpack imports without touching official UI chunks.
    mergedAppPaths[routeKey] = path.resolve(
      normalizedRuntimeOverlayServerDir,
      ...bundlePath.split("/")
    );

    // AICODE-NOTE: Next 16.3.5 registers requestable App Router paths from this map; app-paths-manifest only locates the bundle after route matching.
    if (!Object.hasOwn(overlayAppPathRoutes, routeKey)) {
      throw new Error(`Backend overlay app-path-routes manifest is missing API route ${routeKey}`);
    }
    mergedAppPathRoutes[routeKey] = validateApiRoutePath(routeKey, overlayAppPathRoutes[routeKey]);
  }

  if (normalizedOverlayServerDir !== normalizedRuntimeOverlayServerDir) {
    await fs.rm(normalizedRuntimeOverlayServerDir, { recursive: true, force: true });
    await fs.mkdir(path.dirname(normalizedRuntimeOverlayServerDir), { recursive: true });
    await fs.cp(normalizedOverlayServerDir, normalizedRuntimeOverlayServerDir, {
      recursive: true,
      errorOnExist: true,
    });
  }

  await Promise.all([
    writeJsonAtomic(baseAppPathsFile, mergedAppPaths),
    writeJsonAtomic(baseAppPathRoutesFile, mergedAppPathRoutes),
    writeJsonAtomic(baseFunctionsFile, { ...baseFunctions, functions: mergedFunctions }),
    writeJsonAtomic(baseRoutesFile, {
      ...baseRoutes,
      staticRoutes: mergedStaticRoutes,
      dynamicRoutes: mergedDynamicRoutes,
      rewrites: mergedRewrites,
    }),
  ]);

  return {
    apiRouteCount: resolvedBundles.size,
    rewriteCount: REWRITE_GROUPS.reduce((count, group) => count + mergedRewrites[group].length, 0),
    functionConfigCount,
    overlayServerDir: normalizedRuntimeOverlayServerDir,
  };
}

function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key.startsWith("--") || index + 1 >= args.length || args[index + 1].startsWith("--")) {
      throw new Error(`Expected --name value, got ${key}`);
    }
    values.set(key, args[index + 1]);
    index += 1;
  }
  for (const key of [
    "--base-dist",
    "--overlay-server",
    "--overlay-routes",
    "--overlay-app-path-routes",
  ]) {
    if (!values.has(key)) throw new Error(`Missing required argument ${key}`);
  }
  return {
    baseDistDir: values.get("--base-dist"),
    overlayServerDir: values.get("--overlay-server"),
    overlayRoutesManifestPath: values.get("--overlay-routes"),
    overlayAppPathRoutesManifestPath: values.get("--overlay-app-path-routes"),
    runtimeOverlayServerDir: values.get("--runtime-overlay-server"),
  };
}

async function main() {
  try {
    const result = await mergeOfficialBackendOverlay(parseArguments(process.argv.slice(2)));
    console.log(
      `[backend-overlay] merged ${result.apiRouteCount} API routes, ${result.functionConfigCount} API function configs, and ${result.rewriteCount} rewrite rules into ${result.overlayServerDir}`
    );
  } catch (error) {
    console.error(`[backend-overlay] ${error.message}`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) await main();

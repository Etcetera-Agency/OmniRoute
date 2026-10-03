import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { mergeOfficialBackendOverlay } from "../../../scripts/build/merge-official-backend-overlay.mjs";

const require = createRequire(import.meta.url);
const { requirePage } = require("next/dist/server/require.js");
assert.equal(require("next/package.json").version, "16.3.5");

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omni-backend-overlay-"));
  const baseDistDir = path.join(root, "official", ".build", "next");
  const overlayDistDir = path.join(root, "fork", ".build", "backend-overlay");
  const baseServerDir = path.join(baseDistDir, "server");
  const overlayServerDir = path.join(overlayDistDir, "server");
  const runtimeOverlayServerDir = path.join(baseDistDir, "omni-overlay", "server");

  await writeJson(path.join(baseServerDir, "app-paths-manifest.json"), {
    "/": "app/page.js",
    "/api/v1/chat/completions/route": "app/api/v1/chat/completions/route.js",
    "/api/health/route": "app/api/health/route.js",
  });
  await writeJson(path.join(baseServerDir, "pages-manifest.json"), { "/_error": "pages/404.js" });
  await writeJson(path.join(baseServerDir, "functions-config-manifest.json"), {
    functions: {
      "/dashboard": { maxDuration: 60 },
      "/api/v1/chat/completions": { maxDuration: 30 },
      "/_middleware": { matchers: [{ regexp: ".*" }] },
    },
  });
  await writeJson(path.join(baseDistDir, "routes-manifest.json"), {
    version: 3,
    redirects: [],
    headers: [],
    rewrites: {
      beforeFiles: [],
      afterFiles: [
        { source: "/v1/:path*", destination: "/api/v1/:path*", basePath: false },
        { source: "/legacy/:path*", destination: "/api/legacy/:path*" },
      ],
      fallback: [],
    },
  });
  await fs.mkdir(path.join(baseServerDir, "app"), { recursive: true });
  await fs.writeFile(
    path.join(baseServerDir, "app", "page.js"),
    "module.exports = 'official-ui';\n"
  );
  await fs.mkdir(path.join(baseDistDir, "static"), { recursive: true });
  await fs.writeFile(
    path.join(baseDistDir, "static", "dashboard.js"),
    "official-dashboard-chunk\n"
  );
  await fs.writeFile(path.join(baseDistDir, "BUILD_ID"), "official-build-id\n");

  const systemOneRoute = "app/api/v1/systemone/route.js";
  const chatRoute = "app/api/v1/chat/completions/route.js";
  const chunkPath = "chunks/overlay-chunk.js";
  const routeSource = `module.exports = require("../../../../${chunkPath}");\n`;
  await fs.mkdir(path.join(overlayServerDir, path.dirname(systemOneRoute)), { recursive: true });
  await fs.mkdir(path.join(overlayServerDir, path.dirname(chatRoute)), { recursive: true });
  await fs.mkdir(path.join(overlayServerDir, "app/api/health"), { recursive: true });
  await fs.mkdir(path.join(overlayServerDir, "chunks"), { recursive: true });
  await fs.writeFile(path.join(overlayServerDir, systemOneRoute), routeSource);
  await fs.writeFile(path.join(overlayServerDir, chatRoute), routeSource);
  await fs.writeFile(path.join(overlayServerDir, "app/api/health/route.js"), routeSource);
  await fs.writeFile(
    path.join(overlayServerDir, chunkPath),
    "module.exports = { runtime: 'overlay' };\n"
  );
  await writeJson(path.join(overlayServerDir, "app-paths-manifest.json"), {
    "/api/v1/chat/completions/route": chatRoute,
    "/api/health/route": "app/api/health/route.js",
    "/api/v1/systemone/route": systemOneRoute,
  });
  await writeJson(path.join(overlayServerDir, "functions-config-manifest.json"), {
    functions: {
      "/api/v1/chat/completions": { maxDuration: 180 },
      "/api/v1/systemone": { maxDuration: 45 },
    },
  });
  await writeJson(path.join(overlayDistDir, "routes-manifest.json"), {
    rewrites: {
      beforeFiles: [],
      afterFiles: [
        { destination: "/api/v1/:path*", source: "/v1/:path*", basePath: false },
        { source: "/v1/systemone", destination: "/api/v1/systemone" },
      ],
      fallback: [],
    },
  });

  return {
    root,
    baseDistDir,
    baseServerDir,
    overlayDistDir,
    overlayServerDir,
    runtimeOverlayServerDir,
  };
}

test("API route bundles load from isolated overlay with their own relative chunks", async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  const { baseDistDir, baseServerDir, overlayDistDir, overlayServerDir, runtimeOverlayServerDir } =
    fixture;
  const officialUiBundle = await fs.readFile(path.join(baseServerDir, "app/page.js"), "utf8");
  const officialDashboardChunk = await fs.readFile(
    path.join(baseDistDir, "static/dashboard.js"),
    "utf8"
  );
  const officialBuildId = await fs.readFile(path.join(baseDistDir, "BUILD_ID"), "utf8");
  const officialPagesManifest = await fs.readFile(
    path.join(baseServerDir, "pages-manifest.json"),
    "utf8"
  );

  await mergeOfficialBackendOverlay({
    baseDistDir,
    overlayServerDir,
    overlayRoutesManifestPath: path.join(overlayDistDir, "routes-manifest.json"),
    runtimeOverlayServerDir,
  });

  const appPaths = await readJson(path.join(baseServerDir, "app-paths-manifest.json"));
  const routePath = path.join(runtimeOverlayServerDir, "app/api/v1/systemone/route.js");
  assert.equal(appPaths["/api/v1/systemone/route"], routePath);
  assert.equal(
    appPaths["/api/v1/chat/completions/route"],
    path.join(runtimeOverlayServerDir, "app/api/v1/chat/completions/route.js")
  );
  assert.equal(
    appPaths["/api/health/route"],
    path.join(runtimeOverlayServerDir, "app/api/health/route.js")
  );
  assert.equal(appPaths["/"], "app/page.js");

  const loadedRouteModule = await requirePage("/api/v1/systemone/route", baseDistDir, true);
  assert.deepEqual(loadedRouteModule, { runtime: "overlay" });

  assert.equal(
    await fs.readFile(path.join(baseServerDir, "app/page.js"), "utf8"),
    officialUiBundle
  );
  assert.equal(
    await fs.readFile(path.join(baseDistDir, "static/dashboard.js"), "utf8"),
    officialDashboardChunk
  );
  assert.equal(await fs.readFile(path.join(baseDistDir, "BUILD_ID"), "utf8"), officialBuildId);
  assert.equal(
    await fs.readFile(path.join(baseServerDir, "pages-manifest.json"), "utf8"),
    officialPagesManifest
  );
});

test("API runtime settings merge and route rewrites deduplicate without dropping official entries", async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  await mergeOfficialBackendOverlay({
    baseDistDir: fixture.baseDistDir,
    overlayServerDir: fixture.overlayServerDir,
    overlayRoutesManifestPath: path.join(fixture.overlayDistDir, "routes-manifest.json"),
    runtimeOverlayServerDir: fixture.runtimeOverlayServerDir,
  });

  const functions = await readJson(
    path.join(fixture.baseServerDir, "functions-config-manifest.json")
  );
  assert.deepEqual(functions.functions, {
    "/dashboard": { maxDuration: 60 },
    "/api/v1/chat/completions": { maxDuration: 180 },
    "/_middleware": { matchers: [{ regexp: ".*" }] },
    "/api/v1/systemone": { maxDuration: 45 },
  });

  const routes = await readJson(path.join(fixture.baseDistDir, "routes-manifest.json"));
  assert.equal(routes.version, 3);
  assert.deepEqual(routes.rewrites.afterFiles, [
    { source: "/v1/:path*", destination: "/api/v1/:path*", basePath: false },
    { source: "/legacy/:path*", destination: "/api/legacy/:path*" },
    { source: "/v1/systemone", destination: "/api/v1/systemone" },
  ]);
});

test("merger fails closed on missing stock API routes or paths outside overlay tree", async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  const manifestPath = path.join(fixture.overlayServerDir, "app-paths-manifest.json");
  const original = await readJson(manifestPath);
  const before = await fs.readFile(
    path.join(fixture.baseServerDir, "app-paths-manifest.json"),
    "utf8"
  );

  await writeJson(manifestPath, {
    ...original,
    "/api/health/route": "app/elsewhere/route.js",
  });
  await assert.rejects(
    mergeOfficialBackendOverlay({
      baseDistDir: fixture.baseDistDir,
      overlayServerDir: fixture.overlayServerDir,
      overlayRoutesManifestPath: path.join(fixture.overlayDistDir, "routes-manifest.json"),
      runtimeOverlayServerDir: fixture.runtimeOverlayServerDir,
    }),
    /API route.*outside.*server tree|bundle.*outside/i
  );
  assert.equal(
    await fs.readFile(path.join(fixture.baseServerDir, "app-paths-manifest.json"), "utf8"),
    before
  );

  await writeJson(manifestPath, {
    "/api/v1/chat/completions/route": "app/api/v1/chat/completions/route.js",
    "/api/v1/systemone/route": "app/api/v1/systemone/route.js",
  });
  await assert.rejects(
    mergeOfficialBackendOverlay({
      baseDistDir: fixture.baseDistDir,
      overlayServerDir: fixture.overlayServerDir,
      overlayRoutesManifestPath: path.join(fixture.overlayDistDir, "routes-manifest.json"),
      runtimeOverlayServerDir: fixture.runtimeOverlayServerDir,
    }),
    /missing.*\/api\/health\/route/i
  );
});

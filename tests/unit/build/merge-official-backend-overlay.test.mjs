import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import { mergeOfficialBackendOverlay } from "../../../scripts/build/merge-official-backend-overlay.mjs";

const require = createRequire(import.meta.url);
const { requirePage } = require("next/dist/server/require.js");
const { pageToRoute } = require("next/dist/build/utils.js");
const { normalizeAppPath } = require("next/dist/shared/lib/router/utils/app-paths.js");
const { setupFsCheck } = require("next/dist/server/lib/router-utils/filesystem.js");
const mergerScript = fileURLToPath(
  new URL("../../../scripts/build/merge-official-backend-overlay.mjs", import.meta.url)
);
assert.equal(require("next/package.json").version, "16.3.5");

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

function appPathRoutesManifest(...routeKeys) {
  return Object.fromEntries(routeKeys.map((routeKey) => [routeKey, normalizeAppPath(routeKey)]));
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
    "/dashboard/page": "app/dashboard/page.js",
    "/api/v1/chat/completions/route": "app/api/v1/chat/completions/route.js",
    "/api/v1/[...path]/route": "app/api/v1/[...path]/route.js",
    "/api/health/route": "app/api/health/route.js",
  });
  await writeJson(
    path.join(baseDistDir, "app-path-routes-manifest.json"),
    appPathRoutesManifest(
      "/dashboard/page",
      "/api/v1/chat/completions/route",
      "/api/v1/[...path]/route",
      "/api/health/route"
    )
  );
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
    onMatchHeaders: [],
    staticRoutes: [
      pageToRoute("/dashboard"),
      pageToRoute("/api/v1/chat/completions"),
      pageToRoute("/api/health"),
    ],
    dynamicRoutes: [pageToRoute("/api/v1/[...path]")],
    dataRoutes: [],
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
  await fs.writeFile(
    path.join(baseServerDir, "instrumentation.js"),
    "module.exports = { register() { globalThis.__officialInstrumentationStarted = true; } };\n"
  );
  await fs.mkdir(path.join(baseServerDir, "app", "dashboard"), { recursive: true });
  await fs.writeFile(
    path.join(baseServerDir, "app/dashboard/page.js"),
    "module.exports = 'official-dashboard';\n"
  );
  await fs.mkdir(path.join(baseDistDir, "static"), { recursive: true });
  await writeJson(path.join(baseDistDir, "prerender-manifest.json"), { preview: {} });
  await fs.writeFile(
    path.join(baseDistDir, "static", "dashboard.js"),
    "official-dashboard-chunk\n"
  );
  await fs.writeFile(path.join(baseDistDir, "BUILD_ID"), "official-build-id\n");

  const systemOneRoute = "app/api/v1/systemone/route.js";
  const dashboardStubRoute = "app/dashboard/stub/page.js";
  const chatRoute = "app/api/v1/chat/completions/route.js";
  const catchAllRoute = "app/api/v1/[...path]/route.js";
  const betaCatchAllRoute = "app/api/v1beta/models/[...path]/route.js";
  const chunkPath = "chunks/overlay-chunk.js";
  const routeSource = `module.exports = require("../../../../${chunkPath}");\n`;
  await fs.mkdir(path.join(overlayServerDir, path.dirname(systemOneRoute)), { recursive: true });
  await fs.mkdir(path.join(overlayServerDir, path.dirname(dashboardStubRoute)), {
    recursive: true,
  });
  await fs.mkdir(path.join(overlayServerDir, path.dirname(chatRoute)), { recursive: true });
  await fs.mkdir(path.join(overlayServerDir, path.dirname(catchAllRoute)), { recursive: true });
  await fs.mkdir(path.join(overlayServerDir, path.dirname(betaCatchAllRoute)), { recursive: true });
  await fs.mkdir(path.join(overlayServerDir, "app/api/health"), { recursive: true });
  await fs.mkdir(path.join(overlayServerDir, "chunks"), { recursive: true });
  await fs.writeFile(path.join(overlayServerDir, systemOneRoute), routeSource);
  await fs.writeFile(
    path.join(overlayServerDir, dashboardStubRoute),
    "module.exports = 'overlay-dashboard-stub';\n"
  );
  await fs.writeFile(path.join(overlayServerDir, chatRoute), routeSource);
  await fs.writeFile(path.join(overlayServerDir, catchAllRoute), routeSource);
  await fs.writeFile(path.join(overlayServerDir, betaCatchAllRoute), routeSource);
  await fs.writeFile(path.join(overlayServerDir, "app/api/health/route.js"), routeSource);
  await fs.writeFile(
    path.join(overlayServerDir, chunkPath),
    "module.exports = { runtime: 'overlay' };\n"
  );
  await fs.writeFile(
    path.join(overlayServerDir, "instrumentation.js"),
    'module.exports = require("./chunks/instrumentation-entry.js");\n'
  );
  await fs.writeFile(
    path.join(overlayServerDir, "chunks/instrumentation-entry.js"),
    'module.exports = { register: async () => require("../instrumentation-node.js").registerNodejs() };\n'
  );
  await fs.writeFile(
    path.join(overlayServerDir, "instrumentation-node.js"),
    "exports.registerNodejs = async () => { globalThis.__overlayInstrumentationStartedFrom = __filename; };\n"
  );
  await writeJson(path.join(overlayServerDir, "app-paths-manifest.json"), {
    "/dashboard/stub/page": dashboardStubRoute,
    "/api/v1/chat/completions/route": chatRoute,
    "/api/v1/[...path]/route": catchAllRoute,
    "/api/v1beta/models/[...path]/route": betaCatchAllRoute,
    "/api/health/route": "app/api/health/route.js",
    "/api/v1/systemone/route": systemOneRoute,
  });
  await writeJson(
    path.join(overlayDistDir, "app-path-routes-manifest.json"),
    appPathRoutesManifest(
      "/dashboard/stub/page",
      "/api/v1/chat/completions/route",
      "/api/v1/[...path]/route",
      "/api/v1beta/models/[...path]/route",
      "/api/health/route",
      "/api/v1/systemone/route"
    )
  );
  await writeJson(path.join(overlayServerDir, "functions-config-manifest.json"), {
    functions: {
      "/api/v1/chat/completions": { maxDuration: 180 },
      "/api/v1/systemone": { maxDuration: 45 },
    },
  });
  await writeJson(path.join(overlayDistDir, "routes-manifest.json"), {
    staticRoutes: [
      pageToRoute("/dashboard"),
      pageToRoute("/dashboard/stub"),
      pageToRoute("/api/v1/chat/completions"),
      pageToRoute("/api/health"),
      pageToRoute("/api/v1/systemone"),
    ],
    dynamicRoutes: [pageToRoute("/api/v1/[...path]"), pageToRoute("/api/v1beta/models/[...path]")],
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
    officialDir: path.dirname(path.dirname(baseDistDir)),
    baseServerDir,
    overlayDistDir,
    overlayServerDir,
    runtimeOverlayServerDir,
  };
}

function mergeFixtureBackend(fixture) {
  return mergeOfficialBackendOverlay({
    baseDistDir: fixture.baseDistDir,
    overlayServerDir: fixture.overlayServerDir,
    overlayRoutesManifestPath: path.join(fixture.overlayDistDir, "routes-manifest.json"),
    overlayAppPathRoutesManifestPath: path.join(
      fixture.overlayDistDir,
      "app-path-routes-manifest.json"
    ),
    runtimeOverlayServerDir: fixture.runtimeOverlayServerDir,
  });
}

test("root startup entry loads source-built instrumentation and its overlay dependencies", async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  const previousRuntime = process.env.NEXT_RUNTIME;
  delete globalThis.__officialInstrumentationStarted;
  delete globalThis.__overlayInstrumentationStartedFrom;
  process.env.NEXT_RUNTIME = "nodejs";

  try {
    await mergeFixtureBackend(fixture);
    const startup = require(path.join(fixture.baseServerDir, "instrumentation.js"));
    await startup.register();

    assert.equal(
      globalThis.__overlayInstrumentationStartedFrom,
      path.join(fixture.runtimeOverlayServerDir, "instrumentation-node.js")
    );
    assert.equal(globalThis.__officialInstrumentationStarted, undefined);
  } finally {
    if (previousRuntime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = previousRuntime;
    delete globalThis.__officialInstrumentationStarted;
    delete globalThis.__overlayInstrumentationStartedFrom;
  }
});

test("final Docker runtime COPY contract retains source-built startup and official UI", async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const finalDistDir = path.join(fixture.root, "final", ".build", "next");
  await fs.cp(fixture.baseDistDir, finalDistDir, { recursive: true });
  await mergeFixtureBackend(fixture);

  const dockerfile = await fs.readFile(
    new URL("../../../docker/official-backend-overlay.Dockerfile", import.meta.url),
    "utf8"
  );
  const runtimeStage = dockerfile
    .replace(/\\\r?\n/g, " ")
    .split(/^FROM \$\{OFFICIAL_IMAGE\} AS runtime\s*$/m);
  assert.equal(runtimeStage.length, 2, "fixture supports the explicit official runtime stage");
  const copies = runtimeStage[1]
    .split(/^FROM\s/m)[0]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("COPY --from=merged-backend "));
  assert.ok(copies.length > 0);
  for (const copy of copies) {
    const match = /^COPY --from=merged-backend\s+(\S+)\s+(\S+)$/.exec(copy);
    assert.ok(match, `unsupported runtime COPY layout: ${copy}`);
    const [, source, destination] = match;
    const prefix = "/app/.build/next/";
    assert.ok(source.startsWith(prefix) && destination.startsWith(prefix));
    const target = path.join(finalDistDir, destination.slice(prefix.length));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(path.join(fixture.baseDistDir, source.slice(prefix.length)), target, {
      recursive: true,
    });
  }

  delete globalThis.__officialInstrumentationStarted;
  delete globalThis.__overlayInstrumentationStartedFrom;
  try {
    await require(path.join(finalDistDir, "server/instrumentation.js")).register();
    assert.equal(
      globalThis.__overlayInstrumentationStartedFrom,
      path.join(finalDistDir, "omni-overlay/server/instrumentation-node.js")
    );
    assert.equal(globalThis.__officialInstrumentationStarted, undefined);
    for (const file of [
      "server/app/page.js",
      "server/pages-manifest.json",
      "static/dashboard.js",
      "BUILD_ID",
      "server/app-paths-manifest.json",
      "app-path-routes-manifest.json",
      "server/functions-config-manifest.json",
      "routes-manifest.json",
    ]) {
      assert.deepEqual(
        await fs.readFile(path.join(finalDistDir, file)),
        await fs.readFile(path.join(fixture.baseDistDir, file)),
        file
      );
    }
  } finally {
    delete globalThis.__officialInstrumentationStarted;
    delete globalThis.__overlayInstrumentationStartedFrom;
  }
});

test("merger fails closed when source-built startup instrumentation is missing", async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  const baseAppPathsFile = path.join(fixture.baseServerDir, "app-paths-manifest.json");
  const originalAppPaths = await fs.readFile(baseAppPathsFile, "utf8");
  await fs.rm(path.join(fixture.overlayServerDir, "instrumentation.js"));

  await assert.rejects(mergeFixtureBackend(fixture), /backend overlay startup instrumentation/i);
  assert.equal(await fs.readFile(baseAppPathsFile, "utf8"), originalAppPaths);
});

test("API route bundles load from isolated overlay with their own relative chunks", async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  const { baseDistDir, officialDir, baseServerDir, runtimeOverlayServerDir } = fixture;
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

  await mergeFixtureBackend(fixture);

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

  const appPathRoutes = await readJson(path.join(baseDistDir, "app-path-routes-manifest.json"));
  assert.equal(appPathRoutes["/dashboard/page"], normalizeAppPath("/dashboard/page"));
  assert.equal(appPathRoutes["/dashboard/stub/page"], undefined);
  assert.equal(
    appPathRoutes["/api/v1/systemone/route"],
    normalizeAppPath("/api/v1/systemone/route")
  );
  assert.equal(
    appPathRoutes["/api/v1/chat/completions/route"],
    normalizeAppPath("/api/v1/chat/completions/route")
  );
  assert.equal(
    appPathRoutes["/api/v1/[...path]/route"],
    normalizeAppPath("/api/v1/[...path]/route")
  );

  const fsChecker = await setupFsCheck({
    dev: false,
    dir: officialDir,
    config: {
      distDir: path.relative(officialDir, baseDistDir),
      output: "standalone",
      basePath: "",
      i18n: undefined,
      experimental: { caseSensitiveRoutes: false },
    },
    minimalMode: false,
  });
  const systemOneItem = await fsChecker.getItem("/api/v1/systemone");
  assert.equal(systemOneItem?.type, "appFile");
  assert.equal(systemOneItem?.itemPath, "/api/v1/systemone");

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

  await mergeFixtureBackend(fixture);

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
  assert.deepEqual(
    routes.staticRoutes.map((route) => route.page),
    ["/api/health", "/api/v1/chat/completions", "/api/v1/systemone", "/dashboard"]
  );
  assert.deepEqual(
    routes.dynamicRoutes.map((route) => route.page),
    ["/api/v1/[...path]", "/api/v1beta/models/[...path]"]
  );
});

test("merger runs without the build-only sorter and keeps dynamic API precedence", async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  const baseRoutesFile = path.join(fixture.baseDistDir, "routes-manifest.json");
  const overlayRoutesFile = path.join(fixture.overlayDistDir, "routes-manifest.json");
  const baseRoutes = await readJson(baseRoutesFile);
  const overlayRoutes = await readJson(overlayRoutesFile);
  baseRoutes.dynamicRoutes = [pageToRoute("/api/[...path]")];
  overlayRoutes.dynamicRoutes = [pageToRoute("/api/v1/[...path]"), pageToRoute("/api/v1/[id]")];
  await writeJson(baseRoutesFile, baseRoutes);
  await writeJson(overlayRoutesFile, overlayRoutes);

  const runnerScript = path.join(fixture.root, "deny-build-only-sorter.mjs");
  await fs.writeFile(
    runnerScript,
    `import { createRequire } from "node:module";
const require = createRequire(${JSON.stringify(mergerScript)});
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "next/dist/shared/lib/router/utils/sortable-routes.js") {
    throw new Error("build-only sorter is unavailable in runtime");
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { mergeOfficialBackendOverlay } = await import(${JSON.stringify(pathToFileURL(mergerScript).href)});
await mergeOfficialBackendOverlay({
  baseDistDir: ${JSON.stringify(fixture.baseDistDir)},
  overlayServerDir: ${JSON.stringify(fixture.overlayServerDir)},
  overlayRoutesManifestPath: ${JSON.stringify(overlayRoutesFile)},
  overlayAppPathRoutesManifestPath: ${JSON.stringify(path.join(fixture.overlayDistDir, "app-path-routes-manifest.json"))},
  runtimeOverlayServerDir: ${JSON.stringify(fixture.runtimeOverlayServerDir)},
});
`
  );
  execFileSync(process.execPath, [runnerScript], { encoding: "utf8" });

  const mergedRoutes = await readJson(baseRoutesFile);
  assert.deepEqual(
    mergedRoutes.dynamicRoutes.map((route) => route.page),
    ["/api/v1/[id]", "/api/v1/[...path]", "/api/[...path]"]
  );
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
    mergeFixtureBackend(fixture),
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
  await assert.rejects(mergeFixtureBackend(fixture), /missing official API route/i);
});

test("merger rejects missing, traversing, or mismatched API app paths before writes", async (t) => {
  const invalidMappings = [
    {
      name: "missing API mapping",
      update(mapping) {
        delete mapping["/api/v1/systemone/route"];
      },
      error: /app-path-routes manifest is missing API route/,
    },
    {
      name: "traversing API mapping",
      update(mapping) {
        mapping["/api/v1/systemone/route"] = "/api/v1/../../outside";
      },
      error: /must map to normalized app path/,
    },
    {
      name: "valid but wrong API mapping",
      update(mapping) {
        mapping["/api/v1/systemone/route"] = "/api/v1/other";
      },
      error: /must map to normalized app path/,
    },
  ];

  for (const invalidMapping of invalidMappings) {
    await t.test(invalidMapping.name, async (subtest) => {
      const fixture = await makeFixture();
      subtest.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

      const overlayPathRoutesFile = path.join(
        fixture.overlayDistDir,
        "app-path-routes-manifest.json"
      );
      const overlayPathRoutes = await readJson(overlayPathRoutesFile);
      invalidMapping.update(overlayPathRoutes);
      await writeJson(overlayPathRoutesFile, overlayPathRoutes);

      const outputFiles = [
        path.join(fixture.baseServerDir, "app-paths-manifest.json"),
        path.join(fixture.baseDistDir, "app-path-routes-manifest.json"),
        path.join(fixture.baseServerDir, "functions-config-manifest.json"),
        path.join(fixture.baseDistDir, "routes-manifest.json"),
      ];
      const before = await Promise.all(outputFiles.map((file) => fs.readFile(file, "utf8")));

      await assert.rejects(mergeFixtureBackend(fixture), invalidMapping.error);

      const after = await Promise.all(outputFiles.map((file) => fs.readFile(file, "utf8")));
      assert.deepEqual(after, before);
      await assert.rejects(fs.stat(fixture.runtimeOverlayServerDir), { code: "ENOENT" });
    });
  }
});

import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

const OFFICIAL_UI_ROOT = "/app/.build/next";
const DIRECT_UI_API_PATH = "/api/v1/models";
const DIRECT_UI_PORT = 20128;
const BROWSER_SMOKE_TIMEOUT_MS = 45_000;
const EXPECTED_RUNTIME_CONFIGURATION = {
  User: "node",
  Entrypoint: [
    "/usr/bin/xvfb-run",
    "-a",
    "-s",
    "-screen 0 1920x1080x24 -nolisten tcp",
    "/app/check-permissions.sh",
  ],
  Cmd: ["node", "dev/run-standalone.mjs"],
};
const SCRIPT_PATH = fileURLToPath(import.meta.url);

// AICODE-NOTE: this verifier targets the direct Next UI listener. The API proxy
// on 20129 has a separate auth envelope and would not prove route preservation.

function requireEvidence(condition, message) {
  if (!condition) throw new Error(message);
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function diagnosticTag(value) {
  if (typeof value !== "string") return `<${typeof value}>`;
  return value.slice(0, 64).replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, "?");
}

export async function withCleanup(action, cleanups) {
  let result;
  let hasPrimaryError = false;
  let primaryError;
  try {
    result = await action();
  } catch (error) {
    hasPrimaryError = true;
    primaryError = error;
  }

  const cleanupErrors = [];
  for (const cleanup of cleanups) {
    try {
      await cleanup();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (hasPrimaryError && cleanupErrors.length > 0) {
    const cleanupMessages = cleanupErrors.map((error) => `cleanup failed: ${describeError(error)}`);
    throw new AggregateError(
      [primaryError, ...cleanupErrors],
      `${describeError(primaryError)}; ${cleanupMessages.join("; ")}`,
      { cause: primaryError }
    );
  }
  if (hasPrimaryError) throw primaryError;
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      cleanupErrors.map((error) => `cleanup failed: ${describeError(error)}`).join("; "),
      { cause: cleanupErrors[0] }
    );
  }
  return result;
}

// AICODE-NOTE: Nested verification stages retain primary and cleanup errors so
// later cleanup failures cannot hide earlier image-check failures.

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalJson(value[key])])
  );
}

function staticFileMap(files) {
  return files.map(({ path: filePath, sha256 }) => `${filePath}\0${sha256}`).sort();
}

function diagnosticRuntimeValue(value) {
  if (!Array.isArray(value)) return diagnosticTag(value);
  const items = value.slice(0, 8).map(diagnosticTag);
  if (value.length > 8) items.push("<truncated>");
  return items;
}

// AICODE-NOTE: Check Docker inspect fields before SQLite or app containers start.
export function verifyCandidateRuntimeConfiguration(config) {
  for (const [field, expected] of Object.entries(EXPECTED_RUNTIME_CONFIGURATION)) {
    const observed = config?.[field];
    requireEvidence(
      isDeepStrictEqual(observed, expected),
      `candidate image config ${field} mismatch; expected ${JSON.stringify(
        diagnosticRuntimeValue(expected)
      )}; observed ${JSON.stringify(diagnosticRuntimeValue(observed))}`
    );
  }
}

export function verifyCandidateEvidence(evidence, expected) {
  const candidate = evidence?.candidate;
  const official = evidence?.official;
  requireEvidence(candidate && official, "candidate and official image evidence are required");
  requireEvidence(candidate.architecture === "arm64", "candidate image must be ARM64");

  const labels = candidate.labels ?? {};
  requireEvidence(
    labels["org.opencontainers.image.source"] === expected.source,
    "candidate OCI source label does not match the fork repository"
  );
  requireEvidence(
    labels["org.opencontainers.image.revision"] === expected.revision,
    "candidate OCI revision label does not match the source commit"
  );
  requireEvidence(
    labels["org.opencontainers.image.base.digest"] === expected.baseDigest,
    "candidate OCI base digest label does not match the pinned official image"
  );

  requireEvidence(
    candidate.sqlite?.ok === true &&
      candidate.sqlite.queryResult === 1 &&
      candidate.sqlite.version === "3.53.4",
    "candidate native SQLite check failed or returned an unexpected version"
  );
  requireEvidence(
    candidate.healthStatus === "healthy",
    "candidate container did not become healthy"
  );
  requireEvidence(candidate.dashboardStatus === 200, "candidate dashboard did not return HTTP 200");

  const api = candidate.apiResponse;
  requireEvidence(
    api?.port === DIRECT_UI_PORT && api.path === DIRECT_UI_API_PATH,
    "API smoke must target the direct UI listener at 20128/api/v1/models"
  );
  // AICODE-NOTE: Preserved official proxy rejects this keyless request before the catalog handler.
  requireEvidence(
    api.status === 401 && api.body?.error?.code === "AUTH_002",
    // AICODE-NOTE: Allowlist bounded error tags; never expose response bodies or credentials.
    "direct UI listener /api/v1/models must return 401 AUTH_002 without credentials; " +
      `observed ${JSON.stringify({
        status: Number.isInteger(api.status) ? api.status : "<invalid>",
        type: diagnosticTag(api.body?.error?.type),
        code: diagnosticTag(api.body?.error?.code),
      })}`
  );

  const browserSmoke = candidate.browserSmoke;
  requireEvidence(
    browserSmoke?.ok === true &&
      Number.isInteger(browserSmoke.userId) &&
      browserSmoke.userId > 0 &&
      browserSmoke.headless === false &&
      browserSmoke.url === "about:blank" &&
      browserSmoke.closed === true,
    "candidate headed Playwright Chromium smoke failed, ran as root, or did not close on about:blank"
  );

  requireEvidence(candidate.ui?.buildId === official.ui?.buildId, "official UI BUILD_ID changed");
  requireEvidence(
    candidate.ui.staticFiles?.length > 0 &&
      isDeepStrictEqual(
        staticFileMap(candidate.ui.staticFiles),
        staticFileMap(official.ui.staticFiles ?? [])
      ),
    "official UI static assets changed"
  );
  requireEvidence(
    isDeepStrictEqual(
      canonicalJson(candidate.ui.pagesManifest),
      canonicalJson(official.ui.pagesManifest)
    ),
    "official UI pages manifest changed"
  );
  requireEvidence(
    isDeepStrictEqual(
      canonicalJson(candidate.ui.nonApiAppPaths),
      canonicalJson(official.ui.nonApiAppPaths)
    ),
    "official non-API app paths changed"
  );
}

function docker(args, options = {}) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || "").trim();
    throw new Error(`docker ${args[0]} failed${details ? `: ${details}` : ""}`);
  }
  return result.stdout.trim();
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`unexpected argument: ${argument}`);
    const name = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for --${name}`);
    options[name] = value;
    index += 1;
  }

  for (const name of ["candidate", "official", "source", "revision", "base-digest"]) {
    if (!options[name]) throw new Error(`required option missing: --${name}`);
  }
  return {
    candidate: options.candidate,
    official: options.official,
    source: options.source,
    revision: options.revision,
    baseDigest: options["base-digest"],
  };
}

function imageMetadata(image) {
  return JSON.parse(docker(["image", "inspect", image]))[0];
}

async function extractUi(image, name, root) {
  const container = `${name}-${randomBytes(5).toString("hex")}`;
  const destination = path.join(root, name);
  let id;

  await withCleanup(async () => {
    await fs.mkdir(destination, { recursive: true });
    id = docker(["create", "--platform", "linux/arm64", "--name", container, image]);
    for (const item of [
      "BUILD_ID",
      "static",
      "server/pages-manifest.json",
      "server/app-paths-manifest.json",
    ]) {
      const target = path.join(destination, item);
      await fs.mkdir(path.dirname(target), { recursive: true });
      docker(["cp", `${id}:${OFFICIAL_UI_ROOT}/${item}`, target]);
    }
  }, [() => (id ? docker(["rm", "--force", id]) : undefined)]);

  const staticFiles = [];
  async function collect(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await collect(absolute);
      } else if (entry.isFile()) {
        const contents = await fs.readFile(absolute);
        staticFiles.push({
          path: path.relative(path.join(destination, "static"), absolute).split(path.sep).join("/"),
          sha256: `sha256:${createHash("sha256").update(contents).digest("hex")}`,
        });
      } else {
        throw new Error(`unexpected non-file in UI static tree: ${absolute}`);
      }
    }
  }
  await collect(path.join(destination, "static"));

  const pagesManifest = JSON.parse(
    await fs.readFile(path.join(destination, "server/pages-manifest.json"), "utf8")
  );
  const appPaths = JSON.parse(
    await fs.readFile(path.join(destination, "server/app-paths-manifest.json"), "utf8")
  );
  const nonApiAppPaths = Object.fromEntries(
    Object.entries(appPaths).filter(([route]) => !/^\/api(?:\/|$)/i.test(route))
  );

  return {
    buildId: (await fs.readFile(path.join(destination, "BUILD_ID"), "utf8")).trim(),
    staticFiles,
    pagesManifest,
    nonApiAppPaths,
  };
}

function runNativeSqliteCheck(candidate) {
  const script = [
    "const Database = require('better-sqlite3');",
    "const db = new Database(':memory:');",
    "const result = db.prepare('select sqlite_version() as version, 1 as value').get();",
    "db.close();",
    "process.stdout.write(JSON.stringify({ version: result.version, queryResult: result.value }));",
  ].join(" ");
  const output = docker([
    "run",
    "--rm",
    "--platform",
    "linux/arm64",
    "--entrypoint",
    "node",
    candidate,
    "-e",
    script,
  ]);
  const result = JSON.parse(output);
  return { ...result, ok: result.queryResult === 1 };
}

async function waitForHealth(baseUrl, container) {
  const deadline = Date.now() + 120_000;
  let lastError;
  while (Date.now() < deadline) {
    const health = JSON.parse(docker(["inspect", "--format", "{{json .State.Health}}", container]));
    if (health?.Status === "healthy") return;
    if (health?.Status === "unhealthy") {
      throw new Error(
        `candidate healthcheck became unhealthy: ${health.Log?.at(-1)?.Output ?? "no output"}`
      );
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(3_000) });
      if (!response.ok) lastError = new Error(`/healthz returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`candidate healthcheck timed out${lastError ? `: ${lastError.message}` : ""}`);
}

// AICODE-NOTE: Run headed Chromium as node under isolated Xvfb; timeout and
// container cleanup bound failures without contacting external services.
function runBrowserSmoke(container) {
  const script = `
import { chromium } from 'playwright';

const userId = process.getuid?.();
if (!Number.isInteger(userId) || userId === 0) {
  throw new Error('browser smoke must run as non-root');
}

let browser;
let url;
try {
  browser = await chromium.launch({
    headless: false,
    timeout: 20000,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.goto('about:blank', { waitUntil: 'load', timeout: 10000 });
  url = page.url();
  if (url !== 'about:blank') {
    throw new Error('browser smoke navigated away from about:blank');
  }
  await browser.close();
  browser = null;
} catch (error) {
  if (browser) {
    try {
      await browser.close();
    } catch (cleanupError) {
      const message = [
        String(error),
        'browser cleanup failed: ' + String(cleanupError),
      ].join('; ');
      throw new AggregateError([error, cleanupError], message, { cause: error });
    }
  }
  throw error;
}

process.stdout.write(JSON.stringify({
  ok: true,
  userId,
  headless: false,
  url,
  closed: browser === null,
}));
`.trim();
  const output = docker(
    [
      "exec",
      "--user",
      "node",
      container,
      "/usr/bin/xvfb-run",
      "-a",
      "-s",
      "-screen 0 1920x1080x24 -nolisten tcp",
      "node",
      "--input-type=module",
      "-e",
      script,
    ],
    { timeout: BROWSER_SMOKE_TIMEOUT_MS }
  );
  return JSON.parse(output);
}

export function buildSmokeContainerArguments(candidate, container) {
  // AICODE-NOTE: Per-container tmpfs avoids host/container UID cleanup conflicts
  // while mode 1777 keeps the image's default runtime user able to write.
  return [
    "run",
    // AICODE-NOTE: Init lets Xvfb complete its readiness signal handshake before Node starts.
    "--init",
    "--detach",
    "--platform",
    "linux/arm64",
    "--name",
    container,
    "--publish",
    "127.0.0.1::20128",
    "--tmpfs",
    "/app/data:rw,nosuid,nodev,noexec,mode=1777",
    "--env",
    "DATA_DIR=/app/data",
    "--env",
    "HOSTNAME=0.0.0.0",
    "--env",
    "PORT=20128",
    "--env",
    "DASHBOARD_PORT=20128",
    "--env",
    "API_PORT=20129",
    "--env",
    "REDIS_URL=redis://127.0.0.1:1",
    "--env",
    "REQUIRE_API_KEY=true",
    "--env",
    "INITIAL_PASSWORD",
    candidate,
  ];
}

async function smokeCandidate(candidate) {
  const container = `omni-overlay-smoke-${randomBytes(6).toString("hex")}`;
  const password = randomBytes(32).toString("base64url");
  let containerId;

  return withCleanup(async () => {
    containerId = docker(buildSmokeContainerArguments(candidate, container), {
      env: { ...process.env, INITIAL_PASSWORD: password },
    });
    const publishedPort = docker(["port", container, "20128/tcp"]);
    const hostPort = publishedPort.split(":").at(-1);
    requireEvidence(
      /^\d+$/.test(hostPort ?? ""),
      `could not resolve the candidate UI port: ${publishedPort}`
    );
    const baseUrl = `http://127.0.0.1:${hostPort}`;
    await waitForHealth(baseUrl, container);

    const dashboard = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(10_000) });
    await dashboard.arrayBuffer();
    const api = await fetch(`${baseUrl}${DIRECT_UI_API_PATH}`, {
      signal: AbortSignal.timeout(10_000),
    });
    let body;
    try {
      body = await api.json();
    } catch {
      body = null;
    }
    const browserSmoke = runBrowserSmoke(container);

    return {
      healthStatus: "healthy",
      dashboardStatus: dashboard.status,
      browserSmoke,
      apiResponse: {
        port: DIRECT_UI_PORT,
        path: DIRECT_UI_API_PATH,
        status: api.status,
        body,
      },
    };
  }, [() => (containerId ? docker(["rm", "--force", containerId]) : undefined)]);
}

export async function verifyImages(options) {
  const expected = {
    source: options.source,
    revision: options.revision,
    baseDigest: options.baseDigest,
  };
  requireEvidence(
    /^[a-f0-9]{40}$/i.test(expected.revision),
    "source revision must be a full 40-character commit SHA"
  );
  requireEvidence(
    /^sha256:[a-f0-9]{64}$/i.test(expected.baseDigest),
    "base digest must be a SHA-256 digest"
  );

  const candidateMetadata = imageMetadata(options.candidate);
  // AICODE-NOTE: Validate actual image config, not assumed Dockerfile inheritance.
  verifyCandidateRuntimeConfiguration(candidateMetadata.Config);
  const candidateLabels = candidateMetadata.Config?.Labels ?? {};
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omni-overlay-ui-"));
  return withCleanup(async () => {
    const sqlite = runNativeSqliteCheck(options.candidate);
    const runtime = await smokeCandidate(options.candidate);
    const candidateUi = await extractUi(options.candidate, "candidate", tempRoot);
    const officialUi = await extractUi(options.official, "official", tempRoot);
    const evidence = {
      candidate: {
        architecture: candidateMetadata.Architecture,
        labels: candidateLabels,
        sqlite,
        ...runtime,
        ui: candidateUi,
      },
      official: { ui: officialUi },
    };
    verifyCandidateEvidence(evidence, expected);
    return {
      architecture: evidence.candidate.architecture,
      source: candidateLabels["org.opencontainers.image.source"],
      revision: candidateLabels["org.opencontainers.image.revision"],
      baseDigest: candidateLabels["org.opencontainers.image.base.digest"],
      sqlite,
      dashboardStatus: runtime.dashboardStatus,
      browserSmoke: runtime.browserSmoke,
      apiPath: runtime.apiResponse.path,
      apiPort: runtime.apiResponse.port,
      apiStatus: runtime.apiResponse.status,
      apiErrorCode: runtime.apiResponse.body.error.code,
      buildId: candidateUi.buildId,
      staticFileCount: candidateUi.staticFiles.length,
      nonApiRouteCount: Object.keys(candidateUi.nonApiAppPaths).length,
    };
  }, [() => fs.rm(tempRoot, { recursive: true, force: true })]);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = await verifyImages(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error) => {
    process.stderr.write(`Official overlay image verification failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

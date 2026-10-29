import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const verifierUrl = new URL(
  "../../../scripts/ci/verify-official-overlay-image.mjs",
  import.meta.url
);
const verifier = await import(verifierUrl.href).catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return null;
  throw error;
});

const EXPECTED = {
  source: "https://github.com/Etcetera-Agency/OmniRoute",
  revision: "1234567890abcdef1234567890abcdef12345678",
  baseDigest: "sha256:b08a12e876baa8a5ccadd1ebbe346fe7267dba3b1c9f4fd6bb02070fae41ab6c",
};

function makeRuntimeConfig() {
  return {
    User: "node",
    Entrypoint: [
      "/usr/bin/xvfb-run",
      "-a",
      "-s",
      "-screen 0 1920x1080x24 -nolisten tcp",
      "/app/check-permissions.sh",
    ],
    Cmd: ["node", "dev/run-standalone.mjs"],
    Env: ["PRIVATE_VALUE=do-not-log"],
  };
}

function makeUi() {
  return {
    buildId: "stock-build-id",
    staticFiles: [
      { path: "chunks/app.js", sha256: "sha256:app" },
      { path: "css/dashboard.css", sha256: "sha256:css" },
    ],
    pagesManifest: { "/_error": "pages/404.js", "/_app": "pages/_app.js" },
    nonApiAppPaths: {
      "/dashboard/page": "app/dashboard/page.js",
      "/": "app/page.js",
    },
  };
}

function makeEvidence() {
  const ui = makeUi();
  return {
    candidate: {
      architecture: "arm64",
      labels: {
        "org.opencontainers.image.source": EXPECTED.source,
        "org.opencontainers.image.revision": EXPECTED.revision,
        "org.opencontainers.image.base.digest": EXPECTED.baseDigest,
      },
      buildSha: EXPECTED.revision,
      sqlite: { ok: true, version: "3.53.4", queryResult: 1 },
      healthStatus: "healthy",
      dashboardStatus: 200,
      apiResponse: {
        status: 401,
        path: "/api/v1/models",
        port: 20128,
        body: { error: { code: "AUTH_002" } },
      },
      browserSmoke: {
        ok: true,
        userId: 1000,
        headless: false,
        url: "about:blank",
        closed: true,
      },
      ui,
    },
    official: { ui: structuredClone(ui) },
  };
}

function requireVerifier() {
  assert.ok(verifier, "official overlay image verifier must exist");
  assert.equal(typeof verifier.verifyCandidateEvidence, "function");
  return verifier.verifyCandidateEvidence;
}

function requireSmokeHelpers() {
  assert.ok(verifier, "official overlay image verifier must exist");
  assert.equal(typeof verifier.buildSmokeContainerArguments, "function");
  assert.equal(typeof verifier.buildBuildShaCheckArguments, "function");
  assert.equal(typeof verifier.withCleanup, "function");
  return verifier;
}

function requireRuntimeConfigVerifier() {
  assert.ok(verifier, "official overlay image verifier must exist");
  assert.equal(typeof verifier.verifyCandidateRuntimeConfiguration, "function");
  return verifier.verifyCandidateRuntimeConfiguration;
}

function requireMigrationVerifier() {
  assert.ok(verifier, "official overlay image verifier must exist");
  assert.equal(typeof verifier.verifyCandidateMigrations, "function");
  return verifier.verifyCandidateMigrations;
}

test("verifier accepts a healthy ARM64 overlay that preserves official UI", () => {
  const verifyCandidateEvidence = requireVerifier();
  assert.doesNotThrow(() => verifyCandidateEvidence(makeEvidence(), EXPECTED));
});

test("candidate image must contain every source migration with matching contents", () => {
  const verifyCandidateMigrations = requireMigrationVerifier();
  const source = [
    { name: "197_model_benchmark_search.sql", sha256: "sha256:197" },
    { name: "198_model_benchmark_catalog_backfill.sql", sha256: "sha256:198" },
  ];

  assert.throws(() => verifyCandidateMigrations([], []), /source migration inventory is empty/i);
  assert.doesNotThrow(() => verifyCandidateMigrations(source, source));
  assert.throws(
    () => verifyCandidateMigrations(source.slice(0, 1), source),
    /candidate image migration missing or mismatched: 198_model_benchmark_catalog_backfill\.sql/i
  );

  const changed = structuredClone(source);
  changed[1].sha256 = "sha256:wrong";
  assert.throws(
    () => verifyCandidateMigrations(changed, source),
    /candidate image migration missing or mismatched: 198_model_benchmark_catalog_backfill\.sql/i
  );

  assert.throws(
    () =>
      verifyCandidateMigrations(
        [...source, { name: "199_unexpected.sql", sha256: "sha256:199" }],
        source
      ),
    /candidate image has unexpected migration: 199_unexpected\.sql/i
  );
});

test("verifier rejects a missing or mismatched overlay BUILD_SHA", () => {
  const verifyCandidateEvidence = requireVerifier();

  const missing = makeEvidence();
  delete missing.candidate.buildSha;
  assert.throws(
    () => verifyCandidateEvidence(missing, EXPECTED),
    /server BUILD_SHA does not match the source revision/i
  );

  const mismatch = makeEvidence();
  mismatch.candidate.buildSha = "e461ed673dd360d3759d3fbfa7ec402068448570";
  assert.throws(
    () => verifyCandidateEvidence(mismatch, EXPECTED),
    /server BUILD_SHA does not match the source revision/i
  );
});

test("verifier requires headed non-root Chromium smoke to close on about:blank", () => {
  const verifyCandidateEvidence = requireVerifier();
  const invalidBrowserProofs = [
    [
      "missing",
      (evidence) => {
        delete evidence.candidate.browserSmoke;
      },
    ],
    [
      "failed",
      (evidence) => {
        evidence.candidate.browserSmoke.ok = false;
      },
    ],
    [
      "root user",
      (evidence) => {
        evidence.candidate.browserSmoke.userId = 0;
      },
    ],
    [
      "headless",
      (evidence) => {
        evidence.candidate.browserSmoke.headless = true;
      },
    ],
    [
      "external page",
      (evidence) => {
        evidence.candidate.browserSmoke.url = "https://example.invalid";
      },
    ],
    [
      "unclean close",
      (evidence) => {
        evidence.candidate.browserSmoke.closed = false;
      },
    ],
  ];

  for (const [label, corrupt] of invalidBrowserProofs) {
    const evidence = makeEvidence();
    corrupt(evidence);
    assert.throws(
      () => verifyCandidateEvidence(evidence, EXPECTED),
      /headed Playwright Chromium smoke/i,
      label
    );
  }
});

test("runtime image config preflight rejects bad user, Xvfb entrypoint, and server command safely", () => {
  const verifyRuntimeConfiguration = requireRuntimeConfigVerifier();
  assert.doesNotThrow(() => verifyRuntimeConfiguration(makeRuntimeConfig()));

  const missingUser = makeRuntimeConfig();
  delete missingUser.User;
  assert.throws(
    () => verifyRuntimeConfiguration(missingUser),
    (error) => {
      assert.match(error.message, /config User mismatch.*expected.*node.*observed/i);
      assert.doesNotMatch(error.message, /PRIVATE_VALUE|do-not-log|Env/);
      assert.ok(error.message.length < 1024);
      return true;
    }
  );

  const rootUser = makeRuntimeConfig();
  rootUser.User = "root";
  assert.throws(() => verifyRuntimeConfiguration(rootUser), /config User mismatch.*node.*root/i);

  const noisyUser = makeRuntimeConfig();
  noisyUser.User = `bad\n${"x".repeat(200)}`;
  assert.throws(
    () => verifyRuntimeConfiguration(noisyUser),
    (error) => {
      assert.match(error.message, /config User mismatch/i);
      assert.doesNotMatch(error.message, /\n|x{65}/);
      assert.ok(error.message.length < 1024);
      return true;
    }
  );

  const missingXvfb = makeRuntimeConfig();
  missingXvfb.Entrypoint = ["/app/check-permissions.sh"];
  assert.throws(
    () => verifyRuntimeConfiguration(missingXvfb),
    /config Entrypoint mismatch.*xvfb-run/i
  );

  const emptyCommand = makeRuntimeConfig();
  emptyCommand.Cmd = [];
  assert.throws(
    () => verifyRuntimeConfiguration(emptyCommand),
    /config Cmd mismatch.*dev\/run-standalone\.mjs/i
  );
});

test("smoke startup enables init and uses isolated tmpfs writable by the image default user", () => {
  const { buildSmokeContainerArguments } = requireSmokeHelpers();
  const args = buildSmokeContainerArguments("candidate:image", "smoke-test");
  const tmpfsIndex = args.indexOf("--tmpfs");

  assert.equal(args.includes("--init"), true, "Xvfb readiness requires init before the app starts");
  assert.notEqual(tmpfsIndex, -1);
  assert.equal(args[tmpfsIndex + 1], "/app/data:rw,nosuid,nodev,noexec,mode=1777");
  assert.equal(args.includes("--mount"), false);
  assert.equal(args.includes("--user"), false);
  assert.equal(args.at(-1), "candidate:image");
});

test("build SHA preflight reads in a bounded, isolated, read-only one-shot container", () => {
  const { buildBuildShaCheckArguments } = requireSmokeHelpers();
  const args = buildBuildShaCheckArguments("candidate:image");

  assert.equal(args[0], "run");
  assert.equal(args.includes("--rm"), true);
  assert.equal(args[args.indexOf("--platform") + 1], "linux/arm64");
  assert.equal(args[args.indexOf("--network") + 1], "none");
  assert.equal(args.includes("--read-only"), true);
  assert.equal(args[args.indexOf("--cap-drop") + 1], "ALL");
  assert.equal(args[args.indexOf("--security-opt") + 1], "no-new-privileges=true");
  assert.equal(args[args.indexOf("--pids-limit") + 1], "16");
  assert.equal(args[args.indexOf("--memory") + 1], "64m");
  assert.equal(args[args.indexOf("--cpus") + 1], "0.5");
  assert.equal(args.at(-3), "candidate:image");
  assert.equal(args.at(-2), "-e");
  assert.equal(
    args.at(-1),
    "const fs=require('node:fs');const p='/app/.build/next/omni-overlay/server/BUILD_SHA';process.stdout.write(fs.readFileSync(p).toString('base64'));"
  );
});

test("build SHA preflight enforces exact sentinel bytes through mocked Docker probe", async () => {
  const helpers = requireSmokeHelpers();
  assert.equal(typeof helpers.readCandidateBuildSha, "function");
  const { readCandidateBuildSha } = helpers;
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-build-sha-test-"));
  const dockerPath = path.join(temporaryDirectory, "docker");
  const originalPath = process.env.PATH;
  const expectedBytes = Buffer.from(`${EXPECTED.revision}\n`);

  await fs.writeFile(dockerPath, "#!/bin/sh\nprintf '%s' \"$OVERLAY_TEST_DOCKER_OUTPUT\"\n", {
    mode: 0o755,
  });

  try {
    process.env.PATH = `${temporaryDirectory}${path.delimiter}${originalPath ?? ""}`;
    for (const bytes of [
      Buffer.from(EXPECTED.revision),
      Buffer.from(`${EXPECTED.revision}\n\n`),
      Buffer.from(`${EXPECTED.revision} \n`),
      Buffer.from(`${EXPECTED.revision}\t\n`),
    ]) {
      process.env.OVERLAY_TEST_DOCKER_OUTPUT = bytes.toString("base64");
      assert.throws(
        () => readCandidateBuildSha("candidate:image", EXPECTED.revision),
        /BUILD_SHA.*(framing|expected|revision)/i
      );
    }

    process.env.OVERLAY_TEST_DOCKER_OUTPUT = expectedBytes.toString("base64");
    assert.equal(readCandidateBuildSha("candidate:image", EXPECTED.revision), EXPECTED.revision);

    process.env.OVERLAY_TEST_DOCKER_OUTPUT = Buffer.from(`${"f".repeat(40)}\n`).toString("base64");
    assert.throws(
      () => readCandidateBuildSha("candidate:image", EXPECTED.revision),
      /BUILD_SHA.*(expected|revision)/i
    );
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    delete process.env.OVERLAY_TEST_DOCKER_OUTPUT;
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("wrong OCI revision label fails before native or app startup", async () => {
  assert.ok(verifier, "official overlay image verifier must exist");
  assert.equal(typeof verifier.verifyImages, "function");
  const { verifyImages } = verifier;
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-label-gate-test-"));
  const dockerPath = path.join(temporaryDirectory, "docker");
  const dockerLogPath = path.join(temporaryDirectory, "docker.log");
  const originalPath = process.env.PATH;
  const expectedBytes = Buffer.from(`${EXPECTED.revision}\n`);
  const metadata = [
    {
      Architecture: "arm64",
      Config: {
        ...makeRuntimeConfig(),
        Labels: {
          "org.opencontainers.image.source": EXPECTED.source,
          "org.opencontainers.image.revision": "f".repeat(40),
          "org.opencontainers.image.base.digest": EXPECTED.baseDigest,
        },
      },
    },
  ];

  await fs.writeFile(
    dockerPath,
    [
      "#!/bin/sh",
      'printf \'%s\\n\' "$*" >> "$OVERLAY_TEST_DOCKER_LOG"',
      'if [ "$1" = image ] && [ "$2" = inspect ]; then printf \'%s\' "$OVERLAY_TEST_IMAGE_METADATA"; exit 0; fi',
      'if [ "$1" = run ]; then printf \'%s\' "$OVERLAY_TEST_DOCKER_OUTPUT"; exit 0; fi',
      "exit 91",
      "",
    ].join("\n"),
    { mode: 0o755 }
  );

  try {
    process.env.PATH = `${temporaryDirectory}${path.delimiter}${originalPath ?? ""}`;
    process.env.OVERLAY_TEST_DOCKER_LOG = dockerLogPath;
    process.env.OVERLAY_TEST_IMAGE_METADATA = JSON.stringify(metadata);
    process.env.OVERLAY_TEST_DOCKER_OUTPUT = expectedBytes.toString("base64");

    await assert.rejects(
      verifyImages({
        candidate: "candidate:image",
        official: "official:image",
        ...EXPECTED,
      }),
      /OCI revision label does not match/i
    );

    const dockerCalls = (await fs.readFile(dockerLogPath, "utf8")).trim().split("\n");
    assert.equal(
      dockerCalls.length,
      2,
      "only inspect and BUILD_SHA probe may run before label gate"
    );
    assert.match(dockerCalls[0], /^image inspect candidate:image$/);
    assert.match(dockerCalls[1], /^run .*BUILD_SHA/);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    delete process.env.OVERLAY_TEST_DOCKER_LOG;
    delete process.env.OVERLAY_TEST_IMAGE_METADATA;
    delete process.env.OVERLAY_TEST_DOCKER_OUTPUT;
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("cleanup errors retain primary verification error and collect every cleanup failure", async () => {
  const { withCleanup } = requireSmokeHelpers();
  const primaryError = new Error("health check failed");
  const firstCleanupError = new Error("container removal failed");
  const secondCleanupError = new Error("temporary extraction removal failed");
  const cleanupOrder = [];

  await assert.rejects(
    withCleanup(async () => {
      throw primaryError;
    }, [
      async () => {
        cleanupOrder.push("container");
        throw firstCleanupError;
      },
      async () => {
        cleanupOrder.push("extraction");
        throw secondCleanupError;
      },
    ]),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.strictEqual(error.cause, primaryError);
      assert.strictEqual(error.errors[0], primaryError);
      assert.strictEqual(error.errors[1], firstCleanupError);
      assert.strictEqual(error.errors[2], secondCleanupError);
      const primaryPosition = error.message.indexOf(primaryError.message);
      const firstCleanupPosition = error.message.indexOf(firstCleanupError.message);
      const secondCleanupPosition = error.message.indexOf(secondCleanupError.message);
      assert.ok(primaryPosition >= 0 && primaryPosition < firstCleanupPosition);
      assert.ok(firstCleanupPosition < secondCleanupPosition);
      return true;
    }
  );

  assert.deepEqual(cleanupOrder, ["container", "extraction"]);
});

test("cleanup-only failures still fail verification and do not skip later cleanup", async () => {
  const { withCleanup } = requireSmokeHelpers();
  const firstCleanupError = new Error("container removal failed");
  const secondCleanupError = new Error("temporary extraction removal failed");
  const cleanupOrder = [];

  await assert.rejects(
    withCleanup(
      async () => "verified",
      [
        async () => {
          cleanupOrder.push("container");
          throw firstCleanupError;
        },
        async () => {
          cleanupOrder.push("extraction");
          throw secondCleanupError;
        },
      ]
    ),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.strictEqual(error.cause, firstCleanupError);
      assert.strictEqual(error.errors[0], firstCleanupError);
      assert.strictEqual(error.errors[1], secondCleanupError);
      assert.ok(
        error.message.indexOf(firstCleanupError.message) <
          error.message.indexOf(secondCleanupError.message)
      );
      return true;
    }
  );

  assert.deepEqual(cleanupOrder, ["container", "extraction"]);
});

test("verifier rejects wrong architecture and source provenance", () => {
  const verifyCandidateEvidence = requireVerifier();

  const wrongArchitecture = makeEvidence();
  wrongArchitecture.candidate.architecture = "amd64";
  assert.throws(() => verifyCandidateEvidence(wrongArchitecture, EXPECTED), /ARM64/i);

  const wrongSource = makeEvidence();
  wrongSource.candidate.labels["org.opencontainers.image.source"] = "https://example.invalid";
  assert.throws(() => verifyCandidateEvidence(wrongSource, EXPECTED), /source/i);

  const wrongRevision = makeEvidence();
  wrongRevision.candidate.labels["org.opencontainers.image.revision"] = "f".repeat(40);
  assert.throws(() => verifyCandidateEvidence(wrongRevision, EXPECTED), /revision/i);

  const wrongBase = makeEvidence();
  wrongBase.candidate.labels["org.opencontainers.image.base.digest"] = "sha256:other";
  assert.throws(() => verifyCandidateEvidence(wrongBase, EXPECTED), /base digest/i);
});

test("verifier rejects native SQLite, health, dashboard, and direct UI API dispatch failures", () => {
  const verifyCandidateEvidence = requireVerifier();

  const sqliteFailure = makeEvidence();
  sqliteFailure.candidate.sqlite.ok = false;
  assert.throws(() => verifyCandidateEvidence(sqliteFailure, EXPECTED), /SQLite/i);

  const healthFailure = makeEvidence();
  healthFailure.candidate.healthStatus = "starting";
  assert.throws(() => verifyCandidateEvidence(healthFailure, EXPECTED), /health/i);

  const dashboardFailure = makeEvidence();
  dashboardFailure.candidate.dashboardStatus = 500;
  assert.throws(() => verifyCandidateEvidence(dashboardFailure, EXPECTED), /dashboard/i);

  const dispatchFailure = makeEvidence();
  dispatchFailure.candidate.apiResponse.body.error.code = "ROUTE_MISSING";
  assert.throws(() => verifyCandidateEvidence(dispatchFailure, EXPECTED), /401 AUTH_002/i);

  const handlerEnvelope = makeEvidence();
  handlerEnvelope.candidate.apiResponse.body.error.code = "invalid_api_key";
  assert.throws(() => verifyCandidateEvidence(handlerEnvelope, EXPECTED), /401 AUTH_002/i);

  const unprotectedCatalog = makeEvidence();
  unprotectedCatalog.candidate.apiResponse.status = 200;
  assert.throws(() => verifyCandidateEvidence(unprotectedCatalog, EXPECTED), /401 AUTH_002/i);

  const wrongPath = makeEvidence();
  wrongPath.candidate.apiResponse.path = "/api/system/status";
  assert.throws(() => verifyCandidateEvidence(wrongPath, EXPECTED), /direct UI listener/i);

  const wrongPort = makeEvidence();
  wrongPort.candidate.apiResponse.port = 20129;
  assert.throws(() => verifyCandidateEvidence(wrongPort, EXPECTED), /direct UI listener/i);
});

test("verifier rejects any official UI build, static, page, or non-API route drift", () => {
  const verifyCandidateEvidence = requireVerifier();

  const buildIdDrift = makeEvidence();
  buildIdDrift.candidate.ui.buildId = "fork-build-id";
  assert.throws(() => verifyCandidateEvidence(buildIdDrift, EXPECTED), /BUILD_ID/i);

  const staticDrift = makeEvidence();
  staticDrift.candidate.ui.staticFiles[0].sha256 = "sha256:changed";
  assert.throws(() => verifyCandidateEvidence(staticDrift, EXPECTED), /static/i);

  const pagesDrift = makeEvidence();
  pagesDrift.candidate.ui.pagesManifest["/_error"] = "pages/fork-error.js";
  assert.throws(() => verifyCandidateEvidence(pagesDrift, EXPECTED), /pages manifest/i);

  const routeDrift = makeEvidence();
  routeDrift.candidate.ui.nonApiAppPaths["/dashboard/page"] = "app/fork-dashboard.js";
  assert.throws(() => verifyCandidateEvidence(routeDrift, EXPECTED), /non-API app paths/i);
});

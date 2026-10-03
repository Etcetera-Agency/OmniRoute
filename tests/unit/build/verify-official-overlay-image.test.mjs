import assert from "node:assert/strict";
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
  baseDigest: "sha256:754b5e50361dc2802f0b6576456e72a5163cdc991378ce3f212a2f90b771eb96",
};

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
      runtimeUser: "node",
      labels: {
        "org.opencontainers.image.source": EXPECTED.source,
        "org.opencontainers.image.revision": EXPECTED.revision,
        "org.opencontainers.image.base.digest": EXPECTED.baseDigest,
      },
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
  assert.equal(typeof verifier.withCleanup, "function");
  return verifier;
}

test("verifier accepts a healthy ARM64 overlay that preserves official UI", () => {
  const verifyCandidateEvidence = requireVerifier();
  assert.doesNotThrow(() => verifyCandidateEvidence(makeEvidence(), EXPECTED));
});

test("verifier requires headed non-root Chromium smoke to close on about:blank", () => {
  const verifyCandidateEvidence = requireVerifier();
  const rootDefaultUser = makeEvidence();
  rootDefaultUser.candidate.runtimeUser = "root";
  assert.throws(
    () => verifyCandidateEvidence(rootDefaultUser, EXPECTED),
    /default runtime user.*non-root node/i
  );

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

test("smoke data uses isolated tmpfs writable by the image default user", () => {
  const { buildSmokeContainerArguments } = requireSmokeHelpers();
  const args = buildSmokeContainerArguments("candidate:image", "smoke-test");
  const tmpfsIndex = args.indexOf("--tmpfs");

  assert.notEqual(tmpfsIndex, -1);
  assert.equal(args[tmpfsIndex + 1], "/app/data:rw,nosuid,nodev,noexec,mode=1777");
  assert.equal(args.includes("--mount"), false);
  assert.equal(args.includes("--user"), false);
  assert.equal(args.at(-1), "candidate:image");
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

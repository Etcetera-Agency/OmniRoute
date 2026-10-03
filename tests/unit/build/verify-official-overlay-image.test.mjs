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
        body: { error: { code: "invalid_api_key" } },
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

test("verifier accepts a healthy ARM64 overlay that preserves official UI", () => {
  const verifyCandidateEvidence = requireVerifier();
  assert.doesNotThrow(() => verifyCandidateEvidence(makeEvidence(), EXPECTED));
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
  assert.throws(() => verifyCandidateEvidence(dispatchFailure, EXPECTED), /401 invalid_api_key/i);

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

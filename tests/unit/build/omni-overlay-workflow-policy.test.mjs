import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const dockerfile = fs.readFileSync(
  path.join(root, "docker/official-backend-overlay.Dockerfile"),
  "utf8"
);
const workflowPath = path.join(root, ".github/workflows/omni-overlay-image.yml");
const workflow = fs.existsSync(workflowPath)
  ? yaml.load(fs.readFileSync(workflowPath, "utf8"))
  : null;

test("fork overlay image workflow runs only on canonical main or manual dispatch", () => {
  assert.ok(workflow, "fork image workflow must exist");
  assert.deepEqual(workflow.on?.push?.branches, ["main"]);
  assert.equal(workflow.on?.pull_request, undefined);
  assert.equal(workflow.on?.schedule, undefined);
  assert.deepEqual(workflow.on?.workflow_dispatch?.inputs?.ref?.options, ["refs/heads/main"]);

  assert.deepEqual(Object.keys(workflow.jobs ?? {}), ["publish-main-image", "deploy-production"]);
  assert.equal(workflow.concurrency, undefined, "publishing cannot cancel a running deploy");

  const jobs = Object.values(workflow.jobs ?? {});
  const publishers = jobs.filter((job) => job.permissions?.packages === "write");
  assert.equal(publishers.length, 1, "only one job may receive GHCR write access");

  const publisher = publishers[0];
  const deploy = workflow.jobs["deploy-production"];
  assert.equal(publisher["runs-on"], "ubuntu-24.04-arm");
  assert.match(publisher.if ?? "", /Etcetera-Agency\/OmniRoute/);
  assert.match(publisher.if ?? "", /refs\/heads\/main/);
  assert.match(publisher.if ?? "", /push/);
  assert.match(publisher.if ?? "", /workflow_dispatch/);
  assert.equal(publisher.needs, undefined);
  assert.deepEqual(publisher.outputs, {
    image_digest: "${{ steps.publish-sha.outputs.digest }}",
    main_tag_updated: "${{ steps.publish-main.outputs.pushed }}",
  });
  assert.deepEqual(publisher.concurrency, {
    group: "omni-overlay-main-publisher",
    "cancel-in-progress": true,
  });

  assert.equal(deploy.needs, "publish-main-image");
  assert.equal(deploy.environment, "production");
  assert.equal(deploy.permissions.contents, "read");
  assert.equal(deploy.permissions.packages, undefined);
  assert.equal(deploy.concurrency.group, "omniroute-production-deploy");
  assert.equal(deploy.concurrency["cancel-in-progress"], false);
  assert.equal(deploy["timeout-minutes"], 70);
  assert.match(deploy.if ?? "", /Etcetera-Agency\/OmniRoute/);
  assert.match(deploy.if ?? "", /refs\/heads\/main/);
  assert.match(deploy.if ?? "", /needs\.publish-main-image\.result/);
  assert.match(deploy.if ?? "", /outputs\.main_tag_updated/);

  const deployCheckout = deploy.steps.find((step) => step.uses?.includes("actions/checkout@"));
  assert.equal(deployCheckout.with.ref, "${{ github.sha }}");
  assert.equal(deployCheckout.with["persist-credentials"], false);
  const deployTransport = deploy.steps.find((step) => step.run?.includes("deploy-main-image.mjs"));
  assert.ok(deployTransport, "deploy job must use the tracked transport helper");
  assert.equal(
    deployTransport.env.OMNI_DEPLOY_SSH_PRIVATE_KEY,
    "${{ secrets.OMNI_DEPLOY_SSH_PRIVATE_KEY }}"
  );
  assert.equal(
    deployTransport.env.OMNI_DEPLOY_SSH_KNOWN_HOSTS,
    "${{ vars.OMNI_DEPLOY_SSH_KNOWN_HOSTS }}"
  );
  assert.equal(deployTransport.env.GITHUB_TOKEN, "${{ github.token }}");
  assert.doesNotMatch(
    JSON.stringify(publisher),
    /OMNI_DEPLOY_SSH_PRIVATE_KEY|OMNI_DEPLOY_SSH_KNOWN_HOSTS/,
    "publisher must not receive production SSH credentials"
  );
  assert.doesNotMatch(
    JSON.stringify(deploy),
    /test:unit:ci|test:vitest|eslint|prettier|check:workflows|openspec.*validate/i
  );
  const deploymentSummary = deploy.steps.find(
    (step) => step.name === "Record production deployment result"
  );
  assert.match(deploymentSummary.run, /omniroute@%s/);
  assert.match(deploymentSummary.run, /tree\/%s/);
  assert.match(deploymentSummary.run, /actions\/runs\/%s/);
  assert.match(deploymentSummary.run, /GITHUB_RUN_ATTEMPT/);
  const build = publisher.steps.find((step) => step.uses?.includes("docker/build-push-action@"));
  assert.ok(build, "main publisher must build through Buildx");
  assert.equal(build.with.platforms, "linux/arm64");
  assert.ok(/mode=min/.test(build.with["cache-to"]), "cache export must stay small");
  assert.ok(
    /ignore-error=true/.test(build.with["cache-to"]),
    "cache export failures must not invalidate a verified build"
  );
  assert.ok(/org\.opencontainers\.image\.base\.digest/.test(build.with.labels));
  assert.ok(
    dockerfile.includes(
      "ARG OFFICIAL_IMAGE=ghcr.io/diegosouzapw/omniroute@sha256:754b5e50361dc2802f0b6576456e72a5163cdc991378ce3f212a2f90b771eb96"
    ),
    "backend overlay must remain based on the verified official image digest"
  );

  const dockerJobs = Object.values(workflow.jobs ?? {}).filter((job) =>
    job.steps?.some((step) =>
      /docker\/build-push-action|docker buildx build|build:backend/.test(
        `${step.uses ?? ""}\n${step.run ?? ""}`
      )
    )
  );
  assert.deepEqual(dockerJobs, [publisher], "PR and feature checks must not build images");

  const loginIndex = publisher.steps.findIndex((step) =>
    step.run?.includes("docker login ghcr.io")
  );
  const verifyIndex = publisher.steps.findIndex((step) =>
    step.run?.includes("verify-official-overlay-image.mjs")
  );
  assert.ok(verifyIndex >= 0, "candidate verifier must run in publisher job");
  assert.ok(loginIndex > verifyIndex, "GHCR login must follow candidate verification");

  const freshnessIndex = publisher.steps.findIndex((step) =>
    step.run?.includes("check-main-image-current.mjs")
  );
  const shaTagIndex = publisher.steps.findIndex((step) =>
    step.run?.includes("$FORK_IMAGE:$GITHUB_SHA")
  );
  const mainTagIndex = publisher.steps.findIndex((step) => step.run?.includes(":main"));
  assert.ok(
    freshnessIndex > loginIndex,
    "main-head freshness must be checked after SHA publication"
  );
  assert.ok(shaTagIndex > loginIndex && freshnessIndex > shaTagIndex);
  assert.ok(mainTagIndex > freshnessIndex, "a stale workflow must not move the main tag");
  assert.doesNotMatch(
    JSON.stringify(workflow),
    /test:unit:ci|test:vitest|eslint|prettier|check:workflows|openspec.*validate/i
  );
});

test("routine test and check workflows remain manual-dispatch only", () => {
  for (const file of [
    ".github/workflows/api-route-typecheck.yml",
    ".github/workflows/test-quarantine.yml",
    ".github/workflows/release-acceptance.yml",
  ]) {
    const auxiliary = yaml.load(fs.readFileSync(path.join(root, file), "utf8"));
    assert.deepEqual(
      Object.keys(auxiliary.on ?? {}),
      ["workflow_dispatch"],
      `${file} is manual only`
    );
  }
});

test("backend builder compiles once without running unit tests", () => {
  const builder = dockerfile.split("FROM scratch AS prebuilt-backend")[0];
  const install = builder.indexOf("npm ci ");
  const compile = builder.indexOf("npm run build:backend");

  assert.ok(install >= 0, "backend builder installs its pinned dependencies");
  assert.ok(
    builder.includes(
      'RUN test "$OFFICIAL_IMAGE" = "ghcr.io/diegosouzapw/omniroute@$OFFICIAL_BASE_DIGEST"'
    ),
    "build rejects a base image that differs from the labelled pinned digest"
  );
  assert.ok(compile > install, "backend compile starts after dependencies install");
  assert.doesNotMatch(builder, /(?:node\s+--test|npm\s+run\s+test)/);
  assert.equal(builder.match(/npm run build:backend/g)?.length, 1);

  const dockerignore = fs.readFileSync(path.join(root, ".dockerignore"), "utf8");
  assert.match(dockerignore, /^tests$/m, "the Docker context excludes unit tests");
  assert.doesNotMatch(
    dockerignore,
    /^!tests\//m,
    "no test files are re-included in the build context"
  );
});

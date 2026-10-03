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

test("fork overlay image workflow builds and publishes only from canonical main", () => {
  assert.ok(workflow, "fork image workflow must exist");
  assert.ok(workflow.on?.push, "feature pushes must receive ordinary CI checks");
  assert.ok(workflow.on?.pull_request?.branches?.includes("main"));
  assert.deepEqual(workflow.on?.workflow_dispatch?.inputs?.ref?.options, ["refs/heads/main"]);

  const checks = workflow.jobs?.checks;
  assert.ok(checks, "feature and PR refs must run normal checks");
  const checksSource = JSON.stringify(checks);
  assert.ok(/test:unit:ci/.test(checksSource), "checks must run the normal unit suite");
  assert.ok(/@fission-ai\/openspec@\d+\.\d+\.\d+ validate --all --strict/.test(checksSource));
  assert.ok(
    /check:workflows/.test(checksSource),
    "checks must validate workflow syntax and security"
  );

  const publishers = Object.values(workflow.jobs ?? {}).filter(
    (job) => job.permissions?.packages === "write"
  );
  assert.equal(publishers.length, 1, "only one job may receive GHCR write access");

  const publisher = publishers[0];
  assert.equal(publisher["runs-on"], "ubuntu-24.04-arm");
  assert.match(publisher.if ?? "", /Etcetera-Agency\/OmniRoute/);
  assert.match(publisher.if ?? "", /refs\/heads\/main/);
  assert.match(publisher.if ?? "", /push/);
  assert.match(publisher.if ?? "", /workflow_dispatch/);
  assert.deepEqual(publisher.needs, ["checks"]);
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
  assert.ok(
    !/pull_request_target/.test(JSON.stringify(workflow)),
    "untrusted PRs must not reach a write-token workflow"
  );
});

test("backend builder runs the isolated overlay regression before its only compile", () => {
  const builder = dockerfile.split("FROM scratch AS prebuilt-backend")[0];
  const install = builder.indexOf("npm ci ");
  const mergerTest = builder.indexOf(
    "node --test tests/unit/build/merge-official-backend-overlay.test.mjs"
  );
  const compile = builder.indexOf("npm run build:backend");

  assert.ok(install >= 0, "backend builder installs its pinned dependencies");
  assert.ok(
    builder.includes(
      'RUN test "$OFFICIAL_IMAGE" = "ghcr.io/diegosouzapw/omniroute@$OFFICIAL_BASE_DIGEST"'
    ),
    "build rejects a base image that differs from the labelled pinned digest"
  );
  assert.ok(mergerTest > install, "merger regression runs after dependencies install");
  assert.ok(compile > mergerTest, "backend compile starts only after merger regression passes");
  assert.equal(builder.match(/npm run build:backend/g)?.length, 1);

  const dockerignore = fs.readFileSync(path.join(root, ".dockerignore"), "utf8");
  assert.match(dockerignore, /!tests\//);
  assert.match(dockerignore, /!tests\/unit\//);
  assert.match(dockerignore, /!tests\/unit\/build\//);
  assert.match(dockerignore, /!tests\/unit\/build\/merge-official-backend-overlay\.test\.mjs/);
});
